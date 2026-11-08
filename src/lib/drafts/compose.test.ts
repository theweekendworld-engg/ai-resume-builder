import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { composeLinks, composeRouteUrl, gmailComposeUrl, mailtoUrl } from './compose';
import { signComposeToken, verifyComposeToken, COMPOSE_TOKEN_TTL_DAYS } from './composeToken';
import { mintWinToken } from '@/lib/winTokens';

const draft = {
    format: 'email' as const,
    toEmail: 'jobs@x.com',
    subject: 'Forward Deployed AI Engineer | Claude & agents',
    body: 'Hi,\n\nI build Go services at Razorpay #payments, paid in ₹ & shipped 100% on time? No: on most.\n\nThanks,\nJai',
};

describe('compose links', () => {
    test('Gmail web compose carries to, subject and body, every value encoded', () => {
        const gmail = gmailComposeUrl(draft);
        expect(gmail.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=jobs%40x.com&su=')).toBe(true);
        const params = new URL(gmail).searchParams;
        expect(params.get('to')).toBe('jobs@x.com');
        expect(params.get('su')).toBe(draft.subject);
        expect(params.get('body')).toBe(draft.body);
        // "&" and "#" in the content cannot end a parameter or start a fragment.
        expect(new URL(gmail).hash).toBe('');
    });

    test('mailto keeps "@" literal and uses CRLF line breaks (RFC 6068)', () => {
        const mailto = mailtoUrl(draft);
        expect(mailto.startsWith('mailto:jobs@x.com?subject=')).toBe(true);
        const params = new URL(mailto).searchParams;
        expect(params.get('subject')).toBe(draft.subject);
        expect(params.get('body')).toBe(draft.body.replace(/\n/g, '\r\n'));
        expect(mailto).not.toContain(' ');
    });

    test('no address: the user fills it in their mail app', () => {
        const links = composeLinks({ ...draft, toEmail: null });
        expect(links.gmail).not.toContain('to=');
        expect(links.mailto?.startsWith('mailto:?subject=')).toBe(true);
    });

    test('a LinkedIn draft has no compose links', () => {
        expect(composeLinks({ ...draft, format: 'linkedin_message', subject: null })).toEqual({ gmail: null, mailto: null });
    });

    test('the route URL names one draft and carries its token', () => {
        expect(composeRouteUrl('https://www.patronus.cv/', 'cmdraft000000000000000001', 'abc.def'))
            .toBe('https://www.patronus.cv/api/compose/cmdraft000000000000000001?t=abc.def');
        expect(composeRouteUrl('https://www.patronus.cv', 'cmdraft000000000000000001', 'abc.def', 'gmail'))
            .toBe('https://www.patronus.cv/api/compose/cmdraft000000000000000001?t=abc.def&via=gmail');
    });
});

describe('compose token', () => {
    const secret = 'test-secret-for-compose-links';
    const id = 'cmdraft000000000000000001';
    const now = new Date('2026-11-07T10:00:00.000Z');

    test('round-trips for the draft it was minted for', () => {
        const token = signComposeToken(id, { secret, now });
        expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
        expect(verifyComposeToken(id, token, { secret, now })).toBe(true);
    });

    test('rejects another draft, a tampered signature, another secret, and expiry', () => {
        const token = signComposeToken(id, { secret, now })!;
        expect(verifyComposeToken('cmdraft000000000000000002', token, { secret, now })).toBe(false);
        const [exp, sig] = token.split('.');
        const flipped = `${exp}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
        expect(verifyComposeToken(id, flipped, { secret, now })).toBe(false);
        // Moving the expiry forward breaks the signature over it.
        expect(verifyComposeToken(id, `${Number(exp) + 86_400}.${sig}`, { secret, now })).toBe(false);
        expect(verifyComposeToken(id, token, { secret: 'another-secret', now })).toBe(false);
        const later = new Date(now.getTime() + (COMPOSE_TOKEN_TTL_DAYS + 1) * 86_400_000);
        expect(verifyComposeToken(id, token, { secret, now: later })).toBe(false);
    });

    test('fails closed without a secret, and on garbage', () => {
        expect(signComposeToken(id, { secret: null, now })).toBeNull();
        expect(verifyComposeToken(id, signComposeToken(id, { secret, now }), { secret: null, now })).toBe(false);
        for (const junk of [null, '', 'x', '123.', '.abc', `${'9'.repeat(200)}.x`, '1.2.3']) {
            expect(verifyComposeToken(id, junk, { secret, now })).toBe(false);
        }
    });

    test('domain-separated: neither a raw HMAC under the secret nor a Win magic link verifies', () => {
        const exp = Math.floor(now.getTime() / 1000) + 3600;
        const raw = createHmac('sha256', secret).update(`compose:v1:${id}:${exp}`).digest('base64url');
        expect(verifyComposeToken(id, `${exp}.${raw}`, { secret, now })).toBe(false);
        const win = mintWinToken({ root: 'root', winId: id, action: 'confirm' }, secret)!;
        expect(verifyComposeToken(id, win, { secret, now })).toBe(false);
    });
});
