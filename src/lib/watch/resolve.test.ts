import { describe, expect, test } from 'bun:test';
import { probeCompany, sameCompanyName, slugCandidates } from './resolve';

/** A fake network: URL substring → JSON body. Anything else 404s. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const url = String(input);
        const hit = Object.entries(routes).find(([pattern]) => url.includes(pattern));
        if (!hit) return new Response('Not Found', { status: 404 });
        return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
}

describe('slugCandidates', () => {
    test('whole name joined and hyphenated; generic tails only loose', () => {
        expect(slugCandidates('Zeta Technologies Pvt Ltd')).toEqual({
            exact: ['zetatechnologiespvt', 'zeta-technologies-pvt'],
            loose: ['zeta'],
        });
        expect(slugCandidates('Stripe, Inc.')).toEqual({ exact: ['stripe'], loose: [] });
        expect(slugCandidates('   ')).toEqual({ exact: [], loose: [] });
    });
});

describe('sameCompanyName', () => {
    test('case, suffixes and generic tails do not matter', () => {
        expect(sameCompanyName('SWIGGY', 'Swiggy')).toBe(true);
        expect(sameCompanyName('Stripe', 'Stripe, Inc.')).toBe(true);
        expect(sameCompanyName('Zeta', 'Zeta Technologies')).toBe(true);
    });
    test('a different company with a shared word does not verify', () => {
        expect(sameCompanyName('Zeta Global', 'Zeta')).toBe(false);
        expect(sameCompanyName('Notion Capital', 'Notion')).toBe(false);
    });
});

describe('probeCompany', () => {
    test('Greenhouse verifies by the board name', async () => {
        const hit = await probeCompany('Groww', fakeFetch({ 'boards-api.greenhouse.io/v1/boards/groww': { name: 'Groww' } }));
        expect(hit).toMatchObject({ provider: 'greenhouse', boardToken: 'groww' });
    });

    test('a Greenhouse board under the slug but another name is rejected', async () => {
        const hit = await probeCompany('Zeta', fakeFetch({ 'boards-api.greenhouse.io/v1/boards/zeta': { name: 'Zeta Global' } }));
        expect(hit).toBeNull();
    });

    test('SmartRecruiters needs postings and a matching company name', async () => {
        const empty = await probeCompany('Acme', fakeFetch({ 'smartrecruiters.com/v1/companies/acme': { totalFound: 0, content: [] } }));
        expect(empty).toBeNull();
        const hit = await probeCompany('Swiggy', fakeFetch({
            'smartrecruiters.com/v1/companies/swiggy': { totalFound: 175, content: [{ company: { name: 'SWIGGY' } }] },
        }));
        expect(hit).toMatchObject({ provider: 'smartrecruiters', boardToken: 'swiggy', openCount: 175 });
    });

    test('Lever and Ashby are only tried with the exact slug', async () => {
        const fetchImpl = fakeFetch({ 'api.lever.co/v0/postings/zeta?': [{ id: '1', text: 'Backend Engineer' }] });
        expect(await probeCompany('Zeta Technologies', fetchImpl)).toBeNull();
        expect(await probeCompany('Zeta', fetchImpl)).toMatchObject({ provider: 'lever', boardToken: 'zeta', openCount: 1 });
    });

    test('a board with openings beats an empty one', async () => {
        const hit = await probeCompany('Freshworks', fakeFetch({
            'api.lever.co/v0/postings/freshworks': [],
            'smartrecruiters.com/v1/companies/freshworks': { totalFound: 126, content: [{ company: { name: 'Freshworks' } }] },
        }));
        expect(hit?.provider).toBe('smartrecruiters');
    });

    test('nothing answers → null', async () => {
        expect(await probeCompany('Nobody Here', fakeFetch({}))).toBeNull();
    });
});
