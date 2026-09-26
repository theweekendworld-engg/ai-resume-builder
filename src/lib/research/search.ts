/**
 * One search, accounted for.
 *
 * The only path from a search provider into a Scout step. Every result is
 * registered into `step.sources` — which is what later lets a claim cite it —
 * and the credit cost is charged to the run budget. A section that called the
 * provider directly would produce claims that fail every citation check, which
 * is the correct failure, but a confusing one.
 */

import type { StepContext } from '@/lib/agent/run';
import { resolveSearchProvider } from '@/lib/research/providers';
import type { SearchArgs, SearchOutcome, SearchResult } from '@/lib/research/types';

export const RESEARCH_OFF_REASON = 'Web research is off: add TAVILY_API_KEY';

export type RunSearchOutcome =
    | { kind: 'ok'; results: SearchResult[] }
    | Exclude<SearchOutcome, { kind: 'ok' }>;

/** Page text for verification: full text when we have it, else the excerpt. */
export function pageText(result: SearchResult): string {
    return result.rawContent ? `${result.content}\n${result.rawContent}` : result.content;
}

export async function runSearch(
    step: Pick<StepContext, 'sources' | 'signal' | 'addCost' | 'log'>,
    args: Omit<SearchArgs, 'signal'>,
): Promise<RunSearchOutcome> {
    const provider = resolveSearchProvider();
    if (!provider) return { kind: 'not_configured' };

    const outcome = await provider.search({ ...args, signal: step.signal });
    if (outcome.kind !== 'ok') {
        step.log('search did not return results', { provider: provider.name, outcome: outcome.kind });
        return outcome;
    }

    step.addCost(outcome.costUsd);
    for (const result of outcome.results) {
        step.sources.add({
            url: result.url,
            title: result.title,
            text: pageText(result),
            publishedAt: result.publishedDate,
        });
    }
    return { kind: 'ok', results: outcome.results };
}

/** Human reason for a non-ok outcome, shown on the section. */
export function reasonForOutcome(outcome: Exclude<RunSearchOutcome, { kind: 'ok' }>): string {
    switch (outcome.kind) {
        case 'not_configured':
            return RESEARCH_OFF_REASON;
        case 'throttled':
            return 'The search provider is rate-limiting us right now. Refresh in a few minutes.';
        case 'quota_exhausted':
            return 'Web research credits are used up for this period.';
        case 'unauthorized':
            return 'The search provider rejected our key (TAVILY_API_KEY).';
        case 'error':
            return 'The search provider failed. Refresh to try again.';
    }
}

/** YYYY-MM-DD, `days` before `now`. */
export function daysAgo(days: number, now: Date = new Date()): string {
    return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
