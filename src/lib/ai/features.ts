/**
 * Feature tags (ADR-6 / P-5 "cost tagging").
 *
 * Every `generateStructured()` call declares the product surface it serves.
 * The tag lands in `ApiUsageLog.metadata.feature` and is the group-by for the
 * per-feature cost tripwire query in PRD 08 §4.3.
 *
 * Adding a surface? Add the tag here. Do not pass free-form strings.
 */
export const FEATURE_TAGS = [
    'work_log',
    'github_capture',
    'weekly_digest',
    'month_in_review',
    'review_packet',
    'interview_prep',
    'radar',
    'resume',
    'cover_letter',
    'apply_answer',
    'jd_parse',
    'grounding',
    'backfill',
    'onboarding',
    'scout',
    'outreach',
] as const;

export type FeatureTag = (typeof FEATURE_TAGS)[number];

const FEATURE_TAG_SET: ReadonlySet<string> = new Set<string>(FEATURE_TAGS);

export function isFeatureTag(value: unknown): value is FeatureTag {
    return typeof value === 'string' && FEATURE_TAG_SET.has(value);
}
