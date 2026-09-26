/**
 * Provider resolution.
 *
 * The absence of an API key IS the off switch. There is no feature flag here,
 * deliberately: a flag would be a second thing to get wrong, and the state it
 * would guard — "enrichment on, but no credentials" — is one we never want to
 * be in. One knob, and its default is off.
 *
 * Env-injectable rather than reading `process.env` at module load, for the same
 * reason `resolveModelGateway` in `src/lib/config.ts` is: precedence you cannot
 * test is precedence you are guessing at.
 */

import { createPeopleDataLabsProvider } from '@/lib/enrichment/providers/peopleDataLabs';
import type { EnrichmentProvider } from '@/lib/enrichment/types';

/**
 * The configured provider, or null when none is.
 *
 * Null is the expected result on a fresh checkout and in CI. Callers must
 * handle it as a normal path — never as an error — because the job-page
 * derivation it falls back to is a working feature, not a degraded one.
 */
export function resolveEnrichmentProvider(
    env: Record<string, string | undefined> = process.env,
): EnrichmentProvider | null {
    const pdlKey = (env.PDL_API_KEY || '').trim();
    if (pdlKey) return createPeopleDataLabsProvider(pdlKey);

    return null;
}
