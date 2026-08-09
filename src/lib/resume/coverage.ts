/**
 * Scoring a resume by what it actually answers.
 *
 * ── Why the old score had to go ─────────────────────────────────────────────
 *
 * The ATS score was keyword overlap between the resume and the posting. Both
 * audit runs scored 95/100 while carrying ten fabricated skills, a mangled
 * title and two of the candidate's best lines missing. The number was not
 * merely uninformative — it was pointing the wrong way: the step that existed
 * to raise it (`improveResumeForLowAts`) raised it by stuffing the posting's
 * own words into the skills list, which is exactly what made the document
 * worse. The system was optimising against itself and reporting success.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 *
 * The share of the posting's stated requirements that are answered by a bullet
 * the candidate actually has. It cannot be gamed by adding keywords, because
 * the only way to move it is to surface real evidence — and if the evidence
 * does not exist, the honest move is the one this enables: name the gap.
 *
 * It also goes DOWN when the resume gets worse, which the old one could not do.
 * Drop the mentoring bullet and the mentoring requirement goes unanswered.
 *
 * Pure. No model, no clock.
 */

import type { JobRequirement } from './posting';
import type { ScoredBullet } from './bullet.types';

/**
 * A "nice to have" is worth less than a "must", but not nothing — a posting
 * that lists five bonus items is telling you something about the team. 0.4 is
 * a judgement, not a measurement, and it is here as one number rather than
 * spread through the scoring so it can be argued with in one place.
 */
export const NICE_WEIGHT = 0.4;
export const MUST_WEIGHT = 1;
/**
 * A stated duty sits between the two. "What you'll do" is what the job IS —
 * closer to a must than to a bonus — but it is not phrased as a bar to clear,
 * so it does not weigh the same as one.
 */
export const RESPONSIBILITY_WEIGHT = 0.7;

export type AnsweredRequirement = {
    requirement: JobRequirement;
    /** Bullets evidencing it. Empty when the DATES answer it. */
    bulletIds: string[];
    /**
     * Where the evidence came from.
     *
     *   page        — a bullet that is on the generated resume
     *   credential  — the education or skills section
     *   dates       — the resume's own date range, for a tenure requirement
     *   cut         — a line the candidate HAS that did not fit
     */
    via: 'page' | 'credential' | 'dates' | 'cut';
};

/**
 * Everything on the resume that can answer a requirement.
 *
 * `cut` and `credentials` both exist because of the same defect, found twice.
 *
 * Coverage used to take `keptBullets` and nothing else, and it was computed
 * AFTER selection capped each role at four bullets. So a line the candidate
 * wrote, which answers a stated must, and which we removed for space, was
 * indistinguishable downstream from a line that never existed. A live run for
 * a marketing candidate cut "Manage a team of three and a £1.2M annual budget"
 * and then told her, in the gap report, that nothing on her resume answered
 * "Experience managing and developing marketers".
 *
 * That is the most damaging thing this product can do. It is not a missed
 * optimisation — it manufactures a false negative about the customer's own
 * career and presents it as analysis.
 *
 * `credentials` is the same shape of error one section over: coverage read
 * bullets only, so a career switcher holding a BS was told "Nothing on your
 * resume answers: 'Bachelor's degree in any field'", and was told she lacked
 * "Working knowledge of SQL" while SQL sat in the skills section of the very
 * document being scored.
 */
export type CoverageEvidence = {
    /** Bullets that made the page. */
    kept: readonly ScoredBullet[];
    /** Scored, answers something, did not fit. The most actionable finding. */
    cut?: readonly ScoredBullet[];
    /** Education entries and listed skills. On the page, never selectable. */
    credentials?: readonly ScoredBullet[];
};

export type CoverageReport = {
    /**
     * 0–100, or null when the posting yielded no requirements to score
     * against. Null rather than 0: "we could not read this posting" and "this
     * resume answers nothing" are different facts, and showing 0 for the first
     * would be the same class of lie the old score told.
     *
     * Counts what is ON THE PAGE. A requirement answered only by a line we cut
     * is not answered by the document the employer receives, and inflating the
     * score with it would remove the reason to act on it.
     */
    score: number | null;
    answered: AnsweredRequirement[];
    /**
     * "You have this, it did not fit." Reported separately and first, because
     * it is the one category the candidate can close in a single click — the
     * evidence already exists and the editor can put it back.
     */
    answeredByCut: AnsweredRequirement[];
    unanswered: JobRequirement[];
    /** Musts only — the number that actually predicts a callback. */
    mustScore: number | null;
};

