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
import type { ScoredBullet } from './select';

/**
 * A "nice to have" is worth less than a "must", but not nothing — a posting
 * that lists five bonus items is telling you something about the team. 0.4 is
 * a judgement, not a measurement, and it is here as one number rather than
 * spread through the scoring so it can be argued with in one place.
 */
export const NICE_WEIGHT = 0.4;
export const MUST_WEIGHT = 1;

export type AnsweredRequirement = {
    requirement: JobRequirement;
    /** Kept bullets evidencing it. Empty when the DATES answer it. */
    bulletIds: string[];
};

export type CoverageReport = {
    /**
     * 0–100, or null when the posting yielded no requirements to score
     * against. Null rather than 0: "we could not read this posting" and "this
     * resume answers nothing" are different facts, and showing 0 for the first
     * would be the same class of lie the old score told.
     */
    score: number | null;
    answered: AnsweredRequirement[];
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
    keptBullets: readonly ScoredBullet[],
    /** Total years the resume's own date range shows. */
    tenureYears = 0,
): CoverageReport {
    if (requirements.length === 0) {
        return { score: null, answered: [], unanswered: [], mustScore: null };
    }

    const answered: AnsweredRequirement[] = [];
    const unanswered: JobRequirement[] = [];

    for (const requirement of requirements) {
        const bulletIds = keptBullets
            .filter((bullet) => bullet.answers.includes(requirement.id))
            .map((bullet) => bullet.id);

        if (bulletIds.length > 0) {
            answered.push({ requirement, bulletIds });
            continue;
        }

        // The dates answer a tenure requirement even when no bullet does.
        const asked = yearsAskedFor(requirement);
        if (asked !== null && tenureYears >= asked) {
            // No bullet ids: nothing on the page "says" it, the date range
            // shows it. The editor renders this differently for that reason.
            answered.push({ requirement, bulletIds: [] });
            continue;
        }

        unanswered.push(requirement);
    }

    const weight = (requirement: JobRequirement) =>
        requirement.kind === 'must' ? MUST_WEIGHT : NICE_WEIGHT;

    const total = requirements.reduce((sum, r) => sum + weight(r), 0);
    const got = answered.reduce((sum, a) => sum + weight(a.requirement), 0);

    const musts = requirements.filter((r) => r.kind === 'must');
    const mustsAnswered = answered.filter((a) => a.requirement.kind === 'must');

    return {
        score: Math.round((got / total) * 100),
        answered,
        unanswered,
        mustScore: musts.length === 0 ? null : Math.round((mustsAnswered.length / musts.length) * 100),
    };
}

/**
 * What to tell the candidate, in their own interest.
 *
 * Ordered by what would move the number most: unanswered musts first. The
 * wording quotes the posting rather than paraphrasing it, because a candidate
 * deciding whether to spend an evening on this needs to see the employer's
 * actual words, not our summary of them.
 */
export function gapAdvice(report: CoverageReport, unevidencedSkills: readonly string[]): string[] {
    const advice: string[] = [];

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

    for (const requirement of report.unanswered.filter((r) => r.kind === 'nice')) {
        advice.push(`Bonus, not covered: “${requirement.text}”`);
    }

    return advice;
}
