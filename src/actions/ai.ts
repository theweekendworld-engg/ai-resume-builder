'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { ResumeData } from '@/types/resume';
import { ATSScore } from '@/store/resumeStore';
import { ATSScoreSchema, ResumeDataSchema, KeywordsResponseSchema, parseWithRetry } from '@/lib/aiSchemas';
import { logUsageEvent, trackedChatCompletion } from '@/lib/usageTracker';

const ImproveTextInputSchema = z.object({
    text: z.string().min(1),
    type: z.enum(['summary', 'bullet', 'project']),
    customInstruction: z.string().max(2000).optional(),
});

const ModifyLatexInputSchema = z.object({
    currentCode: z.string().min(1),
    instruction: z.string().min(1),
});

const ResumeToLatexInputSchema = z.object({
    resumeData: ResumeDataSchema,
});

const LatexToResumeInputSchema = z.object({
    latexCode: z.string().min(1),
});

function resolveTrackingUserId(value?: string): Promise<string> {
    if (value?.trim()) return Promise.resolve(value.trim());
    return auth().then(({ userId }) => {
        if (!userId) throw new Error('Not authenticated');
        return userId;
    });
}



export async function improveText(text: string, type: 'summary' | 'bullet' | 'project', customInstruction?: string) {
    if (!text) return "";
    const parsedInput = ImproveTextInputSchema.safeParse({ text, type, customInstruction });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }

    let basePrompt: string;
    if (type === 'summary') {
        basePrompt = `Rewrite the following professional summary to be more impactful, concise, and professional. Highlight key achievements if possible.`;
    } else if (type === 'project') {
        basePrompt = `Summarize the following project README or description into a concise resume bullet point. Include the technologies used and key achievements.`;
    } else {
        basePrompt = `Rewrite the following resume bullet point to use strong action verbs, quantify results if possible, and be more professional.`;
    }

    const instruction = parsedInput.data.customInstruction ? ` ${parsedInput.data.customInstruction}` : '';
    const prompt = `${basePrompt}${instruction}\n\nOutput ONLY the rewritten text, nothing else.\n\nText: "${parsedInput.data.text}"`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.paraphrase,
            messages: [
                { role: "system", content: "You are an expert resume writing assistant. Preserve factual accuracy and never invent claims." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            operation: 'improve_text',
            metadata: { type },
        });

        const content = response.choices[0].message.content?.trim() || text;
        return content.replace(/^(Summarize|Rewrite|Output|Bullet point|Here's|Here is):\s*/i, '').trim();
    } catch (error: unknown) {
        console.error("AI Error:", error);
        throw new Error("Failed to generate AI improvement.");
    }
}

export async function extractKeywords(jobDescription: string): Promise<string[]> {
    if (!jobDescription) return [];

    const prompt = `Extract the top 10-15 most important technical skills and keywords from the following job description. Output them as a JSON object with key "keywords" containing an array of strings. Output ONLY valid JSON.\n\nJob Description:\n${jobDescription}`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.jdParse,
            messages: [
                { role: "system", content: "You extract structured hiring keywords from job descriptions with high precision." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            operation: 'extract_keywords',
        });

        const content = response.choices[0].message.content;
        if (!content) return [];

        const parseResult = await parseWithRetry(content, KeywordsResponseSchema);
        if (parseResult.success) {
            return parseResult.data.keywords;
        }
        
        return [];
    } catch (error: unknown) {
        console.error("AI Keyword Error:", error);
        return [];
    }
}

