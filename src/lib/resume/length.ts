/**
 * How long the document is allowed to be.
 *
 * Lives here rather than in `generateResume.ts` because that file is
 * `'use server'` and may only export async functions — so this could not be
 * tested where it was, which is part of how it came to do almost nothing.
 */

/** Roles on a one-page resume. Two pages earns more; see below. */
export const MAX_EXPERIENCES = 4;

export type LengthConstraints = {
    maxExperiences: number;
    maxProjects: number;
    maxSkills: number;
    maxBulletsPerRole: number;
};

/**
 * How much document the target length actually buys.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * Choosing "2-page" changed almost nothing. Both branches returned the same
 * `maxExperiences` — the single `MAX_EXPERIENCES = 4` — so the only
 * difference between a one-page and a two-page resume was one extra project
 * and five more skills. A candidate with eight years and six roles got four
 * roles either way, on a document they had explicitly asked to be twice as
 * long.
 *
 * Worse, `maxBulletsPerRole` was not here at all: the v2 call site passed a
 * hardcoded `4`, so the length preference could not reach the one cap that
 * decides how much of each role survives. That is the cap the coverage report
 * then blames for a dropped line.
 *
 * A strong two-page resume — the reference this was measured against — runs
 * four roles at 4/4/2/2 bullets plus three projects. The numbers below give
 * that room without inviting padding: more bullets are ALLOWED, not required,
 * and selection still only keeps lines that earn their place.
 */
export function resolveLengthConstraints(targetLength: '1-page' | '2-page' | 'auto', yearsExperience: number): LengthConstraints {
  const resolved = targetLength === 'auto'
    ? (yearsExperience >= 5 ? '2-page' : '1-page')
    : targetLength;

  if (resolved === '1-page') {
    return {
      maxExperiences: MAX_EXPERIENCES,
      maxProjects: 3,
      maxSkills: 15,
      maxBulletsPerRole: 4,
    };
  }

  return {
    maxExperiences: MAX_EXPERIENCES + 2,
    maxProjects: 4,
    maxSkills: 20,
    maxBulletsPerRole: 5,
  };
}
