/**
 * Confidence scoring — PRD 02 §4.3.
 *
 * Computed, never asked of the model. A model's self-reported confidence
 * correlates with fluency, not with whether the artefact was actually
 * significant, so asking for it produces a number that reads meaningful and
 * ranks badly. The digest's top-5 selection is entirely this function's output,
 * which makes it worth keeping pure and worth testing exhaustively.
 *
 * The formula is transcribed from the PRD verbatim; the weights are the spec,
 * not a tuning surface. Changing one is a PRD change.
 */

import { extractQuantities } from '@/lib/ai/guard';
import { DIGEST_SURFACE_CONFIDENCE, MIN_DRAFT_CONFIDENCE } from './caps';

// ───────────────────────────────────────────────────────────── inputs

/**
 * Everything the formula reads. Adapter-neutral on purpose: the calendar
 * adapter fills what it has (`bodyLength`, `labels`) and leaves the rest at
 * zero, and the same scoring applies without a second implementation.
 */
export type ConfidenceFacts = {
    title: string;
    body: string;
    /** Linked issue text, when there is one. Null means no linked issue. */
    linkedIssueText: string | null;
    labels: string[];
    filesChanged: number;
    /** Review comments left by people other than the user. */
    reviewCommentsByOthers: number;
};

export type ConfidenceBreakdown = {
    score: number;
    /** Each rule that fired, with its delta. Rendered in the settings debug view. */
    reasons: Array<{ rule: string; delta: number }>;
};

// ───────────────────────────────────────────────────────────── the weights

export const BASE_CONFIDENCE = 0.4;

export const CONFIDENCE_WEIGHTS = {
    longBody: 0.2,
    linkedIssue: 0.15,
    hasNumber: 0.15,
    reviewed: 0.1,
    meaningfulLabel: 0.1,
    bulkChange: -0.2,
    lowSignalTitle: -0.15,
} as const;

/** §4.3: "PR body length > 200 chars". */
export const LONG_BODY_CHARS = 200;

/** §4.3: "≥3 review comments from others". */
export const SIGNIFICANT_REVIEW_COMMENTS = 3;

/** §4.3: "files_changed > 60 (likely a bulk/mechanical change)". */
export const BULK_CHANGE_FILES = 60;

/**
 * §4.3 "labels include a meaningful tag". Deliberately a list of things that
 * describe the *work*, not the process — `good first issue` and `needs triage`
 * say nothing about whether this was an accomplishment.
 */
export const MEANINGFUL_LABELS: readonly string[] = [
    'feature',
    'enhancement',
    'performance',
    'perf',
    'security',
    'reliability',
    'availability',
    'accessibility',
    'a11y',
    'infrastructure',
    'infra',
    'migration',
    'architecture',
    'refactor',
    'bug',
    'bugfix',
    'incident',
    'outage',
    'data',
    'api',
    'ux',
    'design',
    'observability',
    'cost',
    'scalability',
];

/**
 * §6.4 low-signal title patterns. These are a confidence *penalty*, never an
 * exclusion — sometimes "cleanup" is a 3,000-line deletion that mattered.
 */
export const LOW_SIGNAL_TITLE_PATTERNS: readonly RegExp[] = [
    /^\s*fix(ed)?\s+typos?\b/i,
    /\btypos?\b.{0,12}$/i,
    /^\s*\[?wip\]?\b/i,
    /^\s*(draft|test|tests|testing)\s*$/i,
    /^\s*revert\b/i,
    /^\s*merge\s+(branch|pull request|remote)\b/i,
    /^\s*(clean\s?up|cleanup|tidy|tidy\s?up)\b/i,
    /^\s*(lint|linting|prettier|format|formatting|reformat)\b/i,
    /^\s*(nit|nits|minor|small|tiny|misc)\b/i,
    /^\s*(rename|move)\s+(file|folder|dir)\b/i,
];

// ───────────────────────────────────────────────────────────── predicates

export function isLowSignalTitle(title: string): boolean {
    const trimmed = (title ?? '').trim();
    if (!trimmed) return true;
    // A single word is never enough context to be a Win on its own (§6.4).
    if (!/\s/.test(trimmed)) return true;
    return LOW_SIGNAL_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function hasMeaningfulLabel(labels: readonly string[]): boolean {
    return labels.some((label) => {
        const normalized = label.trim().toLowerCase();
        return MEANINGFUL_LABELS.some(
            (meaningful) => normalized === meaningful || normalized.endsWith(`/${meaningful}`),
        );
    });
}

/**
 * "A number appears in title/body/issue."
 *
 * Reuses the guard's lenient extractor rather than a local `/\d/` — the guard
 * already knows that `v2.1.0` and `2026-08-01` are identifiers, not metrics,
 * and duplicating that judgement here would let the two drift.
 */
export function statesAQuantity(text: string): boolean {
    return extractQuantities(text ?? '', 'lenient').some(
        (quantity) => quantity.kind !== 'version' && quantity.kind !== 'date' && quantity.kind !== 'year',
    );
}

// ───────────────────────────────────────────────────────────── the formula

export function scoreConfidence(facts: ConfidenceFacts): ConfidenceBreakdown {
    const reasons: Array<{ rule: string; delta: number }> = [];
    let score = BASE_CONFIDENCE;

    const add = (rule: string, delta: number): void => {
        score += delta;
        reasons.push({ rule, delta });
    };

    if ((facts.body ?? '').length > LONG_BODY_CHARS) add('longBody', CONFIDENCE_WEIGHTS.longBody);
    if (facts.linkedIssueText && facts.linkedIssueText.trim().length > 0) {
        add('linkedIssue', CONFIDENCE_WEIGHTS.linkedIssue);
    }

    const quantitySource = [facts.title, facts.body, facts.linkedIssueText ?? ''].join('\n');
    if (statesAQuantity(quantitySource)) add('hasNumber', CONFIDENCE_WEIGHTS.hasNumber);

    if (facts.reviewCommentsByOthers >= SIGNIFICANT_REVIEW_COMMENTS) {
        add('reviewed', CONFIDENCE_WEIGHTS.reviewed);
    }
    if (hasMeaningfulLabel(facts.labels ?? [])) add('meaningfulLabel', CONFIDENCE_WEIGHTS.meaningfulLabel);
    if (facts.filesChanged > BULK_CHANGE_FILES) add('bulkChange', CONFIDENCE_WEIGHTS.bulkChange);
    if (isLowSignalTitle(facts.title)) add('lowSignalTitle', CONFIDENCE_WEIGHTS.lowSignalTitle);

    return { score: clamp01(score), reasons };
}

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

// ───────────────────────────────────────────────────────────── thresholds

/** §4.3: below 0.20 → do not draft at all. */
export function shouldDraftAtConfidence(score: number): boolean {
    return score >= MIN_DRAFT_CONFIDENCE;
}

/** §4.3: below 0.35 → draft, but keep it out of the digest. */
export function shouldSurfaceInDigest(score: number): boolean {
    return score >= DIGEST_SURFACE_CONFIDENCE;
}
