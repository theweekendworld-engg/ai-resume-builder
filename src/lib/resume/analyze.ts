/**
 * Reading a finished resume against a posting, without rewriting it.
 *
 * `tailorResume` builds a document. This answers a narrower question about one
 * that already exists: which of the employer's stated requirements does this
 * resume answer, and which does it not?
 *
 * ── Why the free checker needed this ────────────────────────────────────────
 *
 * `/score` is the top of the funnel and it was measuring something the product
 * no longer believes in. Its "job match" was two lists of keywords the model
 * produced — matched and missing — which is precisely the keyword-overlap
 * thinking the 7 Aug audit found scoring a fabricated resume 95/100. Someone
 * would drop a PDF in, get a keyword report, sign up, and meet a completely
 * different and better analysis. The funnel has to promise what the product
 * delivers.
 *
 * ── What it shares, and what it does not ────────────────────────────────────
 *
 * Shares `readPosting`, `scoreBullets`, `chooseSkills` and `computeCoverage`
 * with generation — the same requirement model, the same evidence gate, the
 * same un-gameable score. So the free number and the paid number mean the same
 * thing, which is the whole point.
 *
 * Skips selection and writing entirely. Nothing is being cut and nothing is
 * being rewritten, so every line the candidate has counts toward coverage.
 */

import {
    computeCoverage,
    gapAdvice,
    reconcileSkillGaps,
    type CoverageReport,
} from './coverage';
import { readPosting, type PostingBrief } from './posting';
import { scoreBullets, type SourceBullet } from './select';
import { chooseSkills } from './skills';

/** Below this a line is a heading or a fragment, not a claim. */
const MIN_CLAIM_CHARS = 25;
/** Above this the PDF extractor has run two columns together. */
const MAX_CLAIM_CHARS = 400;
/** Ceiling on lines sent to the model. A resume with more is not a resume. */
const MAX_CLAIMS = 60;

/**
 * Pull the claim lines out of extracted resume text.
 *
 * PDF extraction gives one flat string with imperfect spacing, so this is
 * necessarily rougher than the structured path — there are no role boundaries
 * to trust. It errs toward including: a heading that slips through scores 0-1
 * and simply answers nothing, whereas a dropped achievement is a requirement
 * wrongly reported as a gap, which is the failure a candidate would notice.
 */
export function extractClaimLines(resumeText: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const raw of resumeText.replace(/\r\n/g, '\n').split('\n')) {
        const line = raw
            .replace(/^\s*[•●▪◦*\-–—]+\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (line.length < MIN_CLAIM_CHARS || line.length > MAX_CLAIM_CHARS) continue;
        // A line with no lowercase is a section heading in caps.
        if (!/[a-z]/.test(line)) continue;
        // Contact lines are not claims.
        if (/@|https?:\/\/|linkedin\.com|github\.com/i.test(line)) continue;

        const key = line.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
        if (out.length >= MAX_CLAIMS) break;
    }

    return out;
}

/**
 * Years of experience the document shows.
 *
 * Read off the years present in the text rather than any single "N years"
 * claim, so a requirement like "6+ years" is answered by the same evidence a
 * human reader would use. Deliberately conservative: a year that is really a
 * graduation date inflates this, so it is floored at the span between the
 * earliest plausible work year and now, and ignores anything before 1970.
 */
export function tenureFromText(resumeText: string, now: Date = new Date()): number {
    const years = [...resumeText.matchAll(/\b(19[7-9]\d|20[0-4]\d)\b/g)]
        .map((match) => Number.parseInt(match[1], 10))
        .filter((year) => year <= now.getUTCFullYear());
    if (years.length === 0) return 0;
    return Math.max(0, now.getUTCFullYear() - Math.min(...years));
}

export type ResumeAnalysis = {
    brief: PostingBrief;
    coverage: CoverageReport;
    /** Wanted by the posting, unevidenced anywhere in the resume. */
    skillGaps: string[];
    /** Wanted and evidenced. What the resume already proves. */
    skillsMatched: string[];
    advice: string[];
};

export async function analyzeAgainstPosting(params: {
    resumeText: string;
    jobDescription: string;
    userId: string;
    sessionId?: string;
}): Promise<ResumeAnalysis> {
    const { brief } = await readPosting({
        jobDescription: params.jobDescription,
        userId: params.userId,
        sessionId: params.sessionId,
    });

    const lines = extractClaimLines(params.resumeText);
    const bullets: SourceBullet[] = lines.map((text, index) => ({
        id: `l${index}`,
        groupId: 'resume',
        text,
    }));

    const scored = await scoreBullets({
        bullets,
        brief,
        userId: params.userId,
        sessionId: params.sessionId,
    });

    // Every line counts. Nothing is being selected away here, so unlike
    // generation there is no such thing as evidence that exists but did not
    // make the page.
    const coverage = computeCoverage(
        brief.requirements,
        scored,
        tenureFromText(params.resumeText),
    );

    const { skills: skillsMatched, gaps: skillGaps } = chooseSkills({
        wanted: brief.skills,
        corpus: params.resumeText,
        candidateSkills: [],
        // Only the posting's own list matters here — we are reporting on a
        // match, not composing a section, so the corpus-fill that generation
        // uses would add noise.
        max: brief.skills.length,
    });

    // The same reconciliation the editor's stored report applies, so the free
    // checker and the paid panel cannot disagree about the same resume.
    const reconciled = reconcileSkillGaps(skillGaps, brief.requirements);

    return {
        brief,
        coverage,
        skillGaps: reconciled,
        skillsMatched,
        advice: gapAdvice(coverage, reconciled),
    };
}
