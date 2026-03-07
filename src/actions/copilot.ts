'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { ResumeData, ExperienceItem, ProjectItem } from '@/types/resume';
import { GitHubRepo } from '@/types/github';
import { checkAiRateLimit } from '@/lib/rateLimit';
import {
    ProposedResumePatchSchema,
    KeywordsResponseSchema,
    parseWithRetry,
} from '@/lib/aiSchemas';
import { trackedChatCompletion } from '@/lib/usageTracker';
import { improveText } from '@/actions/ai';

export interface CopilotContext {
    resumeData: ResumeData;
    jobDescription: string;
    kbBullets: string[];
    githubRepos: GitHubRepo[];
}

export interface ProposedResumePatch {
    sections: {
        summary?: string;
        experience?: ExperienceItem[];
        projects?: ProjectItem[];
        skills?: string[];
    };
    diffs: {
        summary?: { before: string; after: string; changed: boolean };
        experience?: { before: string; after: string; changed: boolean };
        projects?: { before: string; after: string; changed: boolean };
        skills?: { before: string; after: string; changed: boolean };
    };
    rationale: string[];
    proposedAtsScore: number;
}

const RewriteBulletInputSchema = z.object({
    bulletText: z.string().min(1).max(5000),
    jobDescription: z.string().max(30000).optional(),
    enhancementType: z.enum(['quantify', 'tailor', 'grammar']),
});

const RewriteBulletResponseSchema = z.object({
    suggestion: z.string().min(1),
    enhancementType: z.enum(['quantify', 'tailor', 'grammar']),
    appliedKeywords: z.array(z.string()).default([]),
    notes: z.string().optional(),
});

export type BulletEnhancementType = z.infer<typeof RewriteBulletInputSchema>['enhancementType'];
export type RewriteBulletResponse = z.infer<typeof RewriteBulletResponseSchema>;

const SectionSkillHintsInputSchema = z.object({
    jobDescription: z.string().min(1).max(30000),
    section: z.enum(['experience', 'projects']),
    entries: z.array(z.object({
        id: z.string().min(1).max(255),
        text: z.string().max(10000),
        technologies: z.array(z.string()).optional(),
    })).min(1).max(30),
});

const SectionSkillHintsResponseSchema = z.object({
    entries: z.array(z.object({
        id: z.string(),
        matchedKeywords: z.array(z.string()).default([]),
        missingKeywords: z.array(z.string()).default([]),
    })),
});

export type SectionSkillHints = Record<string, { matchedKeywords: string[]; missingKeywords: string[] }>;

