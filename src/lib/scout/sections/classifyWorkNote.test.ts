import { describe, expect, test } from 'bun:test';
import { classifySection, looksLikeWorkNote, workNoteAllowed } from './classify';
import { fakeContext } from '@/lib/scout/ingest/testContext.test-utils';
import type { IngestData, ScoutSections } from '@/lib/scout/types';

function typed(text: string, overrides: Partial<IngestData> = {}): IngestData {
    return {
        sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: null, author: null, authorUrl: null,
        companyName: null, location: null, postedAt: null, applicantsText: null, text, truncated: false,
        ...overrides,
    };
}

function sectionsOf(data: IngestData): ScoutSections {
    return { ingest: { status: 'ok', data, sources: [], finishedAt: new Date().toISOString() } };
}

const NOTE = 'shipped the retry queue today, p99 down from 900ms to 300ms';
const HIRING = "We're hiring backend engineers at Razorpay, DM me";
const ADVICE = `Most engineers get system design interviews wrong because they jump to the solution.
Clarify requirements for five minutes, estimate scale with rough numbers, sketch the API before the
boxes, and go deep on one bottleneck. Interviewers are grading your reasoning, not your diagram.`;

describe('looksLikeWorkNote (the cheap lean the model is shown)', () => {
    test.each([
        NOTE,
        'I led the payments migration to Postgres this sprint',
        'Fixed the flaky checkout test that blocked three releases',
        'got feedback from my manager that the RFC was the clearest one this quarter',
    ])('%s → leans work_note', (text) => {
        expect(looksLikeWorkNote(text)).toBe(true);
    });

    test.each([
        HIRING,
        ADVICE,
        'https://www.linkedin.com/jobs/view/4455902670',
        'What do you think about Rust for backend services?',
    ])('%s → no lean', (text) => {
        expect(looksLikeWorkNote(text)).toBe(false);
    });
});

describe('workNoteAllowed', () => {
    test('typed or pasted text can be a note about the sender', () => {
        expect(workNoteAllowed(typed(NOTE))).toBe(true);
    });

    test('a post read from a link is somebody else’s, never the user’s Win', () => {
        expect(workNoteAllowed(typed(NOTE, { linkKind: 'linkedin_post', fetchVia: 'public_html', sourceUrl: 'https://www.linkedin.com/posts/x' }))).toBe(false);
        expect(workNoteAllowed(typed(NOTE, { author: 'Someone Else' }))).toBe(false);
    });
});

describe('classify section with work_note', () => {
    test('a typed note the model calls work_note stays work_note, and the prompt carries the hint', async () => {
        const { ctx, aiCalls } = fakeContext({
            sections: sectionsOf(typed(NOTE)),
            aiResponses: [{ kind: 'work_note', confidence: 0.92, companies: [], roleTitle: null, reason: 'A note about work you shipped.' }],
        });
        const outcome = await classifySection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.kind).toBe('work_note');
        expect(aiCalls[0].prompt).toContain('reads like a short note about the sender');
        expect(aiCalls[0].system).toContain('work_note');
    });

    test('a hiring post stays a hiring post', async () => {
        const { ctx, aiCalls } = fakeContext({
            sections: sectionsOf(typed(HIRING)),
            aiResponses: [{ kind: 'hiring_post', confidence: 0.95, companies: ['Razorpay'], roleTitle: 'backend engineers', reason: 'A hiring post for Razorpay.' }],
        });
        const outcome = await classifySection(ctx);
        if (outcome.status !== 'ok') throw new Error('expected ok');
        expect(outcome.data.kind).toBe('hiring_post');
        expect(outcome.data.companies).toEqual(['Razorpay']);
        expect(aiCalls[0].prompt).not.toContain('reads like a short note');
    });

    test('an advice post stays knowledge', async () => {
        const { ctx } = fakeContext({
            sections: sectionsOf(typed(ADVICE)),
            aiResponses: [{ kind: 'knowledge', confidence: 0.9, companies: [], roleTitle: null, reason: 'Advice on system design interviews.' }],
        });
        const outcome = await classifySection(ctx);
        if (outcome.status !== 'ok') throw new Error('expected ok');
        expect(outcome.data.kind).toBe('knowledge');
    });

    test('work_note on a post read from a link is overruled in code', async () => {
        const fetched = typed('Thrilled to share we shipped our new payments API today!', {
            linkKind: 'linkedin_post',
            fetchVia: 'public_html',
            sourceUrl: 'https://www.linkedin.com/posts/someone_activity-1',
            author: 'Someone Else',
        });
        const { ctx, aiCalls } = fakeContext({
            sections: sectionsOf(fetched),
            aiResponses: [{ kind: 'work_note', confidence: 0.8, companies: [], roleTitle: null, reason: 'x' }],
        });
        const outcome = await classifySection(ctx);
        if (outcome.status !== 'ok') throw new Error('expected ok');
        expect(outcome.data.kind).toBe('other');
        expect(outcome.data.reason).toContain('someone else');
        expect(aiCalls[0].prompt).toContain('written by someone else');
    });
});
