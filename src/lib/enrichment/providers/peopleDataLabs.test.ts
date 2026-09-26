/**
 * The provider adapter.
 *
 * Fetch is injected, as in `radar/boards.test.ts` — the value in testing an
 * adapter is the mapping and the status handling, and neither needs a network.
 *
 * The status cases carry the most weight. `not_found` and `quota_exhausted`
 * arrive as different HTTP codes and mean opposite things about whether to ask
 * again; conflating them either burns credits forever on companies that will
 * never resolve, or blanks a company permanently over one billing hiccup.
 */

import { describe, expect, test } from 'bun:test';
import {
    buildPdlQuery,
    createPeopleDataLabsProvider,
    formatFundingTotal,
    mapPdlCompany,
    normalizeDomain,
} from './peopleDataLabs';

const provider = createPeopleDataLabsProvider('test-key');

function respondWith(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
    return (async () => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    })) as unknown as typeof fetch;
}

const FIXTURE = {
    id: 'pdl-123',
    name: 'acme',
    size: '201-500',
    employee_count: 412,
    industry: 'computer software',
    founded: 2016,
    website: 'acme.com',
    total_funding_raised: 45_000_000,
    latest_funding_stage: 'series_b',
    last_funding_date: '2025-04-02',
    number_funding_rounds: 3,
    inferred_revenue: '$25M-$50M',
    location: { locality: 'bengaluru', region: 'karnataka', country: 'india' },
};

describe('mapping a vendor record', () => {
    test('fills the fields we have columns for', () => {
        const facts = mapPdlCompany(FIXTURE);
        expect(facts.employeeCount).toBe(412);
        expect(facts.fundingTotalText).toBe('$45M raised (USD)');
        expect(facts.revenueEstimateText).toBe('$25M-$50M');
    });

    test('keeps the size band alongside the point count', () => {
        // The band is frequently the more honest number; both are carried so a
        // surface can prefer it.
        expect(mapPdlCompany(FIXTURE).employeeCountRange).toBe('201-500');
    });

    test('flattens their location object into one line', () => {
        expect(mapPdlCompany(FIXTURE).headquarters).toBe('bengaluru, karnataka, india');
    });

    test('a sparse record yields nulls, never invented values', () => {
        const facts = mapPdlCompany({ id: 'pdl-9', name: 'quiet co' });
        expect(facts.employeeCount).toBeNull();
        expect(facts.fundingTotalText).toBeNull();
        expect(facts.revenueEstimateText).toBeNull();
        expect(facts.providerRecordId).toBe('pdl-9');
    });

    test.each([
        ['null', null],
        ['a string', 'nope'],
        ['an array', []],
    ])('%s maps to empty facts rather than throwing', (_label, input) => {
        expect(mapPdlCompany(input).employeeCount).toBeNull();
    });
});

describe('funding is rendered with its currency stated', () => {
    test.each([
        [45_000_000, '$45M raised (USD)'],
        [1_500_000_000, '$1.5B raised (USD)'],
        [2_000_000_000, '$2B raised (USD)'],
        [750_000, '$750K raised (USD)'],
        [12_500_000, '$12.5M raised (USD)'],
    ])('%p → %s', (input, expected) => {
        expect(formatFundingTotal(input)).toBe(expected);
    });

    test.each([[0], [null], [undefined], ['nope'], [-5]])('%p is not a funding claim', (input) => {
        expect(formatFundingTotal(input)).toBeNull();
    });
});

describe('query construction', () => {
    test('domain wins over name when both are known', () => {
        // Name matching across their index is genuinely ambiguous, and a
        // confidently wrong company is worse than no company.
        const query = buildPdlQuery('Acme', 'https://www.acme.com/careers');
        expect(query.get('website')).toBe('acme.com');
        expect(query.get('name')).toBeNull();
    });

    test('falls back to name when there is no domain', () => {
        expect(buildPdlQuery('Acme', null).get('name')).toBe('Acme');
    });

    test.each([
        ['https://www.stripe.com/jobs', 'stripe.com'],
        ['stripe.com', 'stripe.com'],
        ['HTTP://Stripe.COM', 'stripe.com'],
        ['not a url at all', null],
        [null, null],
        ['', null],
    ])('%p → %p', (input, expected) => {
        expect(normalizeDomain(input)).toBe(expected);
    });
});

describe('status handling', () => {
    test('200 with a record is ok', async () => {
        const outcome = await provider.enrich({
            companyName: 'Acme',
            fetchImpl: respondWith(200, FIXTURE),
        });

        expect(outcome.kind).toBe('ok');
        if (outcome.kind !== 'ok') return;
        expect(outcome.facts.employeeCount).toBe(412);
    });

    test('a 200 envelope carrying status 404 is still not_found', async () => {
        // Their API can answer 200 at the transport layer and 404 in the body.
        const outcome = await provider.enrich({
            companyName: 'Acme',
            fetchImpl: respondWith(200, { status: 404, error: { type: 'not_found' } }),
        });

        expect(outcome.kind).toBe('not_found');
    });

    test.each([
        [404, 'not_found'],
        [401, 'unauthorized'],
        [403, 'unauthorized'],
        [402, 'quota_exhausted'],
        [429, 'throttled'],
        [500, 'error'],
    ] as const)('HTTP %i → %s', async (status, kind) => {
        const outcome = await provider.enrich({
            companyName: 'Acme',
            fetchImpl: respondWith(status),
        });
        expect(outcome.kind).toBe(kind);
    });

    test('a Retry-After is carried through so backoff can honour it', async () => {
        const outcome = await provider.enrich({
            companyName: 'Acme',
            fetchImpl: respondWith(429, {}, { 'retry-after': '30' }),
        });

        expect(outcome.kind).toBe('throttled');
        if (outcome.kind !== 'throttled') return;
        expect(outcome.retryAfterMs).toBe(30_000);
    });

    test('a thrown fetch is an error outcome, never an exception', async () => {
        const outcome = await provider.enrich({
            companyName: 'Acme',
            fetchImpl: (async () => { throw new Error('econnrefused'); }) as unknown as typeof fetch,
        });

        expect(outcome.kind).toBe('error');
    });

    test('a hung vendor aborts rather than stalling the request', async () => {
        const outcome = await provider.enrich({
            companyName: 'Acme',
            timeoutMs: 10,
            fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            })) as unknown as typeof fetch,
        });

        expect(outcome.kind).toBe('error');
        if (outcome.kind !== 'error') return;
        expect(outcome.message).toBe('timeout');
    });

    test('no identifier at all is refused before a request is made', async () => {
        let called = false;
        const outcome = await provider.enrich({
            companyName: '   ',
            website: null,
            fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
        });

        expect(outcome.kind).toBe('error');
        expect(called).toBe(false);
    });

    test('the key travels in the header, not the query string', async () => {
        const seen: { url: string; key: string | null } = { url: '', key: null };

        await provider.enrich({
            companyName: 'Acme',
            fetchImpl: (async (url: string, init?: RequestInit) => {
                seen.url = String(url);
                seen.key = new Headers(init?.headers).get('X-Api-Key');
                return new Response(JSON.stringify(FIXTURE), { status: 200 });
            }) as unknown as typeof fetch,
        });

        expect(seen.key).toBe('test-key');
        // A key in the query string ends up in access logs and proxy caches.
        expect(seen.url).not.toContain('test-key');
    });
});
