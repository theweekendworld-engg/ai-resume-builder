'use server';

import OpenAI from 'openai';
import { config } from '@/lib/config';
import { ResumeData } from '@/types/resume';
import { ATSScore } from '@/store/resumeStore';

const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});

export async function improveText(text: string, type: 'summary' | 'bullet' | 'project', customInstruction?: string) {
    if (!text) return "";

    let basePrompt: string;
    if (type === 'summary') {
        basePrompt = `Rewrite the following professional summary to be more impactful, concise, and professional. Highlight key achievements if possible.`;
    } else if (type === 'project') {
        basePrompt = `Summarize the following project README or description into a concise resume bullet point. Include the technologies used and key achievements.`;
    } else {
        basePrompt = `Rewrite the following resume bullet point to use strong action verbs, quantify results if possible, and be more professional.`;
    }

    const instruction = customInstruction ? ` ${customInstruction}` : '';
    const prompt = `${basePrompt}${instruction}\n\nOutput ONLY the rewritten text, nothing else.\n\nText: "${text}"`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert resume writer. Always output only the requested content, never include instructions or meta-commentary." },
                { role: "user", content: prompt }
            ],
            max_tokens: 300,
            temperature: 0.7,
        });

        const content = response.choices[0].message.content?.trim() || text;
        return content.replace(/^(Summarize|Rewrite|Output|Bullet point|Here's|Here is):\s*/i, '').trim();
    } catch (error) {
        console.error("AI Error:", error);
        throw new Error("Failed to generate AI improvement.");
    }
}

export async function extractKeywords(jobDescription: string) {
    if (!jobDescription) return [];

    const prompt = `Extract the top 10-15 most important technical skills and keywords from the following job description. Output them as a JSON array of strings. Output ONLY the JSON.\n\nJob Description:\n${jobDescription}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert ATS keyword extractor." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
        });

        const content = response.choices[0].message.content;
        if (!content) return [];

        const parsed = JSON.parse(content);
        return parsed.keywords || parsed.skills || [];
    } catch (error) {
        console.error("AI Keyword Error:", error);
        return [];
    }
}

export async function calculateATSScore(resumeData: ResumeData, jobDescription: string): Promise<ATSScore> {
    if (!jobDescription || !resumeData) {
        return {
            overall: 0,
            breakdown: { keywordMatch: 0, skillsMatch: 0, experienceRelevance: 0, formattingScore: 0 },
            matchedKeywords: [],
            missingKeywords: [],
            suggestions: [],
        };
    }

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

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert ATS (Applicant Tracking System) analyzer. Provide accurate scoring and actionable feedback." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("No response");

        const result = JSON.parse(content);
        return {
            overall: Math.min(100, Math.max(0, result.overall || 0)),
            breakdown: {
                keywordMatch: result.breakdown?.keywordMatch || 0,
                skillsMatch: result.breakdown?.skillsMatch || 0,
                experienceRelevance: result.breakdown?.experienceRelevance || 0,
                formattingScore: result.breakdown?.formattingScore || 85,
            },
            matchedKeywords: result.matchedKeywords || [],
            missingKeywords: result.missingKeywords || [],
            suggestions: result.suggestions || [],
        };
    } catch (error) {
        console.error("ATS Score Error:", error);
        throw new Error("Failed to calculate ATS score");
    }
}

export async function generateTailoredResume(
    jobDescription: string, 
    existingData: ResumeData,
    githubRepos?: { name: string; description: string; language: string; url: string }[],
    knowledgeBullets?: string[]
): Promise<ResumeData> {
    const prompt = `Generate a tailored resume for this job description. Use the existing personal info and enhance/tailor the content.

JOB DESCRIPTION:
${jobDescription}

EXISTING RESUME DATA:
${JSON.stringify(existingData, null, 2)}

${githubRepos?.length ? `GITHUB PROJECTS TO CONSIDER:\n${JSON.stringify(githubRepos, null, 2)}` : ''}

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
  "projects": [{ id, name, description, url, technologies }],
  "education": [{ id, institution, degree, fieldOfStudy, startDate, endDate, current }],
  "skills": ["skill1", "skill2", ...],
  "sectionOrder": ["summary", "experience", "projects", "education", "skills"]
}

