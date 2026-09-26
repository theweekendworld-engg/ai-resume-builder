/**
 * Merging sources into one `CompanyInsight` row.
 *
 * Once more than one thing can write `employeeCount`, the interesting question
 * stops being "what is the value" and becomes "which write wins". Today the
 * extension path overwrites the whole row on every refresh, which is fine while
 * there is exactly one source and actively wrong the moment there are two: open
 * a job page whose prose says "our 50-person team" and, without the rule below,
 * a licensed headcount is gone.
 *
 * Three rules, in order:
 *
 *   1. A null never overwrites a value. Absence is not information — a vendor
 *      that has no funding data is not asserting the company raised nothing.
 *   2. A lower-ranked source never overwrites a higher-ranked one, EVEN IF it
 *      is fresher. Recency does not upgrade a sentence caught by regex in
 *      marketing prose into a vendor record.
 *   3. Same rank, newer wins. That is what a refresh is.
 *
 * `website` is deliberately not mergeable. It is half of the row's unique key
 * (`normalizedCompanyName`, `website`); rewriting it does not correct a row, it
 * strands one and creates another.
 */

import {
    SOURCE_RANK,
    type EnrichmentSourceKind,
    type FieldProvenance,
    type ProvenanceMap,
} from '@/lib/enrichment/types';

/** The `CompanyInsight` columns more than one source can fill. */
export type MergeableFields = {
    employeeCount: number | null;
    fundingTotal: string | null;
    revenueEstimateText: string | null;
};

export const MERGEABLE_KEYS = [
    'employeeCount',
    'fundingTotal',
    'revenueEstimateText',
] as const satisfies ReadonlyArray<keyof MergeableFields>;

export type MergeResult = {
    fields: MergeableFields;
    provenance: ProvenanceMap;
    /** Which keys this write actually changed. Empty means a no-op refresh. */
    changed: string[];
};

/**
 * Rank of whatever currently holds a field.
 *
 * Rows written before provenance existed have none, and are treated as rank 0
 * so any identified source may claim them. That is the correct migration
 * behaviour rather than a loophole: an unattributed value is exactly the thing
 * we want replaced by one that can say where it came from, and the replacement
 * records provenance, so a field self-heals the first time it is written.
 */
function currentRank(provenance: ProvenanceMap, key: string): number {
    const existing = provenance[key];
    if (!existing) return 0;
    return SOURCE_RANK[existing.source] ?? 0;
}

function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (typeof value === 'number') return !Number.isFinite(value);
    return false;
}

/**
 * Apply one source's values over the current row.
 *
 * Pure, so the precedence table can be tested directly rather than inferred
 * from what ends up in the database.
 */
export function mergeCompanyFields(input: {
    current: MergeableFields;
    currentProvenance: ProvenanceMap;
    incoming: Partial<MergeableFields>;
    source: EnrichmentSourceKind;
    provider?: string;
    observedAt: Date;
}): MergeResult {
    const fields: MergeableFields = { ...input.current };
    const provenance: ProvenanceMap = { ...input.currentProvenance };
    const changed: string[] = [];

    const incomingRank = SOURCE_RANK[input.source];
    const stamp: FieldProvenance = {
        source: input.source,
        ...(input.provider ? { provider: input.provider } : {}),
        observedAt: input.observedAt.toISOString(),
    };

    for (const key of MERGEABLE_KEYS) {
        const value = input.incoming[key];

        // Rule 1 — a null carries no claim.
        if (isEmpty(value)) continue;

        const heldRank = currentRank(provenance, key);
        const held = fields[key];

        // Rule 2 — never demote a field to a weaker source.
        if (!isEmpty(held) && incomingRank < heldRank) continue;

        // Rule 3 — at equal rank, only a strictly newer observation wins, so
        // replaying the same payload is idempotent rather than churning
        // `updatedAt` and re-reporting a change that did not happen.
        if (!isEmpty(held) && incomingRank === heldRank) {
            const heldAt = provenance[key]?.observedAt;
            if (heldAt && Date.parse(heldAt) >= input.observedAt.getTime()) continue;
        }

        if (held !== value) changed.push(key);

        // `as never` narrows the union write that TS cannot follow across a
        // keyof loop; the value is already checked non-empty and typed by key.
        fields[key] = value as never;
        provenance[key] = stamp;
    }

    return { fields, provenance, changed };
}

/**
 * Confidence, derived from where the fields came from rather than invented.
 *
 * The existing `computeConfidence` in the extension path scores how MUCH was
 * found. That made sense when everything came from one place. With mixed
 * sources the more useful signal is how GOOD the best source is: three fields
 * scraped from prose should not outscore one field from a licensed record.
 *
 * Bounded well below 1. Nothing here is ever certain, and a card claiming 0.97
 * confidence about a private company's revenue would be the exact overreach
 * this module exists to prevent.
 */
export function confidenceFromProvenance(provenance: ProvenanceMap): number {
    const ranks = MERGEABLE_KEYS
        .map((key) => provenance[key])
        .filter((entry): entry is FieldProvenance => Boolean(entry))
        .map((entry) => SOURCE_RANK[entry.source] ?? 0);

    if (ranks.length === 0) return 0.12;

    const best = Math.max(...ranks);
    // Floor set by the strongest source present, then a little for breadth.
    const base = best >= SOURCE_RANK.observed_postings ? 0.62
        : best >= SOURCE_RANK.provider ? 0.55
            : 0.3;
    const breadth = Math.min(0.2, ranks.length * 0.07);

    return Number(Math.min(0.86, base + breadth).toFixed(2));
}

/** Row-level label. Names the strongest source rather than the most recent. */
export function freshnessLabelFor(provenance: ProvenanceMap): string {
    const entries = MERGEABLE_KEYS
        .map((key) => provenance[key])
        .filter((entry): entry is FieldProvenance => Boolean(entry));

    if (entries.length === 0) return 'job-page-derived';

    const best = entries.reduce((a, b) =>
        (SOURCE_RANK[b.source] ?? 0) > (SOURCE_RANK[a.source] ?? 0) ? b : a,
    );

    if (best.source === 'provider') return `provider:${best.provider ?? 'unknown'}`;
    if (best.source === 'observed_postings') return 'observed-postings';
    return 'job-page-derived';
}

/** Read a persisted provenance map back off `rawData`, tolerating old rows. */
export function readProvenance(rawData: unknown): ProvenanceMap {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    const candidate = (rawData as Record<string, unknown>).provenance;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};

    const output: ProvenanceMap = {};
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const entry = value as Record<string, unknown>;
        const source = entry.source;
        if (source !== 'job_page' && source !== 'provider' && source !== 'observed_postings') continue;
        if (typeof entry.observedAt !== 'string') continue;

        output[key] = {
            source,
            ...(typeof entry.provider === 'string' ? { provider: entry.provider } : {}),
            observedAt: entry.observedAt,
        };
    }
    return output;
}
