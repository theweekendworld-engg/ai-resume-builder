/**
 * Search provider resolution. The absence of TAVILY_API_KEY is the off switch
 * — no flag, same rule as `src/lib/enrichment/providers/index.ts`. Unset (a
 * fresh checkout, CI), every research section reports "research is off" with
 * that reason, and nothing else in the run changes.
 */

import { createTavilyProvider } from '@/lib/research/providers/tavily';
import type { SearchProvider } from '@/lib/research/types';

let override: SearchProvider | null | undefined;

export function resolveSearchProvider(
    env: Record<string, string | undefined> = process.env,
): SearchProvider | null {
    if (override !== undefined) return override;
    const key = (env.TAVILY_API_KEY || '').trim();
    return key ? createTavilyProvider(key, env) : null;
}

export const __testing = {
    /** `null` forces "not configured"; `undefined` restores env resolution. */
    setProvider(provider: SearchProvider | null | undefined) {
        override = provider;
    },
};
