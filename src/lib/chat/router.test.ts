import { afterEach, describe, expect, test } from 'bun:test';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { classifySection } from '@/lib/scout/sections/classify';
import { fakeContext } from '@/lib/scout/ingest/testContext.test-utils';
import {
    NO_GUESS_REPLY,
    deterministicRoute,
    emptyDecision,
    renderContext,
    routeMessage,
    sanitizeDecision,
} from './router';
import type { ChatContext, ChatJob } from './types';

const JOB: ChatJob = {
    workspaceId: 'ws_1', runId: 'run_1', company: 'Eltropy', role: 'Senior Backend Engineer', status: 'analyzed',
    verdict: 'possible', fitScore: 71, sourceUrl: 'https://www.linkedin.com/jobs/view/1/', topStrength: null, topConcern: null,
};
const OTHER: ChatJob = { ...JOB, workspaceId: 'ws_2', runId: 'run_2', company: 'Razorpay', role: 'SDE II' };

const context = (jobs: ChatJob[] = [JOB, OTHER]): ChatContext => ({ jobs, openQuestion: null, draftCount: 2, hasBaseResume: true, looking: { roles: [], locations: [], remote: false } });

afterEach(() => aiTesting.reset());

describe('deterministicRoute', () => {
    test('a bare link is a job to analyse, with no model call', () => {
        const decision = deterministicRoute('https://www.linkedin.com/jobs/view/4424231243/');
        expect(decision?.action).toBe('analyze_job');
        expect(decision?.url).toBe('https://www.linkedin.com/jobs/view/4424231243/');
    });

    test('a link with a request around it goes to the model', () => {
        expect(deterministicRoute('can you research the company behind https://acme.com please')).toBeNull();
        expect(deterministicRoute('shipped the retry queue today')).toBeNull();
    });
});

describe('renderContext', () => {
    test('numbers jobs from 1 so the model can pick by index', () => {
        const text = renderContext(context());
        expect(text).toContain('1. Senior Backend Engineer, at Eltropy, status analyzed, fit possible 71');
        expect(text).toContain('2. SDE II, at Razorpay');
        expect(text).toContain('Unconfirmed Work Log drafts: 2.');
    });
});

describe('sanitizeDecision', () => {
    test('an index outside the list is never acted on', () => {
        const out = sanitizeDecision(emptyDecision('tailor_resume', 'ok', { jobIndex: 7 }), context(), 'tailor it');
        expect(out.action).toBe('clarify');
    });

    test('with exactly one job, "it" means that job', () => {
        const out = sanitizeDecision(emptyDecision('tailor_resume', 'ok'), context([JOB]), 'tailor it');
        expect(out.action).toBe('tailor_resume');
        expect(out.jobIndex).toBe(1);
    });

    test('with no jobs, a job action says how to add one', () => {
        const out = sanitizeDecision(emptyDecision('draft_outreach', 'ok'), context([]), 'write to the recruiter');
        expect(out.action).toBe('clarify');
        expect(out.reply).toContain('job link');
    });

    test('a URL the user did not send is replaced by the one they did', () => {
        const message = 'is this a fit https://jobs.example.com/123';
        const out = sanitizeDecision(emptyDecision('analyze_job', 'ok', { url: 'https://evil.example/' }), context(), message);
        expect(out.url).toBe('https://jobs.example.com/123');
    });

    test('a status update without a status asks what happened', () => {
        const out = sanitizeDecision(emptyDecision('update_job', 'ok', { jobIndex: 1 }), context(), 'update eltropy');
        expect(out.action).toBe('clarify');
    });

    test('log_work keeps the user\'s own words when the model drops them', () => {
        const out = sanitizeDecision(emptyDecision('log_work', 'ok'), context(), 'cut p99 from 900ms to 300ms');
        expect(out.text).toBe('cut p99 from 900ms to 300ms');
    });
});

describe('routeMessage', () => {
    const route = (object: Record<string, unknown>) => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => ({ object: { ...emptyDecision('answer', ''), ...object }, inputTokens: 1, outputTokens: 1 }));
    };

    test('an invented figure is stripped, and the reply says it will not guess', async () => {
        route({ action: 'answer', reply: 'SDE II pay at Razorpay is about 42 LPA.' });
        const { decision } = await routeMessage({
            userId: 'user_route', message: 'what does Razorpay pay an SDE II?', history: [], context: context(),
        });
        expect(decision.reply).toBe(NO_GUESS_REPLY);
        expect(decision.reply).not.toContain('42');
    });

    test('a figure the user gave is allowed back', async () => {
        route({ action: 'log_work', reply: 'Drafting: p99 from 900ms to 300ms.', text: 'cut p99 from 900ms to 300ms' });
        const { decision } = await routeMessage({
            userId: 'user_route', message: 'cut p99 from 900ms to 300ms', history: [], context: context(),
        });
        expect(decision.action).toBe('log_work');
        expect(decision.reply).toContain('300ms');
    });

    test('a bare link never reaches the model', async () => {
        aiTesting.setObjectRunner(async () => {
            throw new Error('the model must not be called');
        });
        const { decision, costUsd } = await routeMessage({
            userId: 'user_route', message: 'https://boards.greenhouse.io/acme/jobs/1', history: [], context: context(),
        });
        expect(decision.action).toBe('analyze_job');
        expect(costUsd).toBe(0);
    });
});

describe('research_company intent in Scout', () => {
    test('a named company skips classification and runs the company plan', async () => {
        const { ctx, aiCalls } = fakeContext({
            input: { text: 'Research the company: Razorpay', source: 'dashboard', intent: 'company_research', company: 'Razorpay' },
            sections: {
                ingest: {
                    status: 'ok',
                    data: {
                        sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: null, author: null, authorUrl: null,
                        companyName: null, location: null, postedAt: null, applicantsText: null,
                        text: 'Research the company: Razorpay', truncated: false,
                    },
                },
            } as never,
        });
        const outcome = await classifySection(ctx);
        expect(outcome.status).toBe('ok');
        expect(outcome.status === 'ok' && outcome.data.kind).toBe('company_signal');
        expect(outcome.status === 'ok' && outcome.data.companies).toEqual(['Razorpay']);
        expect(aiCalls).toHaveLength(0);
    });
});
