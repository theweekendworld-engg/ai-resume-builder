/**
 * The fit score and skill matcher, with NO server-action imports.
 *
 * These lived in `analyze.ts`, which imports `parseJobDescription` from a
 * `'use server'` module. That was harmless until Scout's fit and Radar's comp
 * band ran inside workflow steps: the step bundler follows every import, and
 * a `'use server'` file inlined into a step route fails the build ("Server
 * Actions must be async functions"). Pure scoring belongs in a pure module;
 * `analyze.ts` re-exports both names so nothing else had to move.
 */

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeText(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(trimmed);
  }

  return output;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function findMatchedSkills(skills: string[], corpus: string): string[] {
  return uniqueStrings(skills).filter((skill) => {
    const normalized = normalizeText(skill);
    return Boolean(normalized) && corpus.includes(normalized);
  });
}

/**
 * The fit score, extracted so Radar's batch matcher can share it.
 *
 * PRD 04 §4 is explicit that Radar must not write a second matcher, and the
 * part worth sharing is exactly this — the ratio weighting that turns matched
 * skills into a 20-95 score. What Radar does NOT reuse is the AI job-
 * description parse above it: Radar matches against thousands of stored
 * postings whose skills were already extracted deterministically at ingest, so
 * re-parsing each one with a model would cost thousands of calls per user and
 * break Radar's no-model rule for the same answer.
 *
 * One scoring function, two ways of obtaining its inputs.
 */
export function computeFitScore(params: {
  requiredSkills: string[];
  preferredSkills: string[];
  corpus: string;
}): { fitScore: number; matchedRequired: string[]; matchedPreferred: string[]; missingRequired: string[] } {
  const requiredSkills = uniqueStrings(params.requiredSkills);
  const preferredSkills = uniqueStrings(params.preferredSkills);

  const matchedRequired = findMatchedSkills(requiredSkills, params.corpus);
  const matchedPreferred = findMatchedSkills(preferredSkills, params.corpus);
  const missingRequired = requiredSkills.filter((skill) => !matchedRequired.includes(skill));

  // An absent skill list scores 0.5 rather than 0 or 1: we know nothing, and
  // both extremes would be a claim.
  const requiredRatio = requiredSkills.length > 0 ? matchedRequired.length / requiredSkills.length : 0.5;
  const preferredRatio = preferredSkills.length > 0 ? matchedPreferred.length / preferredSkills.length : 0.5;
  const fitScore = clamp(Math.round(requiredRatio * 80 + preferredRatio * 20), 20, 95);

  return { fitScore, matchedRequired, matchedPreferred, missingRequired };
}

