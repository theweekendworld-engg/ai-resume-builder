/**
 * Apply-by-email on Telegram: the job button that names the posting's
 * address, and the draft message with its compose and revise buttons.
 */

import { describe, expect, test } from 'bun:test';
import { formatForTelegram, formatForWhatsApp, toTelegramKeyboard } from './format';
import { DRAFT_ATTACH_HINT, DRAFT_EDIT_HINT, emailDraftAction, renderDraftMessage, renderScoutFinal } from './scoutRender';
import { decodeScoutAction } from './scoutActions';
import { APP, JOB_SECTIONS, ok, RUN_ID, view } from './testViews.test-utils';
import { verifyComposeToken } from '@/lib/drafts/composeToken';
import { draftLinks, renderDraftForTelegram, renderDraftForWhatsApp } from '@/lib/drafts/render';
import type { DraftView } from '@/lib/drafts/types';
import type { FitData, JdData, ScoutSections } from '@/lib/scout/types';

const jd = JOB_SECTIONS.jd as { data: JdData };
const fit = JOB_SECTIONS.fit as { data: FitData };

function withEmails(applyEmails: string[] | undefined, extra: Partial<ScoutSections> = {}): ScoutSections {
    return { ...JOB_SECTIONS, jd: ok<JdData>({ ...jd.data, ...(applyEmails ? { applyEmails } : {}) }), ...extra };
}

function plain(lines: { text: string }[][]): string {
    return lines.map((line) => line.map((segment) => segment.text).join('')).join('\n');
}

describe('the job message\'s email button', () => {
    test('a posting that names its address: "✉️ Email jobs@x.com" straight after tailoring', () => {
        const message = renderScoutFinal(view({ sections: withEmails(['jobs@x.com']) }), APP);
        expect(message.actions.map((a) => a.label)).toEqual([
            '💾 Save', '📨 Applied', '❌ Not interested', '✍️ Tailor resume', '✉️ Email jobs@x.com', 'Draft referral note', 'Why not a fit', 'Open in Patronus',
        ]);
        expect(message.actions[4]).toEqual({ kind: 'draft', target: 'r', format: 'e', label: '✉️ Email jobs@x.com' });
    });

    test('Telegram keeps the primary buttons and the email inside its six', () => {
        const buttons = formatForTelegram(renderScoutFinal(view({ sections: withEmails(['jobs@x.com']) }), APP), RUN_ID).buttons;
        expect(buttons).toHaveLength(6);
        expect(buttons.slice(0, 4).map((b) => b.label)).toEqual(['💾 Save', '📨 Applied', '❌ Not interested', '✍️ Tailor resume']);
        const email = buttons.find((b) => b.label === '✉️ Email jobs@x.com');
        if (!email || email.kind !== 'callback') throw new Error('no email button');
        expect(Buffer.byteLength(email.data)).toBeLessThanOrEqual(64);
        expect(decodeScoutAction(email.data)).toEqual({ kind: 'draft', runId: RUN_ID, target: 'recruiter', format: 'email' });
    });

    test('no address: a plain "✉️ Draft email" after the existing drafts, so a strong fit still shows them all', () => {
        const strong = withEmails([], { fit: ok<FitData>({ ...fit.data, verdict: 'strong', notFitReasons: [] }) });
        const labels = formatForTelegram(renderScoutFinal(view({ sections: strong }), APP), RUN_ID).buttons.map((b) => b.label);
        expect(labels).toEqual(['💾 Save', '📨 Applied', '❌ Not interested', '✍️ Tailor resume', 'Draft referral note', '✉️ Draft email']);
    });

    test('a hiring post addresses the poster; a long address is not cut', () => {
        const post = view({ kind: 'hiring_post', sections: withEmails(['jobs@x.com']) });
        expect(emailDraftAction(post).action).toMatchObject({ target: 'p', format: 'e' });
        const long = view({ sections: withEmails(['engineering-recruitment-team@verylongcompanyname.co.in']) });
        expect(emailDraftAction(long).action.label).toBe('✉️ Email your application');
    });

    test('a run stored before applyEmails existed reads the address from the posting text', () => {
        const sections = withEmails(undefined, {
            ingest: ok({
                sourceUrl: null, linkKind: 'text' as const, fetchVia: 'provided_text' as const, title: null, author: null, authorUrl: null,
                companyName: null, location: null, postedAt: null, applicantsText: null, text: 'Forward Deployed AI Engineer | Claude … send resumes to jobs@x.com', truncated: false,
            }),
        });
        expect(emailDraftAction(view({ sections })).action.label).toBe('✉️ Email jobs@x.com');
    });
});

const DRAFT: DraftView = {
    id: 'cmdraft0000000000000000a1',
    version: 2,
    runId: RUN_ID,
    workspaceId: 'cmws00000000000000000000a',
    format: 'email',
    target: 'recruiter',
    toEmail: 'jobs@x.com',
    subject: 'Forward Deployed AI Engineer application',
    body: 'Hi,\n\nI build Go services at Razorpay & studied at IIT Delhi.\n\nThanks,\nJai',
    createdAt: '2026-11-07T10:00:00.000Z',
};