export async function scoreReposForJob(
    repos: GitHubRepo[],
    jobDescription: string
): Promise<Array<GitHubRepo & { relevanceScore: number }>> {
    const jdLower = jobDescription.toLowerCase();
    
    return repos.map(repo => {
        let score = 0;
        
        if (repo.language && jdLower.includes(repo.language.toLowerCase())) {
            score += 30;
        }
        
        for (const topic of repo.topics) {
            if (jdLower.includes(topic.toLowerCase())) {
                score += 15;
            }
        }
        
        if (repo.description) {
            const descWords = repo.description.toLowerCase().split(/\W+/);
            const matches = descWords.filter(w => w.length > 3 && jdLower.includes(w)).length;
            score += Math.min(25, matches * 5);
        }
        
        score += Math.min(10, repo.stargazers_count);
        
        return { ...repo, relevanceScore: score };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export async function extractJobKeywords(jobDescription: string): Promise<string[]> {
    if (!jobDescription) return [];

    const prompt = `Extract the top 15 most important technical skills and keywords from the following job description. Output them as a JSON object with key "keywords" containing an array of strings. Output ONLY valid JSON.

Job Description:
${jobDescription}`;

    try {
        const { userId } = await auth();
        if (!userId) throw new Error('Not authenticated');

        const response = await trackedChatCompletion({
            model: config.openai.models.jdParse,
            messages: [
                { role: "system", content: "You extract high-signal hiring keywords from job descriptions with precision." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            operation: 'extract_keywords',
            metadata: { source: 'copilot' },
        });

        const content = response.choices[0].message.content;
        if (!content) return [];

        const parseResult = await parseWithRetry(content, KeywordsResponseSchema);
        if (parseResult.success) {
            return parseResult.data.keywords;
        }
        
        return [];
    } catch (error: unknown) {
        console.error("Keyword extraction error:", error);
        return [];
    }
}

export async function rewriteBulletPoint(
    bulletText: string,
    jobDescription: string,
    enhancementType: BulletEnhancementType
): Promise<RewriteBulletResponse> {
    const parsed = RewriteBulletInputSchema.safeParse({
        bulletText,
        jobDescription,
        enhancementType,
    });

    if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const { userId } = await auth();
    if (!userId) throw new Error('Not authenticated');

    const limit = await checkAiRateLimit(`ai:copilot:inline:${userId}`);
    if (!limit.allowed) throw new Error(limit.error);

    const jd = parsed.data.jobDescription?.trim() ?? '';
    const hasJd = jd.length > 0;
    const keywords = hasJd ? (await extractJobKeywords(jd)).slice(0, 12) : [];

    const actionInstruction = (() => {
        switch (parsed.data.enhancementType) {
            case 'quantify':
                return 'Strengthen impact by surfacing measurable outcomes, scope, and scale where directly supported by the original text. Do not invent numbers.';
            case 'tailor':
                return hasJd
                    ? 'Tailor this bullet to the target role by naturally weaving in relevant job keywords without keyword stuffing.'
                    : 'Improve this bullet for broad job relevance with stronger phrasing while preserving facts.';
            case 'grammar':
                return 'Fix grammar, tense consistency, and clarity while preserving the original meaning and facts.';
            default:
                return 'Improve this bullet while preserving factual accuracy.';
        }
    })();

    const prompt = `You are improving a single resume bullet.\n\nTASK:\n${actionInstruction}\n\nBULLET:\n${parsed.data.bulletText}\n\n${hasJd ? `TARGET JOB DESCRIPTION:\n${jd}\n\n` : ''}${keywords.length > 0 ? `PRIORITY KEYWORDS (use only when natural):\n${keywords.join(', ')}\n\n` : ''}Return ONLY valid JSON with keys:\n- suggestion: string\n- enhancementType: \"quantify\" | \"tailor\" | \"grammar\"\n- appliedKeywords: string[]\n- notes: optional string\n\nRules:\n- Keep the same factual claims.\n- Do not fabricate technologies, outcomes, or metrics.\n- Keep a single bullet-length output (1-2 lines).\n- Do not include markdown.`;

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.paraphrase,
            messages: [
                { role: 'system', content: 'You are a precise resume bullet editor. You preserve truth and improve quality.' },
                { role: 'user', content: prompt },
            ],
        }, {
            userId,
            operation: 'inline_bullet_rewrite',
            metadata: {
                enhancementType: parsed.data.enhancementType,
                hasJobDescription: hasJd,
                keywordCount: keywords.length,
            },
        });

        const content = response.choices[0].message.content;
        if (!content) {
            throw new Error('No rewrite returned by model');
        }

        const parsedResponse = await parseWithRetry(content, RewriteBulletResponseSchema);
        if (parsedResponse.success) {
            return parsedResponse.data;
        }

        const fallbackInstruction = parsed.data.enhancementType === 'grammar'
            ? 'Fix grammar and clarity while preserving factual claims.'
            : parsed.data.enhancementType === 'tailor'
                ? `Tailor this bullet for the job requirements.${hasJd ? ` Target job description: ${jd.slice(0, 3000)}` : ''}`
                : 'Add measurable impact when possible without inventing metrics.';

        const fallbackText = await improveText(parsed.data.bulletText, 'bullet', fallbackInstruction);
        return {
            suggestion: fallbackText,
            enhancementType: parsed.data.enhancementType,
            appliedKeywords: [],
            notes: 'Fallback rewrite applied due to JSON parse failure.',
        };
    } catch (error: unknown) {
        throw new Error(error instanceof Error ? error.message : 'Failed to rewrite bullet point');
    }
}

export async function suggestSectionSkillHints(input: {
    jobDescription: string;
    section: 'experience' | 'projects';
    entries: Array<{ id: string; text: string; technologies?: string[] }>;
}): Promise<SectionSkillHints> {
    const parsed = SectionSkillHintsInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const { userId } = await auth();
    if (!userId) throw new Error('Not authenticated');

    const limit = await checkAiRateLimit(`ai:copilot:hints:${userId}`);
    if (!limit.allowed) throw new Error(limit.error);

    const prompt = `You are an expert resume reviewer.\n\nTASK:\nGiven the job description and a list of ${parsed.data.section} entries, return per-entry matched and missing keywords.\n\nJOB DESCRIPTION:\n${parsed.data.jobDescription}\n\nENTRIES:\n${parsed.data.entries.map((entry) => `- id: ${entry.id}\n  text: ${entry.text}\n  technologies: ${(entry.technologies ?? []).join(', ') || 'none'}`).join('\n\n')}\n\nOutput ONLY valid JSON in this format:\n{\n  \"entries\": [\n    {\n      \"id\": \"entry-id\",\n      \"matchedKeywords\": [\"...\"],\n      \"missingKeywords\": [\"...\"]\n    }\n  ]\n}\n\nRules:\n- Use concise technical keywords.\n- matchedKeywords: max 5.\n- missingKeywords: max 5, and tailored to that specific entry.\n- Do NOT return the same missingKeywords list for every entry unless it is truly unavoidable.\n- Prioritize skills that are realistic to add based on each entry's context.\n- Do not fabricate facts; this is guidance for improvement.`;

    const response = await trackedChatCompletion({
        model: config.openai.models.jdParse,
        messages: [
            { role: 'system', content: 'You map job requirements to resume entries with high precision.' },
            { role: 'user', content: prompt },
        ],
    }, {
        userId,
        operation: 'section_skill_hints',
        metadata: {
            section: parsed.data.section,
            entryCount: parsed.data.entries.length,
        },
    });

    const content = response.choices[0].message.content;
    if (!content) return {};

    const parseResult = await parseWithRetry(content, SectionSkillHintsResponseSchema);
    if (!parseResult.success) return {};

    const hints: SectionSkillHints = {};
    for (const entry of parseResult.data.entries) {
        hints[entry.id] = {
            matchedKeywords: entry.matchedKeywords.slice(0, 5),
            missingKeywords: entry.missingKeywords.slice(0, 5),
        };
    }
    return hints;
}

function formatExperienceForDiff(experience: ExperienceItem[]): string {
    return experience.map(e => 
        `${e.role} at ${e.company}\n${e.description}`
    ).join('\n\n');
}

function formatProjectsForDiff(projects: ProjectItem[]): string {
    return projects.map(p => 
        `${p.name}: ${p.description}\nTech: ${p.technologies.join(', ')}`
    ).join('\n\n');
}

export async function proposeResumePatch(context: CopilotContext): Promise<ProposedResumePatch> {
    const { userId } = await auth();
    if (userId) {
        const limit = await checkAiRateLimit(`ai:copilot:${userId}`);
        if (!limit.allowed) throw new Error(limit.error);
    }
    if (!userId) throw new Error('Not authenticated');

    const { resumeData, jobDescription, kbBullets, githubRepos } = context;

    const prompt = `You are a resume optimization expert. Analyze this resume against the job description and propose targeted improvements.

JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME:
${JSON.stringify(resumeData)}

${kbBullets.length > 0 ? `CANDIDATE'S ACHIEVEMENT LIBRARY (use relevant bullets):
${kbBullets.join('\n')}` : ''}

${githubRepos.length > 0 ? `CANDIDATE'S GITHUB PROJECTS (ADD relevant ones to projects section):
${githubRepos.slice(0, 5).map(r => `- Name: ${r.name}
  URL: ${r.html_url}
  Description: ${r.description || 'No description'}
  Language: ${r.language || 'N/A'}
  Topics: ${r.topics.join(', ') || 'none'}`).join('\n\n')}` : ''}

Generate a JSON object with:
1. "sections" - improved content for each section:
   - "summary": improved professional summary string tailored to the job
   - "experience": array of improved experience items (MUST keep same structure: id, company, role, startDate, endDate, current, location, description)
   - "projects": array of project items - IMPROVE existing projects AND ADD NEW PROJECTS from the GitHub repos above that are relevant to the job. Each project needs: id (generate UUID for new ones), name, description (2-3 sentences with impact), url (use html_url from GitHub), technologies (array of tech used)
   - "skills": array of optimized skills strings (prioritize job-relevant skills)

2. "rationale": array of 3-5 strings explaining key changes made

3. "proposedAtsScore": estimated ATS compatibility score (0-100) after changes

IMPORTANT RULES:
- Keep existing education unchanged
- Maintain ALL existing IDs from original data
- ADD new projects from GitHub repos that match the job requirements
- Use strong action verbs and quantify achievements
- Prioritize job-relevant keywords

Output ONLY valid JSON, no markdown.`;

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.assembly,
            messages: [
                { role: "system", content: "You are a resume optimization copilot. Improve relevance while preserving factual truth and structure constraints." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            operation: 'resume_assembly',
            metadata: { source: 'copilot_patch' },
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("No response from AI");

        const parseResult = await parseWithRetry(content, ProposedResumePatchSchema);
        
        if (parseResult.success) {
            const patch = parseResult.data;
            
            const newSummary = patch.sections.summary || resumeData.personalInfo.summary;
            const newExperience = patch.sections.experience || resumeData.experience;
            const newProjects = patch.sections.projects || resumeData.projects;
            const newSkills = patch.sections.skills || resumeData.skills;
            
            return {
                sections: {
                    summary: newSummary,
                    experience: newExperience,
                    projects: newProjects,
                    skills: newSkills,
                },
                diffs: {
                    summary: {
                        before: resumeData.personalInfo.summary,
                        after: newSummary,
                        changed: newSummary !== resumeData.personalInfo.summary,
                    },
                    experience: {
                        before: formatExperienceForDiff(resumeData.experience),
                        after: formatExperienceForDiff(newExperience),
                        changed: !!patch.sections.experience,
                    },
                    projects: {
                        before: formatProjectsForDiff(resumeData.projects),
                        after: formatProjectsForDiff(newProjects),
                        changed: !!patch.sections.projects,
                    },
                    skills: {
                        before: resumeData.skills.join(', '),
                        after: newSkills.join(', '),
                        changed: !!patch.sections.skills,
                    },
                },
                rationale: patch.rationale || [],
                proposedAtsScore: patch.proposedAtsScore || 75,
            };
        } else {
            console.error("Patch validation error:", parseResult.error);
            throw new Error("Invalid patch format from AI");
        }
    } catch (error: unknown) {
        console.error("Propose patch error:", error);
        throw new Error("Failed to generate resume patch");
    }
}
