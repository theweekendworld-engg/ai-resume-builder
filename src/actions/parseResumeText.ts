'use server';

import { z } from 'zod';
import { config } from '@/lib/config';
import { ResumeData } from '@/types/resume';
import { ResumeDataSchema, parseWithRetry } from '@/lib/aiSchemas';
import { trackedChatCompletion } from '@/lib/usageTracker';
import { requireAuth } from '@/lib/auth';

const ParseResumeTextInputSchema = z.object({
    text: z.string().min(1).max(60000),
});

/**
 * Parse raw resume text (e.g. the `extractedText` carried over from the
 * anonymous Phase 1 free checker) into structured `ResumeData`.
 *
 * Mirrors the `latexToResume` pattern in `src/actions/ai.ts`: authenticated,
 * tracked OpenAI call + zod validation against `ResumeDataSchema`. This is a
 * lightweight synchronous parse — it does NOT touch the heavy async generation
 * queue.
 */
export async function parseResumeText(text: string): Promise<ResumeData> {
    const parsedInput = ParseResumeTextInputSchema.safeParse({ text });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }

    const prompt = `Parse the following resume text (extracted from an uploaded resume) and extract all information into a structured JSON format.

RESUME TEXT:
${parsedInput.data.text}

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
      "id": "exp-1",
      "company": "string",
      "role": "string",
      "startDate": "string (e.g., Jan 2022)",
      "endDate": "string (empty if current)",
      "current": false,
      "location": "string",
      "description": "string (bullet points separated by newlines, each starting with •)"
    }
  ],
  "projects": [
    {
      "id": "proj-1",
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
      "id": "edu-1",
      "institution": "string",
      "degree": "string",
      "fieldOfStudy": "string",
      "startDate": "string",
      "endDate": "string",
      "current": false
    }
  ],
  "skills": ["array", "of", "skills"],
  "sectionOrder": ["summary", "experience", "projects", "education", "skills"]
}

Important:
- Use ONLY information present in the text. Do NOT fabricate experience, metrics, or skills.
- Generate unique IDs for each item (e.g. "exp-1", "proj-1", "edu-1").
- For experience and project descriptions, format bullet points with "• " prefix and "\\n" between them.
- If a field is not found, use an empty string or empty array.
- Determine sectionOrder based on the order sections appear in the text.

Output ONLY valid JSON, no markdown, no explanations.`;
    const userId = await requireAuth();

    try {
        const response = await trackedChatCompletion({
            model: config.openai.models.resumeParse,
            messages: [
                { role: 'system', content: 'You extract structured resume data from raw text accurately. Never invent facts, metrics, or tools that are not present in the source.' },
                { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
        }, {
            userId,
            operation: 'parse_resume_text',
        });

        const content = response.choices[0].message.content?.trim() || '{}';
        const parsed = await parseWithRetry(content, ResumeDataSchema);
        if (!parsed.success) {
            throw new Error(parsed.error);
        }
        return parsed.data;
    } catch (error: unknown) {
        console.error('Parse Resume Text Error:', error);
        throw new Error('Failed to parse resume text into structured data.');
    }
}