function calculateDeterministicScore(resumeData: ResumeData, jobDescription: string) {
    const jdLower = jobDescription.toLowerCase();
    const resumeText = JSON.stringify(resumeData).toLowerCase();
    
    const jdWords = jdLower.split(/\W+/).filter(w => w.length > 3);
    const uniqueJdWords = [...new Set(jdWords)];
    
    const matchedWords = uniqueJdWords.filter(w => resumeText.includes(w));
    const keywordOverlap = uniqueJdWords.length > 0 
        ? (matchedWords.length / uniqueJdWords.length) * 100 
        : 0;
    
    const skillsLower = resumeData.skills.map(s => s.toLowerCase());
    const skillMatches = uniqueJdWords.filter(w => 
        skillsLower.some(s => s.includes(w) || w.includes(s))
    );
    const targetSkillCount = Math.min(15, uniqueJdWords.length);
    const skillsMatch = targetSkillCount > 0 
        ? (skillMatches.length / targetSkillCount) * 100 
        : 0;
    
    const hasExperience = resumeData.experience.length > 0;
    const hasProjects = resumeData.projects.length > 0;
    const hasSummary = resumeData.personalInfo.summary.length > 50;
    const hasSkills = resumeData.skills.length >= 5;
    const completeness = [hasExperience, hasProjects, hasSummary, hasSkills]
        .filter(Boolean).length * 25;
    
    return {
        keywordOverlap: Math.round(Math.min(100, keywordOverlap)),
        skillsMatch: Math.round(Math.min(100, skillsMatch)),
        completeness: Math.round(completeness),
        matchedWords: matchedWords.slice(0, 20),
    };
}