/**
 * Years a requirement asks for, if it asks for any.
 *
 * "6+ years building backend systems" is answered by the dates on the page,
 * not by any single bullet — no line says "I have six years of experience".
 * Without this the first live v2 run told a candidate with eight years of
 * listed roles that nothing on their resume answered a six-year requirement,
 * which is both wrong and the kind of wrong that makes a user distrust
 * everything else the tool says.
 */
export function yearsAskedFor(requirement: JobRequirement): number | null {
    const match = /(\d{1,2})\s*\+?\s*(?:or more\s*)?(?:years|yrs)/i.exec(requirement.text);
    if (!match) return null;
    const years = Number.parseInt(match[1], 10);
    return Number.isFinite(years) ? years : null;
}

export function computeCoverage(
    requirements: readonly JobRequirement[],
    evidence: CoverageEvidence | readonly ScoredBullet[],
    /** Total years the resume's own date range shows. */
    tenureYears = 0,
): CoverageReport {
    // An array still means "the bullets that made the page", so the callers
    // that only have those keep working and simply get no `answeredByCut`.
    const sources: CoverageEvidence = Array.isArray(evidence)
        ? { kept: evidence as readonly ScoredBullet[] }
        : (evidence as CoverageEvidence);

    const kept = sources.kept ?? [];
    const cut = sources.cut ?? [];
    const credentials = sources.credentials ?? [];

    if (requirements.length === 0) {
        return { score: null, answered: [], answeredByCut: [], unanswered: [], mustScore: null };
    }

    const answered: AnsweredRequirement[] = [];
    const answeredByCut: AnsweredRequirement[] = [];
    const unanswered: JobRequirement[] = [];

    const idsAnswering = (pool: readonly ScoredBullet[], requirementId: string) =>
        pool.filter((bullet) => bullet.answers.includes(requirementId)).map((bullet) => bullet.id);

    for (const requirement of requirements) {
        const onPage = idsAnswering(kept, requirement.id);
        if (onPage.length > 0) {
            answered.push({ requirement, bulletIds: onPage, via: 'page' });
            continue;
        }

        // The education and skills sections are part of the document. A degree
        // requirement is answered by the degree, not by a bullet about it.
        const byCredential = idsAnswering(credentials, requirement.id);
        if (byCredential.length > 0) {
            answered.push({ requirement, bulletIds: byCredential, via: 'credential' });
            continue;
        }

        // The dates answer a tenure requirement even when no bullet does — but
        // ONLY when time served is the whole of what was asked. See
        // `JobRequirement.satisfiedByTenure`.
        const asked = yearsAskedFor(requirement);
        if (requirement.satisfiedByTenure && asked !== null && tenureYears >= asked) {
            answered.push({ requirement, bulletIds: [], via: 'dates' });
            continue;
        }

        // Last: do they have it, just not on this version of the page?
        const byCut = idsAnswering(cut, requirement.id);
        if (byCut.length > 0) {
            answeredByCut.push({ requirement, bulletIds: byCut, via: 'cut' });
            continue;
        }

        unanswered.push(requirement);
    }

    const weight = (requirement: JobRequirement) => {
        if (requirement.kind === 'must') return MUST_WEIGHT;
        if (requirement.kind === 'responsibility') return RESPONSIBILITY_WEIGHT;
        return NICE_WEIGHT;
    };

    const total = requirements.reduce((sum, r) => sum + weight(r), 0);
    const got = answered.reduce((sum, a) => sum + weight(a.requirement), 0);

    const musts = requirements.filter((r) => r.kind === 'must');
    const mustsAnswered = answered.filter((a) => a.requirement.kind === 'must');

    return {
        score: Math.round((got / total) * 100),
        answered,
        answeredByCut,
        unanswered,
        mustScore: musts.length === 0 ? null : Math.round((mustsAnswered.length / musts.length) * 100),
    };
}

