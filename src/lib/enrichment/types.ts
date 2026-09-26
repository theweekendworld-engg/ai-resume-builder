/**
 * The provider-agnostic enrichment contract.
 *
 * `CompanyInsight` has carried `employeeCount`, `fundingTotal` and
 * `revenueEstimateText` since it was written, and until now the only thing
 * filling them was a regex over the job description — "we raised $12M" caught
 * in prose. That is a real source, but it is the weakest one available, and it
 * is silent about companies whose JD happens not to brag.
 *
 * This module defines what a stronger source has to look like. Deliberately an
 * interface with one implementation rather than a direct SDK call, for the same
 * reason `src/lib/radar/boards.ts` is: the vendors in this category churn,
 * price-change and get acquired, and the ONE thing that must not churn with
 * them is what we are willing to assert about a company.
 *
 * ── Why every provider must be swappable, and none may be required ──────────
 *
 * Enrichment is an enhancement, never a dependency. When no provider is
 * configured — the default, and the state of every fresh checkout — the
 * outcome is `not_configured` and the caller falls back to the job-page
 * derivation that already worked. A missing API key must never turn a company
 * card into an error state.
 *
 * ── What a provider may NOT return ──────────────────────────────────────────
 *
 * There is no field here for "does this company sponsor visas", "is this a good
 * place to work", or any other judgement. Providers return observations —
 * counts, dates, ranges, all with a `observedAt` — and the judgements are
 * computed from observations elsewhere, where the arithmetic is inspectable.
 * A vendor field that arrives pre-judged has no `n` behind it and cannot be
 * defended to the user who asks "how do you know?".
 */

/**
 * Facts a provider is allowed to assert.
 *
 * Every field is nullable and every provider is expected to fill only some of
 * them. Partial is normal; inventing a value to fill a gap is not.
 */
export type CompanyFacts = {
    /**
     * Headcount ESTIMATE. Effectively always derived from professional-network
     * profiles, which means it runs high for large companies and noisy for
     * small ones. Stored as the estimate it is — see `revenueEstimateText` for
     * why ranges beat points where the vendor offers one.
     */
    employeeCount: number | null;
    /** Vendor's own size band, e.g. "51-200". Often truer than the point count. */
    employeeCountRange: string | null;
    /** Human text, not a number: rounds span currencies and we never convert. */
    fundingTotalText: string | null;
    latestFundingStage: string | null;
    lastFundingAt: Date | null;
    fundingRoundCount: number | null;
    /**
     * A RANGE as the vendor phrased it ("$10M-$25M"), never a point estimate.
     * Revenue for a private company is inferred, and a single number implies a
     * precision nobody outside the company's finance team has.
     */
    revenueEstimateText: string | null;
    industry: string | null;
    foundedYear: number | null;
    headquarters: string | null;
    website: string | null;
    /** The vendor's own record id, so a surprising row can be traced back. */
    providerRecordId: string | null;
};

export function emptyCompanyFacts(): CompanyFacts {
    return {
        employeeCount: null,
        employeeCountRange: null,
        fundingTotalText: null,
        latestFundingStage: null,
        lastFundingAt: null,
        fundingRoundCount: null,
        revenueEstimateText: null,
        industry: null,
        foundedYear: null,
        headquarters: null,
        website: null,
        providerRecordId: null,
    };
}

/**
 * Outcomes callers branch on.
 *
 * Split finely on purpose. `not_found` (this company is not in the vendor's
 * index) and `quota_exhausted` (we ran out of credits) look identical if you
 * only model ok/error, and they demand opposite responses: cache the first as a
 * real negative, retry the second tomorrow. Conflating them either burns credit
 * re-asking about companies that will never resolve, or permanently blanks a
 * company because of one billing hiccup.
 */
export type EnrichmentOutcome =
    | { kind: 'ok'; facts: CompanyFacts; observedAt: Date; raw: unknown }
    /** The vendor answered and does not have this company. A real negative. */
    | { kind: 'not_found' }
    /** No API key. The default state; callers fall back silently. */
    | { kind: 'not_configured' }
    | { kind: 'throttled'; retryAfterMs: number | null }
    /** Key rejected. Operational — worth surfacing, unlike the others. */
    | { kind: 'unauthorized' }
    /** Out of credits. Transient in the way a bill is transient. */
    | { kind: 'quota_exhausted' }
    | { kind: 'error'; message: string; status?: number };

export type EnrichArgs = {
    companyName: string;
    /**
     * Apex domain when known. Every vendor in this category resolves domain
     * far more reliably than name — "Anthropic" is ambiguous across their index
     * in a way `anthropic.com` is not — so callers should pass it when they
     * have it.
     */
    website?: string | null;
    /** Injected in tests. Defaults to global fetch, as in `radar/boards.ts`. */
    fetchImpl?: typeof fetch;
    /** Bounds a hung vendor. Enrichment is never worth stalling a request for. */
    timeoutMs?: number;
};

export interface EnrichmentProvider {
    /** Stable slug written into provenance. Changing it orphans old records. */
    readonly name: string;
    readonly host: string;
    enrich(args: EnrichArgs): Promise<EnrichmentOutcome>;
}

// ──────────────────────────────────────────────────────────────── provenance

/**
 * Where a single field came from.
 *
 * Per-FIELD, not per-row, and that is the whole point. The moment a licensed
 * provider fills `employeeCount` while the job-page regex still owns
 * `fundingTotal`, a row-level `freshnessLabel` of "job-page-derived" is a lie
 * about half the record and "provider" is a lie about the other half. The user
 * question this exists to answer is not "how fresh is this card" but "where did
 * THAT number come from" — which is the only version of the question that can
 * be checked.
 */
export type EnrichmentSourceKind =
    /** Regex over the job description. Real, weakest, always available. */
    | 'job_page'
    /** A licensed enrichment vendor. */
    | 'provider'
    /** Our own observed postings. Strongest: we can cite the rows. */
    | 'observed_postings';

/**
 * Precedence when two sources offer the same field.
 *
 * Higher wins, and a lower-ranked source may never overwrite a higher-ranked
 * one — not even with a fresher timestamp. Recency does not make a sentence
 * scraped out of marketing prose better evidence than a vendor record; without
 * this rule, one JD that says "we're a 50-person team" quietly overwrites a
 * licensed headcount every time someone re-opens the page.
 */
export const SOURCE_RANK: Record<EnrichmentSourceKind, number> = {
    job_page: 1,
    provider: 2,
    observed_postings: 3,
};

export type FieldProvenance = {
    source: EnrichmentSourceKind;
    /** Set when `source === 'provider'`. */
    provider?: string;
    /** ISO-8601. When the source was observed, not when the row was written. */
    observedAt: string;
};

/** Field name → where that field came from. Persisted in `rawData.provenance`. */
export type ProvenanceMap = Record<string, FieldProvenance>;
