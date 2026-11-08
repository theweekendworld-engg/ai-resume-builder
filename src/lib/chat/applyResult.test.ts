import { describe, expect, test } from 'bun:test';
import type { DraftView } from '@/lib/drafts/types';
import { applyResultReply, type ApplyResultInput } from './applyResult';
import { replyToText } from './renderText';
import { mergeMessages } from './thread';
import type { ChatMessageView } from './types';

const AT = '2026-11-08T10:00:00.000Z';

function draft(overrides: Partial<DraftView> = {}): DraftView {
    return {
        id: 'd1', version: 1, runId: 'run_1', workspaceId: 'ws_1', format: 'email', target: 'recruiter',
        toEmail: 'jobs@acme.com', subject: 'Forward Deployed AI Engineer application', body: 'Hi,\n\nMy resume is attached.\n\nJai',
        createdAt: AT, parentId: null, instruction: null, ...overrides,
    };
}

function input(overrides: Partial<ApplyResultInput> = {}): ApplyResultInput {
    return {
        runId: 'run_1', label: 'Forward Deployed AI Engineer at Acme', sessionId: 'gs_1', resumeId: 'res_1',
        pdfUrl: '/api/pdfs/pdf_1', draft: draft(), draftError: null, skipped: ['MCP', 'Claude'], applyUrl: null, ...overrides,
    };
}

describe('applyResultReply: the web thread\'s result for the apply chain', () => {
    test('an email: the resume card (completed, PDF) and the draft card, with what was not claimed', () => {
        const reply = applyResultReply(input());
        expect(reply.text).toContain('Your resume for Forward Deployed AI Engineer at Acme is ready, and so is the application email to jobs@acme.com.');
        expect(reply.text).toContain("I didn't claim MCP or Claude experience.");
        expect(reply.text).toContain('Nothing is sent from Patronus.');
        expect(reply.cards).toEqual([
            { type: 'generation', sessionId: 'gs_1', resumeId: 'res_1', status: 'completed', title: 'Forward Deployed AI Engineer at Acme', question: null, pdfUrl: '/api/pdfs/pdf_1' },
            {
                type: 'message_draft', draftId: 'd1', runId: 'run_1', format: 'email', target: 'recruiter', version: 1,
                toEmail: 'jobs@acme.com', subject: 'Forward Deployed AI Engineer application', body: 'Hi,\n\nMy resume is attached.\n\nJai',
                title: 'Forward Deployed AI Engineer at Acme', applyUrl: null, skipped: ['MCP', 'Claude'],
            },
        ]);
    });

    test('no address: a LinkedIn message, pointing at the application link', () => {
        const reply = applyResultReply(input({
            draft: draft({ format: 'linkedin_message', toEmail: null, subject: null }),
            applyUrl: 'https://jobs.globex.example/apply/42',
            skipped: [],
        }));
        expect(reply.text).toContain('here is a LinkedIn message for the recruiter: apply at the application link with the PDF, then send it.');
        expect(reply.text).not.toContain("didn't claim");
        expect(reply.cards[1]).toMatchObject({ type: 'message_draft', format: 'linkedin_message', applyUrl: 'https://jobs.globex.example/apply/42' });
        expect(reply.cards[1]).not.toHaveProperty('skipped');
    });

    test('a draft that failed: the resume, the reason, and the way to the job page', () => {
        const reply = applyResultReply(input({ draft: null, draftError: 'Could not write that draft. Try again.' }));
        expect(reply.text).toBe('Your resume for Forward Deployed AI Engineer at Acme is ready. I could not write the application draft: Could not write that draft. Try again.');
        expect(reply.cards.map((card) => card.type)).toEqual(['generation', 'link']);
        expect(reply.cards[1]).toMatchObject({ href: '/scout/run_1' });
    });

    test('as text (the CLI and channels): the draft reads as To, Subject, Body', () => {
        const text = replyToText(applyResultReply(input()), 'https://patronus.cv');
        expect(text).toContain('📄 Resume for Forward Deployed AI Engineer at Acme: https://patronus.cv/editor/res_1');
        expect(text).toContain('To: jobs@acme.com\n\nSubject: Forward Deployed AI Engineer application');
        expect(replyToText({ text: '', cards: [{ type: 'apply_chain', runId: 'run_1', stage: 'tailoring', title: null, reason: null, code: null }] }, 'https://patronus.cv'))
            .toBe('🚀 Tailoring your resume https://patronus.cv/scout/run_1');
    });
});

describe('mergeMessages', () => {
    const message = (id: string, createdAt: string): ChatMessageView => ({ id, role: 'assistant', text: id, cards: [], action: null, createdAt });

    test('a message appended later slots in by time; nothing new keeps the same array', () => {
        const current = [message('a', '2026-11-08T10:00:00Z'), message('c', '2026-11-08T10:05:00Z')];
        const merged = mergeMessages(current, [message('a', '2026-11-08T10:00:00Z'), message('b', '2026-11-08T10:03:00Z'), message('c', '2026-11-08T10:05:00Z')]);
        expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
        expect(mergeMessages(current, current)).toBe(current);
    });
});
