/**
 * Cache policy for provider calls.
 *
 * Every branch here is a spend decision. Getting it wrong is not a crash; it is
 * either a bill (re-asking about companies that will never resolve) or a
 * permanently blank card (caching a timeout as if it were an answer about the
 * company rather than about the minute we asked in).
 */

import { describe, expect, test } from 'bun:test';
import { NOT_FOUND_TTL_DAYS, PROVIDER_TTL_DAYS, shouldCallProvider } from './enrich';
import { resolveEnrichmentProvider } from './providers';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function daysAgo(days: number): string {
    return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('when to spend a credit', () => {
    test('never asked before → ask', () => {
        expect(shouldCallProvider({ attempt: null, providerName: 'pdl', now: NOW })).toBe(true);
    });

    test('a fresh success is reused', () => {
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: daysAgo(3), outcome: 'ok' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(false);
    });

    test(`a success older than ${PROVIDER_TTL_DAYS} days is refreshed`, () => {
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: daysAgo(PROVIDER_TTL_DAYS + 1), outcome: 'ok' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(true);
    });

    test('a recent not_found is a real negative and is honoured', () => {
        // Without this, every company outside the vendor's index is re-queried
        // on every page view, forever.
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: daysAgo(2), outcome: 'not_found' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(false);
    });

    test(`a not_found expires sooner (${NOT_FOUND_TTL_DAYS} days) than a success`, () => {
        expect(NOT_FOUND_TTL_DAYS).toBeLessThan(PROVIDER_TTL_DAYS);
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: daysAgo(NOT_FOUND_TTL_DAYS + 1), outcome: 'not_found' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(true);
    });

    test.each(['throttled', 'error', 'quota_exhausted'] as const)(
        'a %s is never cached — it says nothing about the company',
        (outcome) => {
            expect(shouldCallProvider({
                attempt: { provider: 'pdl', at: daysAgo(0), outcome },
                providerName: 'pdl',
                now: NOW,
            })).toBe(true);
        },
    );

    test('swapping vendors re-tests the old answer', () => {
        // Honouring a TTL written by the vendor you just replaced would make
        // the swap look like it did nothing.
        expect(shouldCallProvider({
            attempt: { provider: 'oldvendor', at: daysAgo(1), outcome: 'ok' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(true);
    });

    test('forceRefresh overrides a live cache entry', () => {
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: daysAgo(1), outcome: 'ok' },
            providerName: 'pdl',
            now: NOW,
            forceRefresh: true,
        })).toBe(true);
    });

    test('an unparseable timestamp fails toward asking, not toward silence', () => {
        expect(shouldCallProvider({
            attempt: { provider: 'pdl', at: 'not-a-date', outcome: 'ok' },
            providerName: 'pdl',
            now: NOW,
        })).toBe(true);
    });
});

describe('provider resolution', () => {
    test('no key means no provider, which is the default and not an error', () => {
        expect(resolveEnrichmentProvider({})).toBeNull();
    });

    test('a blank key is not a key', () => {
        expect(resolveEnrichmentProvider({ PDL_API_KEY: '   ' })).toBeNull();
    });

    test('a key selects the provider and names it for provenance', () => {
        const provider = resolveEnrichmentProvider({ PDL_API_KEY: 'k' });
        expect(provider?.name).toBe('peopledatalabs');
    });
});
