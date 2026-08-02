/**
 * Anonymous, auth-free resume scoring — the public `/score` funnel.
 *
 * ── Why this went through `generateStructured` ──────────────────────────────
 *
 * This used to hold its own `new OpenAI(...)` client and hand-roll the JSON
 * parse. That made it the only model call in the product reachable by someone
 * who is not signed in, and it had none of the four things every other call
 * gets: schema-validated retry, per-feature cost tagging, an `ApiUsageLog`
 * line, and the numeric guard.
 *
 * The cost tag matters most here precisely because the caller is anonymous.
 * Every other surface bills a known user, so runaway spend shows up under
 * someone's name; this one is a stranger with a rate limit, and until now it
 * was invisible to the per-feature tripwire in PRD 08 §4.3. Anonymous spend is
 * logged under {@link ANON_USER_ID} — one bucket, deliberately, because the
 * only alternative key is the caller's IP and this route's contract is that
 * nothing about the person is persisted.
 *
 * ── Why the guard matters more here than almost anywhere ────────────────────
 *
 * A "suggested rewrite" is the single most dangerous string this product
 * produces. It is offered to a stranger, formatted for copying, and its whole
 * promise is that it is better than what they wrote. If the model invents
 * "serving 2M req/day" the user pastes a lie into their own resume and takes
 * it to an interview.
 *
 * The old prompt did not merely permit that — it demonstrated it, using
 * `"Built API" -> "Built API serving 2M req/day, cutting p99 latency 40%"` as
 * the worked example of a good suggestion. Both figures are invented out of
 * three words of input. The prompt now asks for `[bracketed placeholders]`
 * where a real figure belongs, which is both honest and more useful: it tells
 * the candidate exactly which number to go find.
 *
 * Privacy: callers must pass already-extracted text. Nothing here is persisted.
 */

import { generateStructured } from '@/lib/ai/structured';
import type { NumericGuard } from '@/lib/ai/guard';
import {
    AnonScoreModelSchema,
    deriveBand,
    MAX_FIXES,
    type AnonScoreReport,
    type ScoreFix,
} from '@/lib/anonScoreSchema';

/**
 * The `ApiUsageLog.userId` every anonymous score is billed to.
 *
 * The column is a plain string with no foreign key, so this is safe — and it
 * gives the cost query a single row to watch for the one surface that can be
 * driven by someone with no account.
 */
export const ANON_USER_ID = 'anon';

const MAX_RESUME_CHARS = 16000;
const MAX_JD_CHARS = 6000;

const SYSTEM_PROMPT = `You are an expert resume reviewer and ATS (Applicant Tracking System) simulator.
You give specific, actionable, encouraging feedback. You never shame the candidate.
Your fixes quote the candidate's actual text and offer concrete rewrites.

You never invent facts. This is absolute, and it applies hardest to the numbers
in a suggested rewrite: the candidate will paste that line into their resume and
defend it in an interview. If a rewrite needs a figure the resume does not
contain, write a bracketed placeholder naming the figure to go find — for
example "cut p95 latency by [X]%" or "serving [N] requests/day" — never a
plausible-looking number you made up. A placeholder is useful advice. A
fabricated metric is a trap.`;

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

    return `Analyze the following resume (extracted from a PDF; spacing may be imperfect).

${jobMatchInstruction}

RESUME TEXT:
"""
${trimmedResume}
"""

Score these five dimensions, each 0-100 with one specific sentence of justification:
- keywords ("Keywords")
- impact_metrics ("Impact & Metrics")
- formatting_parseability ("Formatting & Parseability")
- length_structure ("Length & Structure")
- contact_completeness ("Contact Completeness")

Then give an "overall" score 0-100 for resume quality / ATS readiness.

Rules for fixes:
- Provide 3 to 6 fixes, sorted by priority (high first). Each must be specific to THIS resume.
- "problem" must quote or closely paraphrase real text from the resume, not invent issues.
- "suggestion" must be a concrete, copy-pasteable rewrite, never "add more metrics".
- Every number, percentage, duration and currency amount you write must already
  appear in the resume text above. Where a rewrite would be stronger with a
  figure the resume does not have, write a bracketed placeholder — "[X]%",
  "[N] users", "[$Y] saved" — so the candidate knows what to fill in.
- Tone: confident and encouraging.`;
}

/**
 * What the guard polices, and — more interestingly — what it does not.
 *
 * Only `suggestion`. That is the one string here written to be pasted into the
 * candidate's own resume, so a number in it is a claim they will have to
 * defend. Everything else on this screen is commentary they read once.
 *
 * The distinction is not fussiness; guarding the commentary actively makes the
 * product worse. A dimension note or a problem statement counts features of the
 * document — "two of four roles carry a figure", "only 3 of your 8 bullets are
 * quantified" — and those counts are true statements about the resume that do
 * not appear IN the resume. Policing them would flag correct analysis and spend
 * a corrective round-trip on nearly every score. A count of the evidence is not
 * a claim about the evidence.
 *
 * The guard takes literal paths with no wildcard, so the list is enumerated to
 * {@link MAX_FIXES}; a missing index is simply skipped. The two constants are
 * tied together in `anonScoreSchema.ts` so the tail of a longer list cannot
 * quietly escape.
 *
 * The job description joins the source text because a candidate legitimately
 * echoes figures from the posting they are targeting ("5+ years", "team of
 * 12"). Extra source material can only ever permit a match, never create a
 * violation.
 */
function buildGuard(resumeText: string, jobDescription?: string): NumericGuard {
    return {
        sourceText: [resumeText.slice(0, MAX_RESUME_CHARS), jobDescription?.slice(0, MAX_JD_CHARS) ?? '']
            .join('\n'),
        fields: Array.from({ length: MAX_FIXES }, (_, i) => `fixes.${i}.suggestion`),
    };
}

/**
 * A fix the guard has hollowed out is worse than no fix.
 *
 * `stripViolations` blanks the offending string rather than deleting the object
 * around it, which for a fix means a card that says "Suggested rewrite" over
 * empty space. Drop those; the remaining fixes are still real advice.
 */
function isIntact(fix: ScoreFix): boolean {
    return fix.suggestion.trim().length > 0;
}

export async function scoreResumeText(
    resumeText: string,
    jobDescription?: string
): Promise<AnonScoreReport> {
    if (!resumeText || resumeText.trim().length < 30) {
        throw new Error('Resume text is too short to score. The PDF may be image-only or empty.');
    }

    const { data } = await generateStructured({
        task: 'atsScore',
        feature: 'resume',
        userId: ANON_USER_ID,
        schema: AnonScoreModelSchema,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(resumeText, jobDescription),
        guard: buildGuard(resumeText, jobDescription),
    });

    // Derive band server-side so tone/thresholds stay consistent.
    const overall = Math.min(100, Math.max(0, data.overall));

    return {
        ...data,
        overall,
        band: deriveBand(overall),
        fixes: data.fixes.filter(isIntact),
        // Drop jobMatch if no JD was supplied (defensive — the model may return
        // one anyway, and a "missing keywords" list with no job to miss them
        // from is noise).
        jobMatch: jobDescription?.trim() ? data.jobMatch : undefined,
    };
}
