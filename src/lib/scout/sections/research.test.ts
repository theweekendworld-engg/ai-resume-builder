/**
 * The research sections: company, comp, interviews, talent.
 *
 * No network and no model. The provider is injected, the cache is in memory,
 * and `ctx.step.ai` returns scripted output — which is what lets these tests
 * play the model at its worst: pointing at results that do not exist, quoting
 * figures the page never printed, and inventing numbers in prose. Every one of
 * those must be dropped by code, which is the claim under test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StepContext } from '@/lib/agent/run';
import { SourceSet } from '@/lib/agent/sources';
import type { EnrichCompanyResult } from '@/lib/enrichment/enrich';
import { __testing as cacheTesting, createMemoryStore } from '@/lib/research/cache';
import { __testing as providerTesting } from '@/lib/research/providers';
import { RESEARCH_OFF_REASON } from '@/lib/research/search';
import type { SearchArgs, SearchOutcome, SearchProvider, SearchResult } from '@/lib/research/types';
import type { SectionContext } from '@/lib/scout/section';
import type { ScoutSections } from '@/lib/scout/types';
import { __testing as companyTesting, companySection } from './company';
import { __testing as compTesting, compSection } from './comp';
import { interviewsSection } from './interviews';
import { NOT_ENOUGH_EVIDENCE, talentSection } from './talent';

// ───────────────────────────────────────────────────────────── fixtures

const AT = new Date().toISOString();

const JOB_SECTIONS: ScoutSections = {
    jd: {
        status: 'ok',
        sources: [],
        finishedAt: AT,
        data: {
            role: 'Software Engineer II',
            company: 'Acme',
            seniority: 'mid',
            domain: 'payments',
            location: 'Bengaluru, Karnataka, India',
            workMode: 'hybrid',
            employmentType: null,
            compensationText: null,
            experienceText: null,
            requirements: [],
            skills: [],
            responsibilities: [],
            applyUrl: null,
        },
    },
};

function page(url: string, title: string, text: string, publishedDate: string | null = '2026-04-02'): SearchResult {
    return { url, title, content: text, rawContent: null, publishedDate, score: 0.5 };
}

type ProviderScript = (args: SearchArgs) => SearchOutcome;

function fakeProvider(script: ProviderScript) {
    const calls: SearchArgs[] = [];
    const provider: SearchProvider = {
        name: 'fake',
        async search(args) {
            calls.push(args);
            return script(args);
        },
    };
    return { provider, calls };
}

function makeCtx(respond: (system: string, prompt: string) => unknown, sections: ScoutSections = JOB_SECTIONS) {
    const sources = new SourceSet();
    let cost = 0;
    const aiCalls: string[] = [];
    const step: StepContext = {
        runId: 'run-test',
        userId: 'user-test',
        stepName: 'test',
        sources,
        signal: new AbortController().signal,
        ai: (async (opts: { system: string; prompt: string }) => {
            aiCalls.push(opts.prompt);
            return {
                data: respond(opts.system, opts.prompt),
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.0001, calls: 1, latencyMs: 1 },
                degraded: false,
                guardViolations: [],
            };
        }) as unknown as StepContext['ai'],
        addCost: (usd) => { cost += usd; },
        log: () => undefined,
    };
    const ctx: SectionContext = { runId: 'run-test', userId: 'user-test', input: { source: 'dashboard' }, answers: {}, sections, step };
    return { ctx, sources, cost: () => cost, aiCalls };
}

const emptyEnrichment = {
    insightId: null,
    normalizedCompanyName: 'acme',
    fields: { employeeCount: null, fundingTotal: null, revenueEstimateText: null },
    provenance: {},
    confidence: 0,
    freshnessLabel: '',
    providerFacts: {},
    hiring: { ok: false, refusal: { reason: 'no_postings', total: 0, placeable: 0 } },
    providerOutcome: 'no_provider',
} as unknown as EnrichCompanyResult;

beforeEach(() => {
    cacheTesting.setStore(createMemoryStore());
    companyTesting.setEnricher(async () => emptyEnrichment);
    compTesting.setBandLoader(async () => null);
});

afterEach(() => {
    providerTesting.setProvider(undefined);
    cacheTesting.setStore(null);
    companyTesting.setEnricher(null);
    compTesting.setBandLoader(null);
});

// ───────────────────────────────────────────────────────────── company

const FUNDING_PAGE = page(
    'https://techcrunch.com/2026/04/02/acme-series-c',
    'Acme raises $45 million Series C',
    'Acme, the Bengaluru payments company, raised $45 million in a Series C led by Sequoia. Acme now has about 1,200 employees.',
);

describe('company', () => {
    test('keeps a verified fact and drops the hallucinated and fabricated ones', async () => {
        const { provider } = fakeProvider(() => ({ kind: 'ok', results: [FUNDING_PAGE], costUsd: 0.008 }));
        providerTesting.setProvider(provider);
        const { ctx, cost } = makeCtx(() => ({
            facts: [
                { resultIndex: 1, label: 'Latest round', value: '$45 million' },
                // points at a result that does not exist — the only way to invent a source
                { resultIndex: 7, label: 'Valuation', value: '$1 billion' },
                // quotes a figure the page never printed
                { resultIndex: 1, label: 'Revenue', value: '$80 million' },
            ],
            // cites a number from no kept fact
            growthNote: 'Acme grew revenue 3x after raising $45 million.',
        }));

        const outcome = await companySection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.facts).toHaveLength(1);
        expect(outcome.data.facts[0]).toMatchObject({ value: '$45 million', sourceUrl: FUNDING_PAGE.url, asOf: '2026-04-02' });
        expect(outcome.data.growthNote).toBeNull();
        // two searches at $0.008, and the model call is charged by the harness, not here
        expect(cost()).toBeCloseTo(0.016);
    });

    test('facts about a different company are dropped', async () => {
        const other = page('https://inc42.com/acmetech', 'Acmetech raises $10 million', 'Acmetech raised $10 million.');
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [other], costUsd: 0 })).provider);
        const { ctx } = makeCtx(() => ({ facts: [{ resultIndex: 1, label: 'Round', value: '$10 million' }], growthNote: null }));
        const outcome = await companySection(ctx);
        // Still a section — the observed-hiring statement is real data — but
        // nothing from Acmetech's page made it in.
        const data = outcome.status === 'ok' || outcome.status === 'unavailable' ? outcome.data : undefined;
        expect(data?.facts ?? []).toHaveLength(0);
        expect(data?.hiringStatement).toBeTruthy();
    });

    test('a cache hit makes zero provider calls and still passes the citation check', async () => {
        const first = fakeProvider(() => ({ kind: 'ok', results: [FUNDING_PAGE], costUsd: 0.008 }));
        providerTesting.setProvider(first.provider);
        const respond = () => ({ facts: [{ resultIndex: 1, label: 'Latest round', value: '$45 million' }], growthNote: null });
        await companySection(makeCtx(respond).ctx);
        expect(first.calls.length).toBeGreaterThan(0);

        const second = fakeProvider(() => ({ kind: 'ok', results: [], costUsd: 0.008 }));
        providerTesting.setProvider(second.provider);
        const { ctx, sources, aiCalls, cost } = makeCtx(respond);
        const outcome = await companySection(ctx);

        expect(second.calls).toHaveLength(0);
        expect(aiCalls).toHaveLength(0);
        expect(cost()).toBe(0);
        expect(sources.has(FUNDING_PAGE.url)).toBe(true);
        expect(outcome.status).toBe('ok');
        if (outcome.status === 'ok') expect(outcome.data.facts[0].value).toBe('$45 million');
    });

    test('not configured → unavailable with the stated reason', async () => {
        providerTesting.setProvider(null);
        const outcome = await companySection(makeCtx(() => ({ facts: [], growthNote: null })).ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') expect(outcome.reason).toContain(RESEARCH_OFF_REASON);
    });

    test('not configured still returns provider facts it has, as data', async () => {
        providerTesting.setProvider(null);
        companyTesting.setEnricher(async () => ({
            ...emptyEnrichment,
            fields: { employeeCount: 1200, fundingTotal: null, revenueEstimateText: '$10M-$25M' },
            provenance: { employeeCount: { source: 'provider', provider: 'pdl', observedAt: AT } },
        }) as EnrichCompanyResult);
        const outcome = await companySection(makeCtx(() => ({ facts: [], growthNote: null })).ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') {
            expect(outcome.reason).toBe(RESEARCH_OFF_REASON);
            expect(outcome.data?.employeeCount).toBe(1200);
            expect(outcome.data?.provenance.employeeCount).toBe('provider:pdl');
        }
    });

    test('throttled → unavailable with a retry reason, nothing cached', async () => {
        const store = createMemoryStore();
        cacheTesting.setStore(store);
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'throttled', retryAfterMs: 1000 })).provider);
        const outcome = await companySection(makeCtx(() => ({ facts: [], growthNote: null })).ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') expect(outcome.reason).toMatch(/rate-limiting/);
        expect(store.rows.size).toBe(0);
    });

    test('no company named → unavailable without searching', async () => {
        const { provider, calls } = fakeProvider(() => ({ kind: 'ok', results: [], costUsd: 0 }));
        providerTesting.setProvider(provider);
        const outcome = await companySection(makeCtx(() => ({}), {}).ctx);
        expect(outcome.status).toBe('unavailable');
        expect(calls).toHaveLength(0);
    });
});

// ──────────────────────────────────────────────────────────────── comp

describe('comp', () => {
    const levels = page(
        'https://www.levels.fyi/companies/acme/salaries/software-engineer',
        'Acme Software Engineer Salary',
        'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year. Median ₹44L.',
    );

    test('quoted figures survive; converted or averaged ones do not', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [levels], costUsd: 0.008 })).provider);
        const { ctx } = makeCtx(() => ({
            figures: [
                { resultIndex: 1, label: 'Software Engineer II total compensation, Bengaluru', value: '₹38L - ₹52L', context: 'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year.' },
                // a currency conversion the page never printed
                { resultIndex: 1, label: 'Software Engineer II total compensation (USD)', value: '$45,000 - $62,000', context: 'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year.' },
                // an average across sources
                { resultIndex: 1, label: 'Average', value: '₹45L', context: 'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year.' },
                { resultIndex: 4, label: 'SDE III', value: '₹70L', context: 'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year.' },
            ],
        }));
        const outcome = await compSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.figures.map((figure) => figure.value)).toEqual(['₹38L - ₹52L']);
        expect(outcome.data.caveat.length).toBeGreaterThan(20);
    });

    // Live run 2026-09-25: a Glassdoor JOBS page printed "₹6L - ₹8L" as the
    // estimated salary of some listing, and it shipped as the pay for a
    // 5-years backend role. The number was on the page; the page was the wrong kind.
    test('a jobs-listing page is never a salary source, whatever it prints', async () => {
        const listing = page(
            'https://www.glassdoor.co.in/Jobs/Acme-Bengaluru-Jobs-EI_IE1.0,4_IL.5,14.htm',
            'Acme Jobs & Careers - 31 Open Positions',
            'Backend Software Engineer. Acme. Bengaluru. ₹6L - ₹8L Backend Software Engineer estimated salary per year.',
        );
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [listing], costUsd: 0.008 })).provider);
        const { ctx } = makeCtx(() => ({
            figures: [{
                resultIndex: 1,
                label: 'Backend Software Engineer estimated salary, Bengaluru',
                value: '₹6L - ₹8L',
                context: '₹6L - ₹8L Backend Software Engineer estimated salary per year.',
            }],
        }));
        const outcome = await compSection(ctx);
        expect(outcome.status === 'ok' ? outcome.data.figures : outcome.status === 'unavailable' ? outcome.data?.figures ?? [] : []).toEqual([]);
    });

    test('a label may not claim a level its quote does not state', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [levels], costUsd: 0.008 })).provider);
        const { ctx } = makeCtx(() => ({
            figures: [{
                resultIndex: 1,
                // the page says "Software Engineer II"; "Senior" is the model's upgrade
                label: 'Senior Software Engineer total compensation',
                value: '₹38L - ₹52L',
                context: 'Acme Software Engineer II in Bengaluru: total compensation ₹38L - ₹52L per year.',
            }],
        }));
        const outcome = await compSection(ctx);
        expect(outcome.status).toBe('unavailable');
    });

    test('a context the page does not contain is rejected', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [levels], costUsd: 0.008 })).provider);
        const { ctx } = makeCtx(() => ({
            figures: [{
                resultIndex: 1,
                label: 'Software Engineer II total compensation',
                value: '₹38L - ₹52L',
                context: 'Software Engineer II base salary ₹38L - ₹52L for backend engineers',
            }],
        }));
        const outcome = await compSection(ctx);
        expect(outcome.status).toBe('unavailable');
    });

    test('an observed band is shown even when research is off', async () => {
        providerTesting.setProvider(null);
        compTesting.setBandLoader(async () => ({ n: 12, statement: 'INR 3,000,000–5,000,000 a year… Based on 12 disclosed ranges, last 150 days.' }));
        const outcome = await compSection(makeCtx(() => ({ figures: [] })).ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') {
            expect(outcome.reason).toBe(RESEARCH_OFF_REASON);
            expect(outcome.data?.observedBand?.n).toBe(12);
        }
    });

    test('nothing found anywhere → unavailable that names the floor', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [], costUsd: 0.008 })).provider);
        const outcome = await compSection(makeCtx(() => ({ figures: [] })).ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') expect(outcome.reason).toContain('fewer than 8');
    });
});

// ────────────────────────────────────────────────────────── interviews

describe('interviews', () => {
    const reddit = page(
        'https://www.reddit.com/r/developersIndia/comments/abc/acme_sde2_interview',
        'Acme SDE 2 interview experience (Bengaluru)',
        'Interviewed at Acme for SDE 2 in March. 4 rounds: two DSA rounds on graphs and DP, one low level design round, and a hiring manager chat.',
    );
    const youtube = page('https://www.youtube.com/watch?v=xyz', 'My Acme interview experience', 'I walk through my Acme interview, the LLD round and the DSA rounds.');

    test('links come only from results; snippets and themes are verified', async () => {
        providerTesting.setProvider(fakeProvider((args) => ({
            kind: 'ok',
            results: args.includeDomains?.includes('youtube.com') ? [youtube] : [reddit],
            costUsd: 0.008,
        })).provider);
        const { ctx } = makeCtx(() => ({
            picks: [
                { resultIndex: 1, relevance: 'SDE 2, Bengaluru, 4 rounds', snippet: 'two DSA rounds on graphs and DP' },
                // an invented snippet falls back to the page's own words
                { resultIndex: 2, relevance: 'Video walkthrough', snippet: 'They asked me to design Uber in 20 minutes.' },
                // an invented result
                { resultIndex: 9, relevance: 'x', snippet: 'x' },
                // relevance with a number the page does not have
                { resultIndex: 1, relevance: 'dup', snippet: '' },
            ],
            themes: ['DSA: graphs and DP', 'Low level design', 'System design of payment gateways'],
        }));

        const outcome = await interviewsSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.links.map((link) => link.source)).toEqual(['reddit', 'youtube']);
        expect(outcome.data.links[0].snippet).toBe('two DSA rounds on graphs and DP');
        expect(outcome.data.links[1].snippet).toContain('I walk through my Acme interview');
        expect(outcome.data.themes).toEqual(['DSA: graphs and DP', 'Low level design']);
    });

    test('searches are site-scoped and never date-filtered at the provider', async () => {
        const { provider, calls } = fakeProvider(() => ({ kind: 'ok', results: [reddit], costUsd: 0.008 }));
        providerTesting.setProvider(provider);
        await interviewsSection(makeCtx(() => ({ picks: [{ resultIndex: 1, relevance: 'SDE 2', snippet: '' }], themes: [] })).ctx);
        expect(calls.length).toBeLessThanOrEqual(3);
        expect(calls[0].includeDomains).toContain('leetcode.com');
        // Undated forum posts would vanish (see the date-filter describe below).
        expect(calls[0].startDate).toBeUndefined();
    });

    test('not configured → unavailable', async () => {
        providerTesting.setProvider(null);
        const outcome = await interviewsSection(makeCtx(() => ({})).ctx);
        expect(outcome).toEqual({ status: 'unavailable', reason: RESEARCH_OFF_REASON });
    });
});

// ────────────────────────────────────────────────────────────── talent

describe('talent', () => {
    const news = page('https://economictimes.indiatimes.com/acme-campus', 'Acme campus hiring',
        'Acme hired 40 engineers from IIT Bombay and BITS Pilani in its 2025 campus drive.');
    const blind = page('https://www.teamblind.com/post/acme-team', 'Acme team background',
        'Most of my team at Acme came from NITs and IIITs.');

    test('one source is low confidence', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [news], costUsd: 0.008 })).provider);
        const outcome = await talentSection(makeCtx(() => ({
            statements: [{ resultIndex: 1, label: 'Campus hiring', quote: 'Acme hired 40 engineers from IIT Bombay and BITS Pilani' }],
            note: 'Acme hires campus engineers from IIT Bombay and BITS Pilani.',
        })).ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status === 'ok') expect(outcome.data.confidence).toBe('low');
    });

    test('two independent sites allow medium; a fabricated number empties the note', async () => {
        providerTesting.setProvider(fakeProvider((args) => ({
            kind: 'ok',
            results: args.includeDomains ? [blind] : [news],
            costUsd: 0.008,
        })).provider);
        const outcome = await talentSection(makeCtx(() => ({
            statements: [
                { resultIndex: 1, label: 'Campus hiring', quote: 'Acme hired 40 engineers from IIT Bombay and BITS Pilani' },
                { resultIndex: 2, label: 'Team background', quote: 'Most of my team at Acme came from NITs and IIITs.' },
            ],
            note: '80% of Acme engineers are from elite colleges.',
        })).ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.confidence).toBe('medium');
        expect(outcome.data.note).toBeNull();
    });

    test('no surviving quote → "not enough public evidence"', async () => {
        providerTesting.setProvider(fakeProvider(() => ({ kind: 'ok', results: [news], costUsd: 0.008 })).provider);
        const outcome = await talentSection(makeCtx(() => ({
            statements: [{ resultIndex: 1, label: 'Background', quote: 'Everyone at Acme is from IIT Delhi.' }],
            note: null,
        })).ctx);
        expect(outcome).toEqual({ status: 'unavailable', reason: NOT_ENOUGH_EVIDENCE });
    });
});

// Live run 2026-09-26: Tavily's start_date drops pages with no published date,
// which is nearly every forum post. The Amazon SDE II write-ups search went
// from 10 results to 0, and the empty result was cached for every user. No
// research section may filter by date at the provider.
describe('no research search filters by date', () => {
    test.each([
        ['company', companySection],
        ['comp', compSection],
        ['interviews', interviewsSection],
        ['talent', talentSection],
    ] as const)('%s never sends startDate', async (_name, section) => {
        const fake = fakeProvider(() => ({ kind: 'ok', results: [], costUsd: 0.008 }));
        providerTesting.setProvider(fake.provider);
        await section(makeCtx(() => ({ figures: [], picks: [], themes: [], facts: [], quotes: [] })).ctx).catch(() => undefined);
        expect(fake.calls.length).toBeGreaterThan(0);
        for (const call of fake.calls) expect(call.startDate).toBeUndefined();
    });
});