export async function calculateATSScore(
    resumeData: ResumeData,
    jobDescription: string,
    tracking?: { userId?: string; sessionId?: string; operation?: string }
): Promise<ATSScore> {
    if (!jobDescription || !resumeData) {
        return {
            overall: 0,
            breakdown: { keywordMatch: 0, skillsMatch: 0, experienceRelevance: 0, formattingScore: 0 },
            matchedKeywords: [],
            missingKeywords: [],
            suggestions: [],
        };
    }

    const deterministicScores = calculateDeterministicScore(resumeData, jobDescription);
    const resumeText = JSON.stringify(resumeData);

    const prompt = `Analyze this resume against the job description and provide an ATS compatibility score.

JOB DESCRIPTION:
${jobDescription}

RESUME DATA:
${resumeText}

Analyze and return a JSON object with:
1. "overall": A score from 0-100 representing overall ATS compatibility
2. "breakdown": {
   "keywordMatch": 0-100 (how many job keywords are in resume),
   "skillsMatch": 0-100 (technical skills alignment),
   "experienceRelevance": 0-100 (how relevant experience is),
   "formattingScore": 0-100 (assume good formatting, 80-95)
}
3. "matchedKeywords": Array of important keywords found in both
4. "missingKeywords": Array of important keywords from job NOT in resume
5. "suggestions": Array of 3-5 specific actionable suggestions to improve match

Be accurate and helpful. Output ONLY valid JSON.`;
    const userId = await resolveTrackingUserId(tracking?.userId);

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.atsScore,
            messages: [
                { role: "system", content: "You are an ATS simulator. Score resume relevance objectively and provide precise keyword gaps." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            sessionId: tracking?.sessionId,
            operation: tracking?.operation ?? 'ats_scoring',
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("No response");

        // Use Zod validation with repair capability
        const parseResult = await parseWithRetry(content, ATSScoreSchema);

        if (parseResult.success) {
            const validated = parseResult.data;
            
            const blendedKeywordMatch = Math.round(
                (deterministicScores.keywordOverlap * 0.3) + (validated.breakdown.keywordMatch * 0.7)
            );
            const blendedSkillsMatch = Math.round(
                (deterministicScores.skillsMatch * 0.3) + (validated.breakdown.skillsMatch * 0.7)
            );
            
            const blendedOverall = Math.round(
                (blendedKeywordMatch * 0.3) + 
                (blendedSkillsMatch * 0.25) + 
                (validated.breakdown.experienceRelevance * 0.35) + 
                (validated.breakdown.formattingScore * 0.1)
            );
            
            return {
                overall: Math.min(100, Math.max(0, blendedOverall)),
                breakdown: {
                    keywordMatch: blendedKeywordMatch,
                    skillsMatch: blendedSkillsMatch,
                    experienceRelevance: validated.breakdown.experienceRelevance,
                    formattingScore: validated.breakdown.formattingScore,
                },
                matchedKeywords: [...new Set([...deterministicScores.matchedWords, ...validated.matchedKeywords])].slice(0, 15),
                missingKeywords: validated.missingKeywords,
                suggestions: validated.suggestions,
            };
        } else {
            console.error("ATS Score Validation Error:", parseResult.error);
            throw new Error("Invalid ATS score format from AI");
        }
    } catch (error: unknown) {
        console.error("ATS Score Error:", error);
        throw new Error("Failed to calculate ATS score");
    }
}

export async function generateTailoredResume(
    jobDescription: string,
    existingData: ResumeData,
    githubRepos?: { name: string; description: string; language: string; url: string }[],
    knowledgeBullets?: string[],
    tracking?: { userId?: string; sessionId?: string }
): Promise<ResumeData> {
    const prompt = `Generate a tailored resume for this job description. Use the existing personal info and enhance/tailor the content.

JOB DESCRIPTION:
${jobDescription}

EXISTING RESUME DATA:
${JSON.stringify(existingData)}

${githubRepos?.length ? `GITHUB PROJECTS TO CONSIDER:\n${JSON.stringify(githubRepos)}` : ''}

${knowledgeBullets?.length ? `CANDIDATE'S ACHIEVEMENTS/BULLETS:\n${knowledgeBullets.join('\n')}` : ''}

Generate a complete resume JSON that:
1. Keeps the personalInfo intact (name, email, phone, etc) but improves the summary to match the job
2. Tailors experience descriptions to highlight relevant skills/achievements for this job
3. Selects and describes relevant projects (use GitHub repos if available)
4. Optimizes skills list to prioritize job-relevant skills first
5. Uses strong action verbs and quantifies achievements where possible

Output a valid JSON object matching this structure:
{
  "personalInfo": { fullName, title, email, phone, location, website, linkedin, github, summary },
  "experience": [{ id, company, role, startDate, endDate, current, location, description }],
  "projects": [{ id, name, description, url, liveUrl, repoUrl, technologies }],
  "education": [{ id, institution, degree, fieldOfStudy, startDate, endDate, current }],
  "skills": ["skill1", "skill2", ...],
  "sectionOrder": ["summary", "experience", "projects", "education", "skills"]
}

IMPORTANT: Keep education data as-is. Generate UUIDs for new items. Output ONLY valid JSON.`;
    const userId = await resolveTrackingUserId(tracking?.userId);

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.assembly,
            messages: [
                { role: "system", content: "You assemble ATS-friendly resumes using only provided factual data. Never fabricate achievements or metrics." },
                { role: "user", content: prompt },
            ],
        }, {
            userId,
            sessionId: tracking?.sessionId,
            operation: 'resume_assembly',
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("No response");

        // Use Zod validation with repair capability
        const parseResult = await parseWithRetry(content, ResumeDataSchema);

        if (parseResult.success) {
            const validated = parseResult.data;
            // Merge with existing data for fields that might be missing
            return {
                personalInfo: {
                    fullName: validated.personalInfo.fullName || existingData.personalInfo.fullName,
                    title: validated.personalInfo.title || existingData.personalInfo.title,
                    email: validated.personalInfo.email || existingData.personalInfo.email,
                    phone: validated.personalInfo.phone || existingData.personalInfo.phone,
                    location: validated.personalInfo.location || existingData.personalInfo.location,
                    website: validated.personalInfo.website || existingData.personalInfo.website,
                    linkedin: validated.personalInfo.linkedin || existingData.personalInfo.linkedin,
                    github: validated.personalInfo.github || existingData.personalInfo.github,
                    summary: validated.personalInfo.summary || existingData.personalInfo.summary,
                },
                experience: validated.experience.length > 0 ? validated.experience : existingData.experience,
                projects: validated.projects.length > 0 ? validated.projects : existingData.projects,
                education: validated.education.length > 0 ? validated.education : existingData.education,
                skills: validated.skills.length > 0 ? validated.skills : existingData.skills,
                sectionOrder: validated.sectionOrder || existingData.sectionOrder,
            };
        } else {
            console.error("Resume Validation Error:", parseResult.error);
            throw new Error("Invalid resume format from AI");
        }
    } catch (error: unknown) {
        console.error("Generate Resume Error:", error);
        throw new Error("Failed to generate tailored resume");
    }
}

export async function modifyLatex(currentCode: string, instruction: string) {
    const parsedInput = ModifyLatexInputSchema.safeParse({ currentCode, instruction });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }

    const prompt = `Task: Modify the Latex code based on the instruction.
Rule: Output ONLY the valid Latex code. Do not output markdown backticks. Do not output conversational text.
Instruction: ${parsedInput.data.instruction}

Current Code:
${parsedInput.data.currentCode}`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.general,
            messages: [{ role: "user", content: prompt }],
        }, {
            userId,
            operation: 'latex_modify',
        });

        const content = response.choices[0].message.content?.trim() || "";
        if (!content) return currentCode;

        const clean = content.replace(/^```latex\n/, '').replace(/^```\n/, '').replace(/```$/, '').trim();
        return clean;
    } catch (error: unknown) {
        console.error("AI Latex Error:", error);
        throw new Error("Failed to modify Latex code.");
    }
}

