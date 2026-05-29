import OpenAI from 'openai';
import { config } from '@/lib/config';
import {
    AnonScoreModelSchema,
    AnonScoreReportSchema,
    deriveBand,
    type AnonScoreReport,
} from '@/lib/anonScoreSchema';

/**
 * Anonymous, auth-free resume scoring.
 *
 * This deliberately does NOT use `trackedChatCompletion` (which requires a
 * userId for usage logging) or `calculateATSScore` (which calls requireAuth and
 * returns 0 with no JD). It talks to the raw OpenAI client and validates with zod.
 *
 * Privacy: callers must pass already-extracted text. Nothing here is persisted.
 */

// Reuse the same construction pattern as src/lib/usageTracker.ts.
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const MAX_RESUME_CHARS = 16000;
const MAX_JD_CHARS = 6000;

const SYSTEM_PROMPT = `You are an expert resume reviewer and ATS (Applicant Tracking System) simulator.
You give specific, actionable, encouraging feedback. You never shame the candidate.
Your fixes quote the candidate's actual text and offer concrete rewrites — never generic advice.
You only reference content that is actually present in the resume; you never invent metrics, tools, or experience.`;

function buildPrompt(resumeText: string, jobDescription?: string): string {
    const trimmedResume = resumeText.slice(0, MAX_RESUME_CHARS);
    const jd = jobDescription?.trim().slice(0, MAX_JD_CHARS);

    const jobMatchInstruction = jd
        ? `A target JOB DESCRIPTION was provided. Score keyword/skills alignment against it, and you MUST include a "jobMatch" object with:
- "matchedKeywords": important keywords/skills present in BOTH the job description and resume.
- "missingKeywords": important keywords/skills in the job description that are MISSING from the resume.

JOB DESCRIPTION:
${jd}
`
        : `No job description was provided. Score general resume quality and ATS-readiness. Do NOT include a "jobMatch" field.`;

    return `Analyze the following resume (extracted from a PDF; spacing may be imperfect) and return a JSON object.

${jobMatchInstruction}

RESUME TEXT:
"""
${trimmedResume}
"""

Return ONLY a JSON object with this exact shape:
{
  "overall": <integer 0-100, overall resume quality / ATS readiness>,
  "dimensions": [
    { "key": "keywords", "label": "Keywords", "score": <0-100>, "note": "<one specific sentence>" },
    { "key": "impact_metrics", "label": "Impact & Metrics", "score": <0-100>, "note": "<one specific sentence>" },
    { "key": "formatting_parseability", "label": "Formatting & Parseability", "score": <0-100>, "note": "<one specific sentence>" },
    { "key": "length_structure", "label": "Length & Structure", "score": <0-100>, "note": "<one specific sentence>" },
    { "key": "contact_completeness", "label": "Contact Completeness", "score": <0-100>, "note": "<one specific sentence>" }
  ],
  "fixes": [
    {
      "priority": "high" | "medium" | "low",
      "title": "<short fix title>",
      "problem": "<the specific issue, quoting the offending text from the resume where possible>",
      "suggestion": "<a concrete rewrite, e.g. \\"Built API\\" -> \\"Built API serving 2M req/day, cutting p99 latency 40%\\">"
    }
  ]${jd ? ',\n  "jobMatch": { "matchedKeywords": [..], "missingKeywords": [..] }' : ''}
}

Rules:
- Provide 3 to 6 fixes, sorted by priority (high first). Each must be specific to THIS resume.
- "problem" must quote or closely paraphrase real text from the resume, not invent issues.
- "suggestion" must be a concrete, copy-pasteable rewrite, never "add more metrics".
- Tone: confident and encouraging. Output ONLY valid JSON, no markdown fences.`;
}

export async function scoreResumeText(
    resumeText: string,
    jobDescription?: string
): Promise<AnonScoreReport> {
    if (!resumeText || resumeText.trim().length < 30) {
        throw new Error('Resume text is too short to score. The PDF may be image-only or empty.');
    }

    const response = await openai.chat.completions.create({
        model: config.openai.models.atsScore,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildPrompt(resumeText, jobDescription) },
        ],
        response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('No response from scoring model.');
    }

    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch {
        throw new Error('Scoring model returned invalid JSON.');
    }

    const parsed = AnonScoreModelSchema.safeParse(json);
    if (!parsed.success) {
        throw new Error('Scoring model returned an unexpected format.');
    }

    // Derive band server-side so tone/thresholds stay consistent.
    const overall = Math.min(100, Math.max(0, parsed.data.overall));
    const report = AnonScoreReportSchema.parse({
        ...parsed.data,
        overall,
        band: deriveBand(overall),
        // Drop jobMatch if no JD was supplied (defensive — model may hallucinate it).
        jobMatch: jobDescription?.trim() ? parsed.data.jobMatch : undefined,
    });

    return report;
}
