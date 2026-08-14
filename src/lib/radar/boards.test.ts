/**
 * Board adapters.
 *
 * Every fixture below is the shape a live board actually returned while this
 * was written — Greenhouse's HTML-escaped `content`, Ashby's structured
 * `compensation` object. The fetch is stubbed so these run offline and
 * deterministically; the adapters were separately driven against the real
 * hosts, which is where the response shapes came from.
 */

import { describe, expect, test } from 'bun:test';
import { adapterFor, ashbyAdapter, greenhouseAdapter, supportedProviders } from './boards';
import type { FetchOutcome } from './boards';

/** A stub `fetch` returning one canned response. */
function stubFetch(init: {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}): typeof fetch {
    return (async () =>
        new Response(init.body === undefined ? null : JSON.stringify(init.body), {
            status: init.status ?? 200,
            headers: init.headers ?? {},
        })) as unknown as typeof fetch;
}

function escaped(html: string): string {
    return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

describe('greenhouse', () => {
    const board = (jobs: unknown[]) => ({ jobs });

    test('reads a posting and its escaped pay-range block', async () => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'figma',
            fetchImpl: stubFetch({
                body: board([
                    {
                        id: 4321,
                        title: 'Senior Backend Engineer',
                        absolute_url: 'https://boards.greenhouse.io/figma/jobs/4321',
                        updated_at: '2026-07-27T11:17:30-04:00',
                        first_published: '2026-07-01T00:00:00Z',
                        location: { name: 'New York, NY' },
                        departments: [{ name: 'Engineering' }],
                        content: escaped(
                            '<div class="title">Annual Base Salary Range:</div>' +
                            '<div class="pay-range"><span>$180,000</span><span class="divider">—</span><span>$220,000 USD</span></div>',
                        ),
                    },
                ]),
                headers: { etag: 'W/"abc"' },
            }),
        });

        expect(out.kind).toBe('ok');
        if (out.kind !== 'ok') return;
        expect(out.postings).toHaveLength(1);
        const p = out.postings[0];
        expect(p.externalId).toBe('4321');
        expect(p.title).toBe('Senior Backend Engineer');
        expect(p.location).toBe('New York, NY');
        expect(p.compensation?.annualLow).toBe(180_000);
        expect(p.compensation?.annualHigh).toBe(220_000);
        expect(p.compensation?.bandEligible).toBe(true);
        expect(out.etag).toBe('W/"abc"');
    });

    test('a posting with no pay disclosure is kept, without compensation', async () => {
        // Coverage data matters: "disclosed nothing" is a real signal.
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: stubFetch({ body: board([{ id: 1, title: 'Designer', content: '<p>Join us.</p>' }]) }),
        });
        if (out.kind !== 'ok') throw new Error('expected ok');
        expect(out.postings).toHaveLength(1);
        expect(out.postings[0].compensation).toBeNull();
    });

    test('a posting missing an id or title is dropped, not half-stored', async () => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: stubFetch({ body: board([{ title: 'No id' }, { id: 2 }]) }),
        });
        if (out.kind !== 'ok') throw new Error('expected ok');
        expect(out.postings).toHaveLength(0);
    });
});

