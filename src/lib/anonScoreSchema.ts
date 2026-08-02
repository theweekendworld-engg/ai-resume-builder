import { z } from 'zod';

/**
 * Schema + types for the anonymous (no-login) resume ATS/quality score report.
 * Kept separate from `aiSchemas.ts` (which is auth-bound) so the anonymous path
 * has no dependency on the authenticated scoring engine.
 */

export const ScoreBandSchema = z.enum(['needs_work', 'good', 'strong']);
export type ScoreBand = z.infer<typeof ScoreBandSchema>;

export const DIMENSION_KEYS = [
    'keywords',
    'impact_metrics',
    'formatting_parseability',
    'length_structure',
    'contact_completeness',
] as const;

export const ScoreDimensionSchema = z.object({
    key: z.enum(DIMENSION_KEYS),
    label: z.string(),
    score: z.number().int().min(0).max(100),
    note: z.string(),
});
export type ScoreDimension = z.infer<typeof ScoreDimensionSchema>;

export const ScoreFixSchema = z.object({
    priority: z.enum(['high', 'medium', 'low']),
    title: z.string(),
    /** The specific issue, quoting the offending text where possible. */
    problem: z.string(),
    /**
     * A concrete rewrite the candidate can paste.
     *
     * Figures must come from the resume, or be left as a bracketed placeholder:
     * "Built API" -> "Built API serving [N] requests/day, cutting p99 latency
     * by [X]%". The example used to be spelled out with real-looking numbers,
     * which is exactly the fabrication the numeric guard now catches on this
     * field — a suggestion is the one string here a stranger is invited to copy
     * into their own resume.
     */
    suggestion: z.string(),
});
export type ScoreFix = z.infer<typeof ScoreFixSchema>;

export const JobMatchSchema = z.object({
    matchedKeywords: z.array(z.string()),
    missingKeywords: z.array(z.string()),
});
export type JobMatch = z.infer<typeof JobMatchSchema>;

/**
 * The raw shape we ask the model to produce. `band` is derived server-side from
 * `overall`, so the model is not asked for it (keeps it consistent + non-punitive).
 */
/**
 * Ceiling on the fix list. Exported because the numeric guard has to name the
 * paths it polices (`fixes.0.suggestion` …) and there is no wildcard — see
 * `buildGuard` in `anonScore.ts`. Raising this without raising that would
 * silently leave the tail of a long list unguarded.
 */
export const MAX_FIXES = 8;

export const AnonScoreModelSchema = z.object({
    overall: z.number().int().min(0).max(100),
    dimensions: z.array(ScoreDimensionSchema).min(1),
    fixes: z.array(ScoreFixSchema).min(1).max(MAX_FIXES),
    jobMatch: JobMatchSchema.optional(),
});
export type AnonScoreModel = z.infer<typeof AnonScoreModelSchema>;

/** The final report returned to the client (band added). */
export const AnonScoreReportSchema = AnonScoreModelSchema.extend({
    band: ScoreBandSchema,
});
export type AnonScoreReport = z.infer<typeof AnonScoreReportSchema>;

export function deriveBand(overall: number): ScoreBand {
    if (overall >= 80) return 'strong';
    if (overall >= 60) return 'good';
    return 'needs_work';
}
