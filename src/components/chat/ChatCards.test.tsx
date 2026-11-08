/**
 * The apply chain in the web chat (docs/impl/07-telegram-apply.md §5): the
 * progress card, and the draft card the chain's result message carries.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installClerkMock } from '@/__mocks__/clerk';
import type { ChatCard } from '@/lib/chat/types';

installClerkMock();
const { ChatCardView } = await import('./ChatCards');

const render = (card: ChatCard) => renderToStaticMarkup(<ChatCardView card={card} onSend={() => {}} />);

const EMAIL: Extract<ChatCard, { type: 'message_draft' }> = {
    type: 'message_draft', draftId: 'd2', runId: 'run_1', format: 'email', target: 'recruiter', version: 2,
    toEmail: 'jobs@acme.com', subject: 'Forward Deployed AI Engineer application', body: 'Hi,\n\nMy resume is attached.',
    title: 'Forward Deployed AI Engineer at Acme', applyUrl: null,
};

describe('the application draft card', () => {
    test('an email: To, Subject, Body, Open in Gmail and Mail app prefilled, Copy, Mark as applied, and the job page for edits', () => {
        const html = render(EMAIL);
        for (const text of ['Application email', 'v2', 'jobs@acme.com', 'Forward Deployed AI Engineer application', 'My resume is attached.', 'Open in Gmail', 'Mail app', 'Copy', 'Mark as applied']) {
            expect(html).toContain(text);
        }
        expect(html).toContain('href="https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=jobs%40acme.com&amp;su=Forward%20Deployed%20AI%20Engineer%20application');
        expect(html).toContain('href="mailto:jobs@acme.com?subject=');
        expect(html).toContain('href="/scout/run_1"');
        expect(html).toContain('edit it on the job page');
    });

    test('a LinkedIn message: Copy and Open the application, never a compose link', () => {
        const html = render({ ...EMAIL, format: 'linkedin_message', toEmail: null, subject: null, version: 1, applyUrl: 'https://jobs.globex.example/apply/42' });
        expect(html).toContain('LinkedIn message to the recruiter');
        expect(html).toContain('href="https://jobs.globex.example/apply/42"');
        expect(html).toContain('Open the application');
        expect(html).not.toContain('Open in Gmail');
        expect(html).not.toContain('mailto:');
    });

    test('a job already applied to says so', () => {
        const html = render({ ...EMAIL, applied: true });
        expect(html).toContain('Applied');
        expect(html).not.toContain('Mark as applied');
    });
});

describe('the apply progress card', () => {
    const card = (stage: Extract<ChatCard, { type: 'apply_chain' }>['stage'], extra: Partial<Extract<ChatCard, { type: 'apply_chain' }>> = {}): ChatCard => ({
        type: 'apply_chain', runId: 'run_1', stage, title: 'Forward Deployed AI Engineer at Acme', reason: null, code: null, ...extra,
    });

    test('while it works, it says which step', () => {
        expect(render(card('tailoring'))).toContain('Tailoring your resume');
        expect(render(card('drafting'))).toContain('Writing the application draft');
        expect(render(card('drafted'))).toContain('Resume and draft ready. Both are below.');
    });

    test('held by eligibility: the reason, and Yes / No, as on Telegram', () => {
        const html = render(card('eligibility_hold', { reason: 'You may not be eligible: requires US citizenship.' }));
        expect(html).toContain('You may not be eligible: requires US citizenship.');
        expect(html).toContain('Yes, apply anyway');
        expect(html).toContain('No, skip it');
    });

    test('stopped for want of a resume: the way forward', () => {
        const html = render(card('stopped', { reason: 'Upload your resume first.', code: 'no_base_resume' }));
        expect(html).toContain('Upload your resume first.');
        expect(html).toContain('href="/build"');
    });
});

describe('the resume card', () => {
    test('a finished tailored resume links the editor and the PDF', () => {
        const html = render({ type: 'generation', sessionId: 'gs_1', resumeId: 'res_1', status: 'completed', title: 'Forward Deployed AI Engineer at Acme', question: null, pdfUrl: '/api/pdfs/pdf_1' });
        expect(html).toContain('href="/editor/res_1"');
        expect(html).toContain('href="/api/pdfs/pdf_1"');
    });
});