describe('the draft message', () => {
    const links = { gmail: 'https://mail.google.com/mail/?view=cm&fs=1&to=jobs%40x.com', mailApp: `${APP}/api/compose/${DRAFT.id}?t=1.x` };

    test('To, Subject and Body as plain text, then the edit and attach lines', () => {
        const message = renderDraftMessage(DRAFT, links);
        const text = plain(message.lines);
        expect(text).toContain('✉️ Email draft · v2');
        expect(text).toContain('To: jobs@x.com');
        expect(text).toContain('Subject: Forward Deployed AI Engineer application');
        expect(text).toContain('Hi,\n\nI build Go services at Razorpay & studied at IIT Delhi.\n\nThanks,\nJai');
        expect(text).toContain(DRAFT_EDIT_HINT);
        expect(text).toContain(DRAFT_ATTACH_HINT);
        expect(formatForTelegram(message, RUN_ID).text).toContain('Razorpay &amp; studied');
    });

    test('Open in Gmail and Mail app are URL buttons; Shorter and Stronger are sc: callbacks for this version', () => {
        const formatted = formatForTelegram(renderDraftMessage(DRAFT, links), 'none');
        expect(formatted.buttons).toEqual([
            { kind: 'url', label: '📨 Open in Gmail to send', url: links.gmail },
            { kind: 'url', label: '📱 Mail app', url: links.mailApp },
            { kind: 'callback', label: '✂️ Shorter', data: `sc:v:${DRAFT.id}:s` },
            { kind: 'callback', label: '💪 Stronger', data: `sc:v:${DRAFT.id}:g` },
        ]);
        for (const button of formatted.buttons) {
            if (button.kind === 'callback') expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
        }
        expect(decodeScoutAction(`sc:v:${DRAFT.id}:g`)).toEqual({ kind: 'revise_draft', draftId: DRAFT.id, revision: 'stronger' });
        // Gmail on its own row; the three short buttons share the next.
        const keyboard = toTelegramKeyboard(formatted.buttons) as { inline_keyboard: { text: string }[][] };
        expect(keyboard.inline_keyboard.map((row) => row.map((b) => b.text))).toEqual([
            ['📨 Open in Gmail to send'],
            ['📱 Mail app', '✂️ Shorter', '💪 Stronger'],
        ]);
    });

    test('a LinkedIn draft has no To, Subject or compose buttons, only the revisions', () => {
        const message = renderDraftMessage({ ...DRAFT, format: 'linkedin_message', toEmail: null, subject: null }, { gmail: null, mailApp: null });
        const text = plain(message.lines);
        expect(text).not.toContain('To:');
        expect(text).not.toContain(DRAFT_ATTACH_HINT);
        expect(message.actions.map((a) => a.kind)).toEqual(['revise_draft', 'revise_draft']);
    });

    test('renderDraftForTelegram signs the Mail app link for exactly this version', () => {
        const secret = 'render-test-secret';
        const message = renderDraftForTelegram(DRAFT, { appUrl: 'https://www.patronus.cv', secret });
        const mail = message.actions.find((a) => a.kind === 'open' && a.label === '📱 Mail app');
        if (!mail || mail.kind !== 'open') throw new Error('no mail app button');
        const url = new URL(mail.url);
        expect(url.pathname).toBe(`/api/compose/${DRAFT.id}`);
        expect(verifyComposeToken(DRAFT.id, url.searchParams.get('t'), { secret })).toBe(true);
        const gmail = message.actions.find((a) => a.kind === 'open' && a.label.includes('Gmail'));
        expect(gmail && gmail.kind === 'open' && new URL(gmail.url).searchParams.get('body')).toBe(DRAFT.body);
    });

    test('without a signing secret there is no Mail app button, and Gmail still works', () => {
        const links = draftLinks(DRAFT, { appUrl: 'https://www.patronus.cv', secret: null });
        expect(links.mailApp).toBeNull();
        expect(links.gmail?.startsWith('https://mail.google.com/')).toBe(true);
    });

    test('an overlong Gmail link goes through the signed route instead', () => {
        const long = { ...DRAFT, body: 'word '.repeat(600) };
        const links = draftLinks(long, { appUrl: 'https://www.patronus.cv', secret: 'x' });
        expect(links.gmail).toContain('/api/compose/');
        expect(links.gmail).toContain('via=gmail');
    });

    test('on WhatsApp the compose link travels in the text, the revisions as buttons', () => {
        const message = renderDraftForWhatsApp(DRAFT, { appUrl: 'https://www.patronus.cv', secret: 'x' });
        expect(plain(message.lines)).toContain('Open it in your mail app: https://www.patronus.cv/api/compose/');
        expect(message.actions.every((a) => a.kind === 'revise_draft')).toBe(true);
        expect(formatForWhatsApp(message, 'none').buttons.map((b) => b.label)).toEqual(['✂️ Shorter', '💪 Stronger']);
    });
});
