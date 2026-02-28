'use server';

import { auth } from '@clerk/nextjs/server';
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
            model: config.openai.model,
            messages: [{ role: "user", content: prompt }],
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
    } catch (error) {
        console.error("Keyword extraction error:", error);
        return [];
    }
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
${JSON.stringify(resumeData, null, 2)}

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
            model: config.openai.model,
            messages: [{ role: "user", content: prompt }],
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
    } catch (error) {
        console.error("Propose patch error:", error);
        throw new Error("Failed to generate resume patch");
    }
}
