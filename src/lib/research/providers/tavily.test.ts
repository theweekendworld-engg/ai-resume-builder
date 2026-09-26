import { describe, expect, test } from 'bun:test';
import { createTavilyProvider, tavilyCostUsd, TAVILY_ENDPOINT } from './tavily';
import { resolveSearchProvider } from './index';

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
    const calls: Captured[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('tavily provider', () => {
    test('sends the documented request and maps results', async () => {
        const { impl, calls } = fakeFetch(200, {
            results: [
                { title: 'Acme raises $45 million', url: 'https://techcrunch.com/acme', content: 'Acme raised $45 million.', score: 0.9, raw_content: 'Full text', published_date: '2026-05-01' },
                { title: 'bad', url: 'javascript:alert(1)', content: 'x' },
            ],
        });
        const provider = createTavilyProvider('tvly-test', {});
        const outcome = await provider.search({
            query: 'acme funding',
            includeDomains: ['techcrunch.com'],
            includeRawContent: true,
            depth: 'advanced',
            startDate: '2025-01-01',
            fetchImpl: impl,
        });

        expect(calls[0].url).toBe(TAVILY_ENDPOINT);
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test');
        const sent = JSON.parse(String(calls[0].init.body));
        expect(sent).toMatchObject({
            query: 'acme funding',
            search_depth: 'advanced',
            include_raw_content: 'text',
            include_domains: ['techcrunch.com'],
            start_date: '2025-01-01',
            include_published_date: true,
        });

        expect(outcome.kind).toBe('ok');
        if (outcome.kind !== 'ok') return;
        expect(outcome.results).toHaveLength(1); // the non-http URL is dropped
        expect(outcome.results[0]).toMatchObject({ url: 'https://techcrunch.com/acme', rawContent: 'Full text', publishedDate: '2026-05-01' });
        expect(outcome.costUsd).toBeCloseTo(0.016);
    });

    test.each([
        [401, 'unauthorized'],
        [432, 'quota_exhausted'],
        [433, 'quota_exhausted'],
        [500, 'error'],
    ])('HTTP %i → %s', async (status, kind) => {
        const { impl } = fakeFetch(status, 'nope');
        const outcome = await createTavilyProvider('k', {}).search({ query: 'q', fetchImpl: impl });
        expect(outcome.kind).toBe(kind as never);
    });

    test('429 is throttled and carries Retry-After', async () => {
        const { impl } = fakeFetch(429, 'slow down', { 'retry-after': '30' });
        const outcome = await createTavilyProvider('k', {}).search({ query: 'q', fetchImpl: impl });
        expect(outcome).toEqual({ kind: 'throttled', retryAfterMs: 30_000 });
    });

    test('a network failure is an error outcome, not a throw', async () => {
        const impl = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
        const outcome = await createTavilyProvider('k', {}).search({ query: 'q', fetchImpl: impl });
        expect(outcome.kind).toBe('error');
    });

    test('cost follows credits and the per-credit override', () => {
        expect(tavilyCostUsd('basic', {})).toBeCloseTo(0.008);
        expect(tavilyCostUsd('advanced', { TAVILY_COST_PER_CREDIT_USD: '0.005' })).toBeCloseTo(0.01);
    });

    test('no key means no provider', () => {
        expect(resolveSearchProvider({})).toBeNull();
        expect(resolveSearchProvider({ TAVILY_API_KEY: 'tvly-x' })?.name).toBe('tavily');
    });
});
