/**
 * Tavily Search — https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * Request: POST https://api.tavily.com/search, `Authorization: Bearer <key>`,
 * JSON body with `query`, `search_depth`, `topic`, `max_results`,
 * `include_raw_content`, `include_domains`, `start_date`,
 * `include_published_date`. Response: `{ results: [{ title, url, content,
 * score, raw_content?, published_date? }] }`.
 *
 * Errors (same page): 401 bad key; 429 rate limit with `Retry-After`; 432 key
 * or plan limit; 433 pay-as-you-go limit.
 *
 * ── Pricing (checked 2026-09-23) ────────────────────────────────────────────
 *
 * https://docs.tavily.com/documentation/api-credits — `basic` costs 1 credit,
 * `advanced` 2. 1,000 free credits a month; pay-as-you-go is $0.008 per credit
 * (monthly plans $0.0075 → $0.005). So $0.008 / $0.016 per search is the
 * CEILING, which is the right side to err on for a budget check. Override with
 * TAVILY_COST_PER_CREDIT_USD when on a plan.
 */

import type { SearchArgs, SearchDepth, SearchOutcome, SearchProvider, SearchResult } from '@/lib/research/types';

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Enough page for the guard to verify a figure; not a whole wiki article. */
export const RAW_CONTENT_MAX = 20_000;
const DEFAULT_COST_PER_CREDIT_USD = 0.008;

const CREDITS: Record<SearchDepth, number> = { basic: 1, advanced: 2 };

export function tavilyCostUsd(depth: SearchDepth, env: Record<string, string | undefined> = process.env): number {
    const perCredit = Number(env.TAVILY_COST_PER_CREDIT_USD);
    const rate = Number.isFinite(perCredit) && perCredit >= 0 ? perCredit : DEFAULT_COST_PER_CREDIT_USD;
    return CREDITS[depth] * rate;
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapResult(raw: unknown): SearchResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Record<string, unknown>;
    const url = str(entry.url);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const rawContent = str(entry.raw_content);
    return {
        url,
        title: str(entry.title) ?? url,
        content: str(entry.content) ?? '',
        rawContent: rawContent ? rawContent.slice(0, RAW_CONTENT_MAX) : null,
        publishedDate: str(entry.published_date),
        score: typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : 0,
    };
}

function retryAfterMs(header: string | null): number | null {
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(header);
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export function createTavilyProvider(
    apiKey: string,
    env: Record<string, string | undefined> = process.env,
): SearchProvider {
    return {
        name: 'tavily',
        async search(args: SearchArgs): Promise<SearchOutcome> {
            const depth: SearchDepth = args.depth ?? 'basic';
            const fetchImpl = args.fetchImpl ?? fetch;
            const timeout = AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;

            const body: Record<string, unknown> = {
                query: args.query.slice(0, 400),
                search_depth: depth,
                topic: args.topic ?? 'general',
                max_results: Math.min(Math.max(args.maxResults ?? 6, 1), 20),
                include_raw_content: args.includeRawContent ? 'text' : false,
                include_published_date: true,
                include_answer: false,
            };
            if (args.includeDomains?.length) body.include_domains = args.includeDomains.slice(0, 300);
            if (args.excludeDomains?.length) body.exclude_domains = args.excludeDomains.slice(0, 150);
            if (args.startDate) body.start_date = args.startDate;

            let response: Response;
            try {
                response = await fetchImpl(TAVILY_ENDPOINT, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal,
                });
            } catch (error) {
                return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
            }

            if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' };
            if (response.status === 429) return { kind: 'throttled', retryAfterMs: retryAfterMs(response.headers.get('retry-after')) };
            if (response.status === 432 || response.status === 433) return { kind: 'quota_exhausted' };
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                return { kind: 'error', status: response.status, message: text.slice(0, 200) || `HTTP ${response.status}` };
            }

            let json: unknown;
            try {
                json = await response.json();
            } catch {
                return { kind: 'error', status: response.status, message: 'Unparseable response' };
            }
            const rawResults = (json as { results?: unknown }).results;
            const results = Array.isArray(rawResults)
                ? rawResults.map(mapResult).filter((result): result is SearchResult => result !== null)
                : [];
            return { kind: 'ok', results, costUsd: tavilyCostUsd(depth, env) };
        },
    };
}