IMPORTANT: Keep education data as-is. Generate UUIDs for new items. Output ONLY valid JSON.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are an expert resume writer and ATS optimization specialist. Generate professional, tailored resumes." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.5,
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("No response");

        const result = JSON.parse(content);
        
        // Ensure all required fields exist
        return {
            personalInfo: {
                fullName: result.personalInfo?.fullName || existingData.personalInfo.fullName,
                title: result.personalInfo?.title || existingData.personalInfo.title,
                email: result.personalInfo?.email || existingData.personalInfo.email,
                phone: result.personalInfo?.phone || existingData.personalInfo.phone,
                location: result.personalInfo?.location || existingData.personalInfo.location,
                website: result.personalInfo?.website || existingData.personalInfo.website,
                linkedin: result.personalInfo?.linkedin || existingData.personalInfo.linkedin,
                github: result.personalInfo?.github || existingData.personalInfo.github,
                summary: result.personalInfo?.summary || existingData.personalInfo.summary,
            },
            experience: result.experience || existingData.experience,
            projects: result.projects || existingData.projects,
            education: result.education || existingData.education,
            skills: result.skills || existingData.skills,
            sectionOrder: result.sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills'],
        };
    } catch (error) {
        console.error("Generate Resume Error:", error);
        throw new Error("Failed to generate tailored resume");
    }
}

export async function modifyLatex(currentCode: string, instruction: string) {
    if (!currentCode) return "";

    const prompt = `Task: Modify the Latex code based on the instruction.
Rule: Output ONLY the valid Latex code. Do not output markdown backticks. Do not output conversational text.
Instruction: ${instruction}

Current Code:
${currentCode}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a Latex code generator. Return only the raw Latex code." },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
        });

        const content = response.choices[0].message.content?.trim() || "";
        if (!content) return currentCode;

        let clean = content.replace(/^```latex\n/, '').replace(/^```\n/, '').replace(/```$/, '').trim();
        return clean;
    } catch (error) {
        console.error("AI Latex Error:", error);
        throw new Error("Failed to modify Latex code.");
    }
}

export async function resumeToLatex(resumeData: ResumeData): Promise<string> {
    const prompt = `Convert this resume data into a professional LaTeX resume document.

RESUME DATA:
${JSON.stringify(resumeData, null, 2)}

Generate a complete, compilable LaTeX document with:
1. Clean professional formatting
2. Proper sections for Summary, Experience, Projects, Education, Skills
3. Use hyperlinks for email, linkedin, github, website
4. Modern ATS-friendly layout
5. Use fontawesome5 for icons if appropriate
6. Use proper itemize environments for bullet points

Output ONLY the raw LaTeX code. No markdown, no explanations.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a LaTeX expert. Generate clean, compilable LaTeX resume code." },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
        });

        const content = response.choices[0].message.content?.trim() || "";
        return content.replace(/^```latex\n/, '').replace(/^```\n/, '').replace(/```$/, '').trim();
    } catch (error) {
        console.error("Resume to LaTeX Error:", error);
        throw new Error("Failed to convert resume to LaTeX");
    }
}

export async function compileLatex(latexCode: string): Promise<{ success: boolean; pdfBase64?: string; error?: string; log?: string }> {
    if (!latexCode) {
        return { success: false, error: "No LaTeX code provided" };
    }

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
            } catch {
                errorMessage = errorText.slice(0, 500);
            }
            
            return { success: false, error: errorMessage };
        }

        const pdfBuffer = await response.arrayBuffer();
        const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
        
        return { success: true, pdfBase64 };
    } catch (error) {
        console.error('LaTeX compilation error:', error);
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

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert resume writer and ATS optimization specialist." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6,
        });

        return response.choices[0].message.content?.trim() || currentContent;
    } catch (error) {
        console.error("Improve Section Error:", error);
        throw new Error("Failed to improve section");
    }
}