/**
 * Drop skill gaps the requirement list already covers.
 *
 * Lives here because BOTH consumers need it and the first version did not:
 * the editor's stored report filtered gaps, and `/score` did not, so the free
 * checker showed "Experience with cloud infrastructure (AWS)" under ANSWERED
 * and "AWS" under NOT IN YOUR RESUME at the same time. Two copies of a rule is
 * one copy of a rule and one bug.
 *
 * Two ways a gap is redundant:
 *
 *   Contradicted — the skill is named inside a requirement the resume ANSWERS.
 *   The requirement is the stronger signal: it is a judgement about the
 *   candidate's actual work, where the skill check is a string match against
 *   their text. Saying both makes the report look broken.
 *
 *   Restated — the skill is named inside a requirement the resume does NOT
 *   answer. True, but the requirement row already says it in the employer's own
 *   fuller words, and saying it twice reads as two separate problems.
 *
 * What survives is the genuinely additive case: a skill the posting names that
 * never became a requirement at all.
 */
export function reconcileSkillGaps(
    skillGaps: readonly string[],
    requirements: readonly { text: string }[],
): string[] {
    return skillGaps.filter((skill) => {
        const needle = skill.trim().toLowerCase();
        if (!needle) return false;
        const escaped = needle.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
        const pattern = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
        return !requirements.some((requirement) => pattern.test(requirement.text));
    });
}

/**
 * What to tell the candidate, in their own interest.
 *
 * ── Why this was rewritten ──────────────────────────────────────────────────
 *
 * Every gap report generated in the 8 Aug audit was 100% negative: five lines
 * of "nothing answers", "not covered", "left off", with no positive summary
 * and no next action. For a career switcher — the customer with the least
 * confidence and the most to gain — the entire advice block was five rejections
 * in a row, and three of them were factually wrong.
 *
 * The same computation supports a far better artifact, and it is the version
 * that gets shared:
 *
 *   "You answer 7 of 9 must-haves. Two more are answered by lines we had to
 *    cut — put them back. One real gap: SQL."
 *
 * So the order is: what you have, what you have that did not fit, what is
 * genuinely missing. Opening with the score is not flattery; a candidate
 * deciding whether to spend an evening on this needs to know whether they are
 * close.
 *
 * The wording still quotes the posting rather than paraphrasing it, because
 * they need the employer's actual words, not our summary of them.
 */
export function gapAdvice(report: CoverageReport, unevidencedSkills: readonly string[]): string[] {
    const advice: string[] = [];

    const musts = report.answered.filter((a) => a.requirement.kind === 'must').length;
    const totalMusts =
        musts +
        report.answeredByCut.filter((a) => a.requirement.kind === 'must').length +
        report.unanswered.filter((r) => r.kind === 'must').length;

    // Lead with where they stand. Silent when the posting stated no must-haves
    // — a made-up denominator would be its own small lie.
    if (totalMusts > 0) {
        advice.push(`You answer ${musts} of ${totalMusts} must-haves on this posting.`);
    }

    // The closable ones, first, because they are the only category where the
    // evidence already exists and the fix is one click in the editor.
    for (const item of report.answeredByCut) {
        advice.push(
            `You have this and it did not fit: “${item.requirement.text}” — put the line back to cover it.`,
        );
    }

    for (const requirement of report.unanswered.filter((r) => r.kind === 'must')) {
        advice.push(`Nothing on your resume answers: “${requirement.text}”`);
    }

    if (unevidencedSkills.length > 0) {
        advice.push(
            `The posting asks for ${unevidencedSkills.join(', ')}. Your history does not mention ${
                unevidencedSkills.length === 1 ? 'it' : 'them'
            }, so ${unevidencedSkills.length === 1 ? 'it was' : 'they were'} left off.`,
        );
    }

    for (const requirement of report.unanswered.filter((r) => r.kind === 'responsibility')) {
        advice.push(`The role involves this and your resume does not show it: “${requirement.text}”`);
    }

    for (const requirement of report.unanswered.filter((r) => r.kind === 'nice')) {
        advice.push(`Bonus, not covered: “${requirement.text}”`);
    }

    return advice;
}