describe('ashby', () => {
    test('prefers the structured compensation field', async () => {
        const out = await ashbyAdapter.fetchBoard({
            boardToken: 'ramp',
            fetchImpl: stubFetch({
                body: {
                    jobs: [
                        {
                            id: 'abc-123',
                            title: 'Security Engineer, Cloud',
                            location: 'New York, NY (HQ)',
                            department: 'Security',
                            jobUrl: 'https://jobs.ashbyhq.com/ramp/abc-123',
                            publishedAt: '2026-04-07T00:00:00Z',
                            descriptionPlain: 'Work on cloud security.',
                            isListed: true,
                            compensation: {
                                scrapeableCompensationSalarySummary: '$211.4K - $290.6K',
                                compensationTierSummary: '$211.4K – $290.6K • Offers Equity',
                            },
                        },
                    ],
                },
            }),
        });

        if (out.kind !== 'ok') throw new Error('expected ok');
        const c = out.postings[0].compensation;
        // Decimal-K notation: $211.4K is two hundred eleven thousand four hundred.
        expect(c?.annualLow).toBe(211_400);
        expect(c?.annualHigh).toBe(290_600);
    });

    test('an employer-declared field counts as structured provenance', async () => {
        // The extractor matches a plain string and would say `prose`. It came
        // out of a dedicated compensation field, so recording it as prose
        // would understate how much the number can be trusted.
        const out = await ashbyAdapter.fetchBoard({
            boardToken: 'ramp',
            fetchImpl: stubFetch({
                body: {
                    jobs: [{
                        id: 'a', title: 'Engineer', isListed: true,
                        compensation: { scrapeableCompensationSalarySummary: '$150,000 - $190,000' },
                    }],
                },
            }),
        });
        if (out.kind !== 'ok') throw new Error('expected ok');
        expect(out.postings[0].compensation?.source).toBe('structured');
    });

    test('a delisted posting is skipped — it would age the band with dead roles', async () => {
        const out = await ashbyAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: stubFetch({
                body: { jobs: [{ id: 'a', title: 'Gone', isListed: false }, { id: 'b', title: 'Live', isListed: true }] },
            }),
        });
        if (out.kind !== 'ok') throw new Error('expected ok');
        expect(out.postings.map((p) => p.title)).toEqual(['Live']);
    });
});

describe('transport outcomes are states, not exceptions', () => {
    const cases: Array<[number, FetchOutcome['kind']]> = [
        [304, 'not_modified'],
        [404, 'not_found'],
        [410, 'not_found'],
        [429, 'throttled'],
        [503, 'throttled'],
        [500, 'error'],
    ];

    test.each(cases)('HTTP %i → %s', async (status, kind) => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: stubFetch({ status, body: {} }),
        });
        expect(out.kind).toBe(kind);
    });

    test('Retry-After is carried through so backoff can honour it', async () => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: stubFetch({ status: 429, body: {}, headers: { 'retry-after': '120' } }),
        });
        if (out.kind !== 'throttled') throw new Error('expected throttled');
        expect(out.retryAfterMs).toBe(120_000);
    });

    test('a network failure is an error value, never a thrown exception', async () => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: (async () => {
                throw new Error('ECONNRESET');
            }) as unknown as typeof fetch,
        });
        expect(out.kind).toBe('error');
    });

    test('malformed JSON is an error, not a crash mid-parse', async () => {
        const out = await greenhouseAdapter.fetchBoard({
            boardToken: 'x',
            fetchImpl: (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch,
        });
        expect(out.kind).toBe('error');
    });
});

describe('conditional requests', () => {
    test('a stored ETag is sent back as If-None-Match', async () => {
        let seen: HeadersInit | undefined;
        const spy = (async (_url: string, init?: RequestInit) => {
            seen = init?.headers;
            return new Response(null, { status: 304 });
        }) as unknown as typeof fetch;

        await greenhouseAdapter.fetchBoard({ boardToken: 'x', etag: 'W/"v1"', fetchImpl: spy });
        expect((seen as Record<string, string>)['If-None-Match']).toBe('W/"v1"');
    });

    test('every request identifies the bot with a contact URL', async () => {
        let seen: HeadersInit | undefined;
        const spy = (async (_url: string, init?: RequestInit) => {
            seen = init?.headers;
            return new Response(null, { status: 304 });
        }) as unknown as typeof fetch;

        await ashbyAdapter.fetchBoard({ boardToken: 'x', fetchImpl: spy });
        const ua = (seen as Record<string, string>)['User-Agent'];
        expect(ua).toContain('PatronusBot');
        expect(ua).toContain('http');
    });
});

describe('adapter registry', () => {
    test('resolves the providers we implement', () => {
        expect(adapterFor('greenhouse')).not.toBeNull();
        expect(adapterFor('ashby')).not.toBeNull();
        expect(supportedProviders().sort()).toEqual(['ashby', 'greenhouse']);
    });

    test('an unimplemented provider returns null rather than throwing', () => {
        // A `lever` JobSource row is legitimate; we just cannot read it yet,
        // and it must not dead-letter the ingest job.
        expect(adapterFor('lever')).toBeNull();
        expect(adapterFor('nonsense')).toBeNull();
    });
});
