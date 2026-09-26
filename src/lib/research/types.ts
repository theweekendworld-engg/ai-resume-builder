/**
 * The provider-agnostic web-search contract (docs/impl/06-scout-agent.md §4).
 *
 * Same shape as `src/lib/enrichment/types.ts`, for the same reason: search
 * vendors churn and reprice, and what must not churn with them is what Scout
 * is willing to assert. A provider returns PAGES — url, title, text — and
 * never a judgement. Every claim Scout shows is extracted from those pages
 * afterwards and checked against them in code.
 *
 * ── Why the page text matters more than the ranking ────────────────────────
 *
 * The numeric guard and the quote check both need the words that were on the
 * page. A snippets-only API would force us to fetch every result ourselves
 * (slower, more failures, more hostile sites); Tavily returns cleaned content
 * with the result, which is the reason it was chosen.
 */

export type SearchDepth = 'basic' | 'advanced';

export type SearchResult = {
    url: string;
    title: string;
    /** The provider's most relevant excerpt(s). Always present. */
    content: string;
    /** Cleaned full-page text, when requested and available. Truncated. */
    rawContent: string | null;
    /** As the provider reports it; not re-parsed. */
    publishedDate: string | null;
    score: number;
};

export type SearchArgs = {
    query: string;
    /** Restrict results to these domains. */
    includeDomains?: string[];
    excludeDomains?: string[];
    /** 1–20. Default 6. */
    maxResults?: number;
    depth?: SearchDepth;
    /** `news` biases to recent reporting; `general` otherwise. */
    topic?: 'general' | 'news';
    /** Only pages published on or after this date (YYYY-MM-DD). */
    startDate?: string;
    includeRawContent?: boolean;
    signal?: AbortSignal;
    /** Injected in tests. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Bounds a hung vendor. Default 15s. */
    timeoutMs?: number;
};

/**
 * Split finely for the same reason `EnrichmentOutcome` is: `not_configured`
 * (show "research is off"), `quota_exhausted` (retry tomorrow) and `throttled`
 * (retry in a minute) demand different responses, and an `ok | error` model
 * would render all three as the same broken card.
 */
export type SearchOutcome =
    | { kind: 'ok'; results: SearchResult[]; costUsd: number }
    | { kind: 'not_configured' }
    | { kind: 'throttled'; retryAfterMs: number | null }
    | { kind: 'unauthorized' }
    | { kind: 'quota_exhausted' }
    | { kind: 'error'; message: string; status?: number };

export interface SearchProvider {
    /** Stable slug, written into logs. */
    readonly name: string;
    search(args: SearchArgs): Promise<SearchOutcome>;
}
