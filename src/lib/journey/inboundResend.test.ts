import { describe, expect, test } from 'bun:test';
import { InboundPayloadSchema, parseInbound } from './inbound';
import { fromResendEmail, type ResendReceivedEmail } from './inboundResend';

const TOKEN = 'abcdef123456abcdef';

function email(overrides: Partial<ResendReceivedEmail> = {}): ResendReceivedEmail {
    return {
        object: 'email',
        id: 'em_1',
        // A Gmail filter forward keeps the original headers: To is the user's own address.
        to: ['ada@gmail.com'],
        from: 'Talent Team <talent@acme.com>',
        created_at: '2026-11-09T10:00:00.000Z',
        subject: 'Interview for Backend Engineer',
        bcc: null,
        cc: null,
        reply_to: null,
        received_for: [`jobs+${TOKEN}@in.patronus.cv`],
        html: '<p>Hi Ada, can you do a call on Thursday?</p>',
        text: 'Hi Ada, can you do a call on Thursday?',
        headers: { Date: 'Sun, 08 Nov 2026 18:30:00 +0000', 'X-Mailer': 'acme' },
        message_id: '<msg-1@acme.com>',
        attachments: [],
        ...overrides,
    };
}

describe('fromResendEmail', () => {
    test('routes on the envelope recipient and reads sender, subject, body and date', () => {
        const payload = InboundPayloadSchema.parse(fromResendEmail(email()));
        const parsed = parseInbound(payload, 'in.patronus.cv');
        expect(parsed.kind).toBe('message');
        if (parsed.kind !== 'message') return;
        expect(parsed.token).toBe(TOKEN);
        expect(parsed.fromEmail).toBe('talent@acme.com');
        expect(parsed.fromName).toBe('Talent Team');
        expect(parsed.subject).toBe('Interview for Backend Engineer');
        expect(parsed.text).toContain('Thursday');
        expect(parsed.messageId).toBe('msg-1@acme.com');
        expect(parsed.receivedAt.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    });

    test('falls back to the HTML body and the receipt time', () => {
        const payload = InboundPayloadSchema.parse(fromResendEmail(email({ text: null, headers: null })));
        const parsed = parseInbound(payload, 'in.patronus.cv');
        if (parsed.kind !== 'message') throw new Error(parsed.kind);
        expect(parsed.text).toContain('Thursday');
        expect(parsed.receivedAt.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    });

    test('a hand-forwarded message is unwrapped to the original sender', () => {
        const text = 'FYI\n\n---------- Forwarded message ---------\nFrom: Priya Rao <priya@acme.com>\nDate: Sun, Nov 8, 2026\nSubject: Next steps\nTo: Ada <ada@gmail.com>\n\nWe would like to move you to the onsite.';
        const payload = InboundPayloadSchema.parse(fromResendEmail(email({ from: 'Ada <ada@gmail.com>', subject: 'Fwd: Next steps', text, html: null })));
        const parsed = parseInbound(payload, 'in.patronus.cv');
        if (parsed.kind !== 'message') throw new Error(parsed.kind);
        expect(parsed.fromEmail).toBe('priya@acme.com');
        expect(parsed.subject).toBe('Next steps');
    });

    test('mail for another domain is not routed', () => {
        const payload = InboundPayloadSchema.parse(fromResendEmail(email({ received_for: [`jobs+${TOKEN}@evil.example`], to: [`jobs+${TOKEN}@evil.example`] })));
        expect(parseInbound(payload, 'in.patronus.cv').kind).toBe('unroutable');
    });
});
