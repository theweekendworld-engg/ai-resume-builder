import { afterEach, describe, expect, test } from 'bun:test';
import { ingestSection, __testing as ingestTesting } from './ingest';
import { classifySection, deterministicClassification, verifiedCompanies } from './classify';
import { fakeContext, fakeFetch, fixture, publicResolver } from '@/lib/scout/ingest/testContext.test-utils';
import type { IngestData, ScoutSections } from '@/lib/scout/types';

afterEach(() => ingestTesting.reset());

function storedIngest(data: IngestData): ScoutSections {
    return { ingest: { status: 'ok', data, sources: [], finishedAt: new Date().toISOString() } };
}

const baseIngest: IngestData = {
    sourceUrl: null,
    linkKind: 'text',
    fetchVia: 'provided_text',
    title: null,
    author: null,
    authorUrl: null,
    companyName: null,
    location: null,
    postedAt: null,
    applicantsText: null,
    text: '',
    truncated: false,
};

// ─────────────────────────────────────────────────────────────── ingest

describe('ingest section', () => {
    test('a LinkedIn job link is fetched and every page read becomes a source', async () => {
        const { impl } = fakeFetch({ 'jobs-guest/jobs/api/jobPosting/4455902670': { body: fixture('linkedin-guest-job.html') } });
        ingestTesting.setFetch({ fetchImpl: impl, resolve: publicResolver });
        const { ctx, sources, aiCalls } = fakeContext({ input: { url: 'https://www.linkedin.com/jobs/view/4455902670/' } });

        const outcome = await ingestSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.companyName).toBe('Amazon');
        expect(sources.has('https://www.linkedin.com/jobs/view/4455902670/')).toBe(true);
        expect(aiCalls).toHaveLength(0);
    });

    test('provided text wins over fetching, and pasted text is not cited as the link', async () => {
        const { impl, calls } = fakeFetch({});
        ingestTesting.setFetch({ fetchImpl: impl, resolve: publicResolver });
        const { ctx, sources } = fakeContext({
            input: { url: 'https://www.linkedin.com/posts/x-activity-1', text: 'We are hiring backend engineers at Park+ in Gurugram.\nDM me.' },
        });
        const outcome = await ingestSection(ctx);
        expect(calls).toHaveLength(0);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.fetchVia).toBe('provided_text');
        expect(outcome.data.linkKind).toBe('linkedin_post');
        expect(outcome.data.title).toBe('We are hiring backend engineers at Park+ in Gurugram.');
        expect(sources.size).toBe(0);
    });

    test('extension text is the page, so it is cited under the link', async () => {
        const { ctx, sources } = fakeContext({
            input: { url: 'https://www.linkedin.com/posts/x-activity-1', text: 'Post text read in the user tab.', source: 'extension', title: 'A post' },
        });
        const outcome = await ingestSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.fetchVia).toBe('extension');
        expect(outcome.data.title).toBe('A post');
        expect(sources.has('https://www.linkedin.com/posts/x-activity-1')).toBe(true);
    });

    test('a login wall is unavailable with the paste/extension advice', async () => {
        const { impl } = fakeFetch({ 'linkedin.com/posts': { body: '<html><head><title>Sign Up | LinkedIn</title></head></html>' } });
        ingestTesting.setFetch({ fetchImpl: impl, resolve: publicResolver });
        const { ctx } = fakeContext({ input: { url: 'https://www.linkedin.com/posts/x-activity-1' } });
        const outcome = await ingestSection(ctx);
        expect(outcome.status).toBe('unavailable');
        if (outcome.status === 'unavailable') expect(outcome.reason).toContain('Send to Patronus');
    });

    test('a private-network link is refused without a request', async () => {
        const { impl, calls } = fakeFetch({ '': { body: 'x' } });
        ingestTesting.setFetch({ fetchImpl: impl, resolve: publicResolver });
        const { ctx } = fakeContext({ input: { url: 'http://169.254.169.254/latest/meta-data/' } });
        const outcome = await ingestSection(ctx);
        expect(outcome.status).toBe('unavailable');
        expect(calls).toHaveLength(0);
    });
});

// ───────────────────────────────────────────────────────────── classify

describe('classify section', () => {
    test('a fetched job link is classified with no model call', async () => {
        const { ctx, aiCalls } = fakeContext({
            sections: storedIngest({ ...baseIngest, linkKind: 'linkedin_job', fetchVia: 'guest_job_api', title: 'SDE II', companyName: 'Amazon', text: 'x' }),
        });
        const outcome = await classifySection(ctx);
        expect(aiCalls).toHaveLength(0);
        expect(outcome).toMatchObject({ status: 'ok', data: { kind: 'job_posting', confidence: 1, companies: ['Amazon'], roleTitle: 'SDE II' } });
    });

    test('a post goes to the model once, with the text capped', async () => {
        const text = `We're hiring at Park+ for SDE II Backend in Gurugram. ${'Details. '.repeat(2_000)}`;
        const { ctx, aiCalls } = fakeContext({
            sections: storedIngest({ ...baseIngest, linkKind: 'linkedin_post', fetchVia: 'public_html', author: 'Muneer', text }),
            aiResponses: [{
                kind: 'hiring_post',
                confidence: 0.93,
                companies: ['Park+', 'Google'],
                roleTitle: 'SDE II Backend',
                reason: 'A hiring post for a backend SDE II at Park+.',
            }],
        });
        const outcome = await classifySection(ctx);
        expect(aiCalls).toHaveLength(1);
        expect(aiCalls[0].task).toBe('scoutClassify');
        expect(aiCalls[0].prompt.length).toBeLessThan(6_300);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.kind).toBe('hiring_post');
        // Google is not in the text: dropped.
        expect(outcome.data.companies).toEqual(['Park+']);
        expect(outcome.data.roleTitle).toBe('SDE II Backend');
    });

    test('a role title the text does not contain is dropped', async () => {
        const { ctx } = fakeContext({
            sections: storedIngest({ ...baseIngest, text: 'Five lessons from ten years of interviewing engineers. '.repeat(3) }),
            aiResponses: [{ kind: 'knowledge', confidence: 0.8, companies: [], roleTitle: 'Staff Engineer', reason: 'Advice.' }],
        });
        const outcome = await classifySection(ctx);
        if (outcome.status !== 'ok') throw new Error('expected ok');
        expect(outcome.data.roleTitle).toBeNull();
    });

    test('profiles and company pages are answered without a model', () => {
        expect(deterministicClassification({ ...baseIngest, linkKind: 'linkedin_profile', fetchVia: 'public_html' })?.kind).toBe('other');
        expect(deterministicClassification({ ...baseIngest, linkKind: 'linkedin_company', fetchVia: 'public_html', title: 'Stripe | LinkedIn' }))
            .toMatchObject({ kind: 'company_signal', companies: ['Stripe'] });
    });

    test('pasted text beside a job link still goes to the model', () => {
        expect(deterministicClassification({ ...baseIngest, linkKind: 'linkedin_job', fetchVia: 'provided_text' })).toBeNull();
    });

    test('verifiedCompanies ignores case and punctuation, dedupes, and drops inventions', () => {
        expect(verifiedCompanies(['PARK+', 'park plus', 'Stripe, Inc.', 'stripe inc', 'OpenAI'], 'Joined Park+ after Stripe, Inc.'))
            .toEqual(['PARK+', 'Stripe, Inc.']);
    });
});