export async function resumeToLatex(resumeData: ResumeData): Promise<string> {
    const parsedInput = ResumeToLatexInputSchema.safeParse({ resumeData });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }

    const prompt = `Convert this resume data into a professional LaTeX resume document.

RESUME DATA:
${JSON.stringify(parsedInput.data.resumeData)}

Generate a complete, compilable LaTeX document with:
1. Clean professional formatting
2. Proper sections for Summary, Experience, Projects, Education, Skills
3. Use hyperlinks for email, linkedin, github, website
4. Modern ATS-friendly layout
5. Use fontawesome5 for icons if appropriate
6. Use proper itemize environments for bullet points

Output ONLY the raw LaTeX code. No markdown, no explanations.`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.general,
            messages: [{ role: "user", content: prompt }],
        }, {
            userId,
            operation: 'resume_to_latex',
        });

        const content = response.choices[0].message.content?.trim() || "";
        return content.replace(/^```latex\n/, '').replace(/^```\n/, '').replace(/```$/, '').trim();
    } catch (error: unknown) {
        console.error("Resume to LaTeX Error:", error);
        throw new Error("Failed to convert resume to LaTeX");
    }
}

export async function latexToResume(latexCode: string): Promise<ResumeData> {
    const parsedInput = LatexToResumeInputSchema.safeParse({ latexCode });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }

    const prompt = `Parse the following LaTeX resume document and extract all the information into a structured JSON format.

LATEX CODE:
${parsedInput.data.latexCode}

Extract and return a JSON object with this EXACT structure:
{
  "personalInfo": {
    "fullName": "string",
    "title": "string (job title/role)",
    "email": "string",
    "phone": "string",
    "location": "string",
    "website": "string (without https://)",
    "linkedin": "string (without https://)",
    "github": "string (without https://)",
    "summary": "string (professional summary paragraph)"
  },
  "experience": [
    {
      "id": "unique-id",
      "company": "string",
      "role": "string",
      "startDate": "string (e.g., Jan 2022)",
      "endDate": "string (empty if current)",
      "current": boolean,
      "location": "string",
      "description": "string (bullet points separated by newlines, each starting with •)"
    }
  ],
  "projects": [
    {
      "id": "unique-id",
      "name": "string",
      "description": "string",
      "url": "string",
      "liveUrl": "string",
      "repoUrl": "string",
      "technologies": ["array", "of", "tech"]
    }
  ],
  "education": [
    {
      "id": "unique-id",
      "institution": "string",
      "degree": "string",
      "fieldOfStudy": "string",
      "startDate": "string",
      "endDate": "string",
      "current": boolean
    }
  ],
  "skills": ["array", "of", "skills"],
  "sectionOrder": ["summary", "experience", "projects", "education", "skills"]
}

Important:
- Generate unique IDs for each item (use format like "exp-1", "proj-1", "edu-1")
- For experience descriptions, format bullet points with "• " prefix and "\\n" between them
- If a field is not found in the LaTeX, use an empty string or empty array
- Determine sectionOrder based on the order sections appear in the LaTeX

Output ONLY valid JSON, no markdown, no explanations.`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.general,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
        }, {
            userId,
            operation: 'latex_to_resume',
        });

        const content = response.choices[0].message.content?.trim() || "{}";
        const parsed = await parseWithRetry(content, ResumeDataSchema);
        if (!parsed.success) {
            throw new Error(parsed.error);
        }
        return parsed.data;
    } catch (error: unknown) {
        console.error("LaTeX to Resume Error:", error);
        throw new Error("Failed to parse LaTeX to resume data");
    }
}

export async function compileLatex(
    latexCode: string,
    tracking?: { userId?: string; sessionId?: string }
): Promise<{ success: boolean; pdfBase64?: string; error?: string; log?: string }> {
    if (!latexCode) {
        return { success: false, error: "No LaTeX code provided" };
    }

    const userId = await resolveTrackingUserId(tracking?.userId);
    const start = Date.now();
    try {
        const response = await fetch('https://latex.ytotech.com/builds/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                compiler: 'pdflatex',
                resources: [
                    {
                        main: true,
                        content: latexCode,
                    },
                ],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('LaTeX compilation failed:', response.status, errorText);

            let errorMessage = `Compilation failed (${response.status})`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.logs) {
                    const logLines = errorJson.logs.split('\n');
                    const errorLines = logLines.filter((line: string) =>
                        line.includes('!') || line.includes('Error') || line.includes('error')
                    ).slice(0, 10);
                    errorMessage = errorLines.join('\n') || errorMessage;
                }
            } catch (error: unknown) {
                void error;
                errorMessage = errorText.slice(0, 500);
            }

            await logUsageEvent({
                userId,
                sessionId: tracking?.sessionId,
                operation: 'latex_compile',
                provider: 'latex_api',
                model: 'pdflatex',
                latencyMs: Date.now() - start,
                status: 'failed',
                metadata: { error: errorMessage, statusCode: response.status },
            });
            return { success: false, error: errorMessage };
        }

        const pdfBuffer = await response.arrayBuffer();
        const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

        await logUsageEvent({
            userId,
            sessionId: tracking?.sessionId,
            operation: 'latex_compile',
            provider: 'latex_api',
            model: 'pdflatex',
            latencyMs: Date.now() - start,
            status: 'success',
            metadata: {
                fileSizeBytes: pdfBuffer.byteLength,
            },
        });

        return { success: true, pdfBase64 };
    } catch (error: unknown) {
        console.error('LaTeX compilation error:', error);
        await logUsageEvent({
            userId,
            sessionId: tracking?.sessionId,
            operation: 'latex_compile',
            provider: 'latex_api',
            model: 'pdflatex',
            latencyMs: Date.now() - start,
            status: 'failed',
            metadata: { error: error instanceof Error ? error.message : 'Unknown compilation error' },
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown compilation error'
        };
    }
}

export async function improveSection(
    sectionType: 'summary' | 'experience' | 'project' | 'skills',
    currentContent: string,
    jobDescription?: string,
    instruction?: string
): Promise<string> {
    const context = jobDescription ? `\n\nTARGET JOB DESCRIPTION:\n${jobDescription}` : '';
    const customInstruction = instruction ? `\n\nADDITIONAL INSTRUCTION: ${instruction}` : '';

    let basePrompt = '';
    switch (sectionType) {
        case 'summary':
            basePrompt = 'Rewrite this professional summary to be more impactful and tailored to the job.';
            break;
        case 'experience':
            basePrompt = 'Enhance these experience bullet points with strong action verbs, quantified results, and job-relevant keywords.';
            break;
        case 'project':
            basePrompt = 'Improve this project description to highlight technical skills and impact relevant to the job.';
            break;
        case 'skills':
            basePrompt = 'Optimize and expand this skills list to better match the job requirements.';
            break;
    }

    const prompt = `${basePrompt}${context}${customInstruction}

CURRENT CONTENT:
${currentContent}

Output ONLY the improved content. No explanations.`;
    const userId = await resolveTrackingUserId();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.general,
            messages: [{ role: "user", content: prompt }],
        }, {
            userId,
            operation: 'improve_section',
            metadata: { sectionType },
        });

        return response.choices[0].message.content?.trim() || currentContent;
    } catch (error: unknown) {
        console.error("Improve Section Error:", error);
        throw new Error("Failed to improve section");
    }
}
