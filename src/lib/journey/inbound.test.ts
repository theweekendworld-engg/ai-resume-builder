import { describe, expect, test } from 'bun:test';
import { InboundPayloadSchema, parseInbound, senderDomain, tokenOf, unwrapForward } from './inbound';

const TOKEN = 'k3j9x2m4p8q1w7e5';
const DOMAIN = 'in.patronus.cv';
const payload = (over: Record<string, unknown>) => InboundPayloadSchema.parse({
    From: 'Priya Rao <priya@acme.com>',
    FromFull: { Email: 'priya@acme.com', Name: 'Priya Rao' },
    To: 'jai@gmail.com',
    OriginalRecipient: `jobs+${TOKEN}@${DOMAIN}`,
    Subject: 'Interview for Senior Backend Engineer',
    MessageID: '<abc123@mail.acme.com>',
    Date: 'Fri, 03 Oct 2026 10:00:00 +0530',
    TextBody: 'Hi Jai, could you share times for a 45 minute call next week?',
    ...over,
});

describe('parseInbound', () => {
    test('a filter-forwarded message keeps the original sender and routes by the envelope recipient', () => {
        const parsed = parseInbound(payload({}), DOMAIN);
        expect(parsed.kind).toBe('message');
        if (parsed.kind !== 'message') return;
        expect(parsed.token).toBe(TOKEN);
        expect(parsed.fromEmail).toBe('priya@acme.com');
        expect(parsed.fromName).toBe('Priya Rao');
        expect(parsed.messageId).toBe('abc123@mail.acme.com');
        expect(parsed.text).toContain('45 minute call');
    });

    test('Gmail\'s forwarding confirmation yields its code and link, not a message', () => {
        const parsed = parseInbound(payload({
            From: 'forwarding-noreply@google.com',
            FromFull: { Email: 'forwarding-noreply@google.com' },
            Subject: '(#612345789) Gmail Forwarding Confirmation - Receive Mail from jai@gmail.com',
            TextBody: 'To allow jai@gmail.com to automatically forward mail to your address, please click the link below:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz\n',
        }), DOMAIN);
        expect(parsed).toEqual({
            kind: 'forwarding_confirmation',
            token: TOKEN,
            code: '612345789',
            confirmUrl: 'https://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz',
            forwardingFrom: 'jai@gmail.com',
        });
    });

    test('a hand-forwarded message is unwrapped to the original sender and subject', () => {
        const parsed = parseInbound(payload({
            From: 'Jai <jai@gmail.com>',
            FromFull: { Email: 'jai@gmail.com', Name: 'Jai' },
            Subject: 'Fwd: Next steps',
            TextBody: 'fyi\n\n---------- Forwarded message ---------\nFrom: Sam Lee <sam@globex.com>\nDate: Thu, 2 Oct 2026\nSubject: Next steps\nTo: <jai@gmail.com>\n\nWe would like to move you to the onsite round.',
        }), DOMAIN);
        expect(parsed.kind).toBe('message');
        if (parsed.kind !== 'message') return;
        expect(parsed.fromEmail).toBe('sam@globex.com');
        expect(parsed.subject).toBe('Next steps');
        expect(parsed.text).toBe('We would like to move you to the onsite round.');
    });

    test('mail not addressed to an inbox token, or to another domain, is unroutable', () => {
        expect(parseInbound(payload({ OriginalRecipient: 'someone@in.patronus.cv', ToFull: [] }), DOMAIN).kind).toBe('unroutable');
        expect(tokenOf(payload({ OriginalRecipient: `jobs+${TOKEN}@evil.example` }), DOMAIN)).toBeNull();
    });

    test('an HTML-only email is read as text', () => {
        const parsed = parseInbound(payload({ TextBody: '', HtmlBody: '<p>Hello <b>Jai</b>,</p><p>Your application was received.</p><style>p{}</style>' }), DOMAIN);
        expect(parsed.kind === 'message' && parsed.text).toBe('Hello Jai,\nYour application was received.');
    });
});

describe('helpers', () => {
    test('senderDomain keeps the organisation, not the mail subdomain', () => {
        expect(senderDomain('talent@mail.acme.com')).toBe('acme.com');
        expect(senderDomain('a@globex.io')).toBe('globex.io');
    });

    test('unwrapForward returns null without a forwarded block', () => {
        expect(unwrapForward('just a note')).toBeNull();
    });
});
