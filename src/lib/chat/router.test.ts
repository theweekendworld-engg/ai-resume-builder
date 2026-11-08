import { afterEach, describe, expect, test } from 'bun:test';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { classifySection } from '@/lib/scout/sections/classify';
import { fakeContext } from '@/lib/scout/ingest/testContext.test-utils';
import {
    NO_GUESS_REPLY,
    ROUTER_SYSTEM,
    deterministicRoute,
    emptyDecision,
    renderContext,
    routeMessage,
    sanitizeDecision,
    trailingToolInTitle,
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

    test('long-term memory joins the context, in the user\'s words; absent, nothing is said', () => {
        const withMemory = renderContext({ ...context(), memoryIndex: '- Claude: voice agent on Claude Sonnet at Plivo\n- Work mode: remote' });
        expect(withMemory).toContain('What the user told you on earlier days (their words):');
        expect(withMemory).toContain('- Claude: voice agent on Claude Sonnet at Plivo');
        expect(renderContext(context())).not.toContain('earlier days');
        expect(renderContext({ ...context(), memoryIndex: '   ' })).not.toContain('earlier days');
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

    test('a figure the user told us on an earlier day is allowed back: memory is guard source', async () => {
        let prompt = '';
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async (args) => {
            prompt = args.prompt;
            return { object: { ...emptyDecision('answer', ''), action: 'answer', reply: 'Yes: your Plivo agent on Claude handles 2k calls a day.' }, inputTokens: 1, outputTokens: 1 };
        });
        const { decision } = await routeMessage({
            userId: 'user_route', message: 'have I worked with Claude?', history: [],
            context: { ...context(), memoryIndex: '- Claude: Plivo voice agent on Claude Sonnet, 2k calls a day' },
        });
        expect(prompt).toContain('- Claude: Plivo voice agent on Claude Sonnet, 2k calls a day');
        expect(decision.reply).toContain('2k calls a day');
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

describe('a trailing "| Claude" in a job title is the tool, not the employer (QA 2026-11-07)', () => {
    const TITLE = 'Forward Deployed AI Engineer (#C3) | Claude';

    test('the title and the tool are told apart; a real company after the pipe is left alone', () => {
        expect(trailingToolInTitle(TITLE)).toEqual({ title: 'Forward Deployed AI Engineer', tool: 'Claude' });
        expect(trailingToolInTitle('Backend Engineer | Go')).toEqual({ title: 'Backend Engineer', tool: 'Go' });
        expect(trailingToolInTitle('Backend Engineer | Stripe')).toBeNull();
        expect(trailingToolInTitle(`${TITLE}\nWe are hiring…`)).toBeNull();
    });

    test('"openings at Claude" becomes a request for the posting', () => {
        const decision = sanitizeDecision(emptyDecision('clarify', 'Are you looking for Forward Deployed AI Engineer openings at Claude?'), context(), TITLE);
        expect(decision.action).toBe('clarify');
        expect(decision.reply).toContain('Claude is what the role works with, not the employer');
        expect(decision.company).toBeNull();
        const research = sanitizeDecision(emptyDecision('research_company', 'Looking up Claude.', { company: 'Claude' }), context(), TITLE);
        expect(research.action).toBe('clarify');
    });

    test('a job search keeps the role and drops the tool as a company', () => {
        const decision = sanitizeDecision(emptyDecision('find_jobs', 'Searching openings at Claude.', { company: 'Claude', query: 'Claude' }), context(), TITLE);
        expect(decision).toMatchObject({ action: 'find_jobs', company: null, query: 'Forward Deployed AI Engineer', reply: 'Looking for Forward Deployed AI Engineer roles.' });
    });

    test('a real company after the pipe is still researched, and the prompt says why', () => {
        expect(sanitizeDecision(emptyDecision('research_company', 'Looking up Stripe.', { company: 'Stripe' }), context(), 'Backend Engineer | Stripe').action).toBe('research_company');
        expect(ROUTER_SYSTEM).toContain('Claude, GPT and Gemini are AI models, not companies');
    });
});

