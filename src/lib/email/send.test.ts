import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createHmac, randomBytes } from 'node:crypto';
import {
    buildListUnsubscribeHeaders,
    buildPreferencesUrl,
    buildUnsubscribeUrl,
    emailConfigured,
    evaluateSuppression,
    generateUnsubscribeToken,
    isHardBounce,
    isPlausibleEmail,
    mapResendEvent,
    parseResendWebhook,
    parseUnsubscribeCategory,
    sendEmail,
    statusRank,
    verifyResendWebhookSignature,
    type PreferenceSnapshot,
} from './send';

const APP_URL = 'https://app.example.com';

const allOn: PreferenceSnapshot = {
    unsubscribedAll: false,
    weeklyDigest: true,
    monthlyReview: true,
    radarDigest: true,
    missionNudges: true,
    productUpdates: true,
};

// ---------------------------------------------------------------------------
// Preference logic — the gate every send passes through
// ---------------------------------------------------------------------------

describe('evaluateSuppression', () => {
    test('a user with no preference row is not suppressed (schema defaults are consent)', () => {
        expect(evaluateSuppression('weeklyDigest', null)).toBeNull();
    });

    test('all categories pass when nothing is opted out', () => {
        expect(evaluateSuppression('weeklyDigest', allOn)).toBeNull();
        expect(evaluateSuppression('transactional', allOn)).toBeNull();
    });

    test('unsubscribedAll suppresses everything, including transactional', () => {
        const prefs = { ...allOn, unsubscribedAll: true };
        expect(evaluateSuppression('weeklyDigest', prefs)).toBe('unsubscribed_all');
        expect(evaluateSuppression('transactional', prefs)).toBe('unsubscribed_all');
    });

    test('a critical template still reaches a fully unsubscribed user', () => {
        const prefs = { ...allOn, unsubscribedAll: true };
        expect(evaluateSuppression('transactional', prefs, { critical: true })).toBeNull();
    });

    test('a category opt-out suppresses only that category', () => {
        const prefs = { ...allOn, weeklyDigest: false };
        expect(evaluateSuppression('weeklyDigest', prefs)).toBe('category_opt_out');
        expect(evaluateSuppression('monthlyReview', prefs)).toBeNull();
    });

    test('transactional has no preference column, so no category can switch it off', () => {
        const prefs = { ...allOn, weeklyDigest: false, productUpdates: false };
        expect(evaluateSuppression('transactional', prefs)).toBeNull();
    });

    test('unsubscribedAll wins over a still-enabled category', () => {
        const prefs = { ...allOn, unsubscribedAll: true, weeklyDigest: true };
        expect(evaluateSuppression('weeklyDigest', prefs)).toBe('unsubscribed_all');
    });
});

// ---------------------------------------------------------------------------
// Tokens, URLs, headers
// ---------------------------------------------------------------------------

describe('unsubscribe tokens', () => {
    test('are url-safe and long enough not to be guessable', () => {
        const token = generateUnsubscribeToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(token.length).toBeGreaterThanOrEqual(43);
    });

    test('are unique across calls', () => {
        const tokens = new Set(Array.from({ length: 200 }, () => generateUnsubscribeToken()));
        expect(tokens.size).toBe(200);
    });
});

describe('URL construction', () => {
    test('embeds the token', () => {
        expect(buildUnsubscribeUrl('tok+1/2', undefined, APP_URL)).toBe(
            'https://app.example.com/api/email/unsubscribe?token=tok%2B1%2F2'
        );
    });

    test('adds the category when the email belongs to one', () => {
        expect(buildUnsubscribeUrl('t', 'weeklyDigest', APP_URL)).toContain('c=weeklyDigest');
    });

    test('omits the category for transactional mail — there is nothing to opt out of', () => {
        expect(buildUnsubscribeUrl('t', 'transactional', APP_URL)).not.toContain('c=');
    });

    test('preferences URL points at the notification settings screen', () => {
        expect(buildPreferencesUrl(APP_URL)).toBe('https://app.example.com/settings/notifications');
    });
});

describe('buildListUnsubscribeHeaders', () => {
    const original = process.env.EMAIL_UNSUBSCRIBE_MAILTO;
    afterEach(() => {
        if (original === undefined) delete process.env.EMAIL_UNSUBSCRIBE_MAILTO;
        else process.env.EMAIL_UNSUBSCRIBE_MAILTO = original;
    });

    test('sets both headers — the POST one is what makes the client button one-click', () => {
        delete process.env.EMAIL_UNSUBSCRIBE_MAILTO;
        const headers = buildListUnsubscribeHeaders('https://app.example.com/u?token=t');
        expect(headers['List-Unsubscribe']).toBe('<https://app.example.com/u?token=t>');
        expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });

    test('appends the mailto target when one is configured', () => {
        process.env.EMAIL_UNSUBSCRIBE_MAILTO = 'unsub@mail.example.com';
        const headers = buildListUnsubscribeHeaders('https://app.example.com/u?token=t');
        expect(headers['List-Unsubscribe']).toBe(
            '<https://app.example.com/u?token=t>, <mailto:unsub@mail.example.com?subject=unsubscribe>'
        );
    });
});

describe('isPlausibleEmail', () => {
    test('accepts ordinary addresses', () => {
        expect(isPlausibleEmail('ada@example.com')).toBe(true);
        expect(isPlausibleEmail('  ada+tag@sub.example.co.uk  ')).toBe(true);
    });

    test('rejects empty, spaced and domain-less values', () => {
        expect(isPlausibleEmail('')).toBe(false);
        expect(isPlausibleEmail('ada@example')).toBe(false);
        expect(isPlausibleEmail('ada example@x.com')).toBe(false);
        expect(isPlausibleEmail('@example.com')).toBe(false);
    });
});

describe('parseUnsubscribeCategory', () => {
    test('accepts the five opt-outable categories', () => {
        expect(parseUnsubscribeCategory('weeklyDigest')).toBe('weeklyDigest');
        expect(parseUnsubscribeCategory('productUpdates')).toBe('productUpdates');
    });

    test('rejects transactional and anything unrecognised', () => {
        expect(parseUnsubscribeCategory('transactional')).toBeNull();
        expect(parseUnsubscribeCategory('unsubscribedAll')).toBeNull();
        expect(parseUnsubscribeCategory(null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Webhook mapping
// ---------------------------------------------------------------------------

function event(type: string, data: Record<string, unknown> = {}) {
    return { type, created_at: '2026-08-01T10:00:00.000Z', data: { email_id: 'prov_1', ...data } };
}

describe('parseResendWebhook', () => {
    test('accepts a well-formed event', () => {
        expect(parseResendWebhook(event('email.delivered'))?.type).toBe('email.delivered');
    });

    test('rejects anything without a type or data object', () => {
        expect(parseResendWebhook({ type: 'email.delivered' })).toBeNull();
        expect(parseResendWebhook({ data: {} })).toBeNull();
        expect(parseResendWebhook('nonsense')).toBeNull();
        expect(parseResendWebhook(null)).toBeNull();
    });
});

describe('mapResendEvent', () => {
    test('delivery marks delivered and suppresses nothing', () => {
        expect(mapResendEvent(parseResendWebhook(event('email.delivered'))!)).toEqual({
            providerId: 'prov_1',
            status: 'delivered',
            suppressRecipient: false,
        });
    });

    test('a permanent bounce suppresses the recipient', () => {
        const mapped = mapResendEvent(
            parseResendWebhook(
                event('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'no such user' } })
            )!
        );
        expect(mapped?.status).toBe('bounced');
        expect(mapped?.suppressRecipient).toBe(true);
        expect(mapped?.error).toBe('no such user');
    });

    test('a transient bounce does not suppress the recipient', () => {
        const mapped = mapResendEvent(
            parseResendWebhook(event('email.bounced', { bounce: { type: 'Transient', subType: 'MailboxFull' } }))!
        );
        expect(mapped?.status).toBe('bounced');
        expect(mapped?.suppressRecipient).toBe(false);
    });

    test('a complaint suppresses the recipient', () => {
        const mapped = mapResendEvent(parseResendWebhook(event('email.complained'))!);
        expect(mapped?.status).toBe('complained');
        expect(mapped?.suppressRecipient).toBe(true);
    });

    test('opens and clicks set a timestamp and leave status alone', () => {
        const opened = mapResendEvent(parseResendWebhook(event('email.opened'))!);
        expect(opened?.status).toBeUndefined();
        expect(opened?.openedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');

        const clicked = mapResendEvent(parseResendWebhook(event('email.clicked'))!);
        expect(clicked?.clickedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    });

    test('a delivery delay is recorded but is not terminal', () => {
        const mapped = mapResendEvent(parseResendWebhook(event('email.delivery_delayed'))!);
        expect(mapped).toEqual({ providerId: 'prov_1', suppressRecipient: false });
    });

    test('events we do not care about, and events with no email_id, map to null', () => {
        expect(mapResendEvent(parseResendWebhook(event('contact.created'))!)).toBeNull();
        expect(mapResendEvent(parseResendWebhook({ type: 'email.delivered', data: {} })!)).toBeNull();
    });

    test('a malformed created_at falls back to now instead of an Invalid Date', () => {
        const mapped = mapResendEvent(
            parseResendWebhook({ type: 'email.opened', created_at: 'not-a-date', data: { email_id: 'p' } })!
        );
        expect(Number.isNaN(mapped?.openedAt?.getTime())).toBe(false);
    });
});

describe('isHardBounce', () => {
    test('permanent is hard, in any casing', () => {
        expect(isHardBounce({ type: 'Permanent' })).toBe(true);
        expect(isHardBounce({ type: 'permanent' })).toBe(true);
    });

    test('suppression-list subtypes are hard even when the type is not permanent', () => {
        expect(isHardBounce({ type: 'Undetermined', subType: 'Suppressed' })).toBe(true);
        expect(isHardBounce({ type: 'Undetermined', subType: 'OnAccountSuppressionList' })).toBe(true);
    });

    test('transient and unknown bounces are soft', () => {
        expect(isHardBounce({ type: 'Transient', subType: 'MailboxFull' })).toBe(false);
        expect(isHardBounce(undefined)).toBe(false);
    });
});

describe('statusRank', () => {
    test('never lets a late event downgrade a terminal status', () => {
        expect(statusRank('sent')).toBeGreaterThan(statusRank('queued'));
        expect(statusRank('delivered')).toBeGreaterThan(statusRank('sent'));
        expect(statusRank('bounced')).toBeGreaterThan(statusRank('delivered'));
        expect(statusRank('sent')).toBeLessThan(statusRank('bounced'));
    });

    test('an unknown status ranks lowest', () => {
        expect(statusRank('who-knows')).toBe(0);
        expect(statusRank(null)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

describe('verifyResendWebhookSignature', () => {
    const secretBytes = randomBytes(24);
    const secret = `whsec_${secretBytes.toString('base64')}`;
    const id = 'msg_2abc';
    const now = 1_800_000_000;
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'p1' } });

    function sign(atSeconds: number, body = payload): string {
        const digest = createHmac('sha256', secretBytes).update(`${id}.${atSeconds}.${body}`).digest('base64');
        return `v1,${digest}`;
    }

    const base = { secret, id, payload, nowSeconds: now };

    test('accepts a correctly signed payload', () => {
        expect(
            verifyResendWebhookSignature({
                ...base,
                timestamp: String(now),
                signatureHeader: sign(now),
            })
        ).toBe(true);
    });

    test('accepts when the header carries several signatures and one matches', () => {
        expect(
            verifyResendWebhookSignature({
                ...base,
                timestamp: String(now),
                signatureHeader: `v1,${Buffer.from('wrong-but-same-ish').toString('base64')} ${sign(now)}`,
            })
        ).toBe(true);
    });

    test('rejects a tampered body', () => {
        expect(
            verifyResendWebhookSignature({
                ...base,
                payload: payload.replace('p1', 'p2'),
                timestamp: String(now),
                signatureHeader: sign(now),
            })
        ).toBe(false);
    });

    test('rejects a replayed payload outside the tolerance window', () => {
        const stale = now - 4000;
        expect(
            verifyResendWebhookSignature({
                ...base,
                timestamp: String(stale),
                signatureHeader: sign(stale),
            })
        ).toBe(false);
    });

    test('rejects the wrong secret', () => {
        expect(
            verifyResendWebhookSignature({
                ...base,
                secret: `whsec_${randomBytes(24).toString('base64')}`,
                timestamp: String(now),
                signatureHeader: sign(now),
            })
        ).toBe(false);
    });

    test('rejects an unknown signature version', () => {
        expect(
            verifyResendWebhookSignature({
                ...base,
                timestamp: String(now),
                signatureHeader: sign(now).replace('v1,', 'v9,'),
            })
        ).toBe(false);
    });

    test('rejects missing headers and a non-numeric timestamp', () => {
        expect(verifyResendWebhookSignature({ ...base, timestamp: String(now), signatureHeader: null })).toBe(false);
        expect(verifyResendWebhookSignature({ ...base, timestamp: null, signatureHeader: sign(now) })).toBe(false);
        expect(verifyResendWebhookSignature({ ...base, id: null, timestamp: String(now), signatureHeader: sign(now) })).toBe(false);
        expect(verifyResendWebhookSignature({ ...base, timestamp: 'soon', signatureHeader: sign(now) })).toBe(false);
        expect(verifyResendWebhookSignature({ ...base, secret: '', timestamp: String(now), signatureHeader: sign(now) })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sendEmail — the paths that short-circuit before any DB or provider call
// ---------------------------------------------------------------------------

describe('sendEmail guard rails', () => {
    const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

    beforeEach(() => {
        delete process.env.RESEND_API_KEY;
        delete process.env.EMAIL_FROM;
    });

    afterEach(() => {
        if (saved.key === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = saved.key;
        if (saved.from === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = saved.from;
    });

    test('emailConfigured requires both the key and the from address', () => {
        expect(emailConfigured()).toBe(false);
        process.env.RESEND_API_KEY = 're_test';
        expect(emailConfigured()).toBe(false);
        process.env.EMAIL_FROM = 'Patronus <hello@mail.example.com>';
        expect(emailConfigured()).toBe(true);
    });

    test('an implausible recipient is skipped, not thrown', async () => {
        const result = await sendEmail({
            userId: 'user_1',
            to: 'not-an-address',
            template: 'welcome',
            data: { logUrl: 'https://app.example.com/log' },
        });
        expect(result).toEqual({ status: 'skipped', reason: 'invalid_recipient' });
    });

    test('a missing provider configuration is skipped, not thrown', async () => {
        const result = await sendEmail({
            userId: 'user_1',
            to: 'ada@example.com',
            template: 'welcome',
            data: { logUrl: 'https://app.example.com/log' },
        });
        expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
    });

    test('never rejects — the contract every caller relies on', async () => {
        await expect(
            sendEmail({
                userId: '',
                to: '',
                template: 'magic_link',
                data: { url: 'https://app.example.com/w/t' },
            })
        ).resolves.toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Everything below needs a live Postgres or a real Resend key.
// ---------------------------------------------------------------------------

// TODO(db): unskip once a test database is reachable (Prisma P1001 today).
describe.skip('sendEmail against the database', () => {
    test('an opted-out user is skipped and no EmailSend row is written', () => {});
    test('a first send creates the EmailPreference row and its unsubscribe token', () => {});
    test('a successful send writes an EmailSend row with the provider id', () => {});
});

// TODO(db): unskip once a test database is reachable.
describe.skip('applyUnsubscribe', () => {
    test('is idempotent — the second call returns the same outcome as the first', () => {});
    test('an unknown token returns unknown_token rather than throwing', () => {});
    test('a category unsubscribe leaves the other categories untouched', () => {});
    test('resubscribe reverses an accidental one-click unsubscribe', () => {});
});

// TODO(provider): unskip when a Resend sandbox key is available in CI.
describe.skip('sendEmail against Resend', () => {
    test('a provider 500 records status=failed and returns without throwing', () => {});
    test('the same idempotencyKey does not produce a second delivery', () => {});
    test('List-Unsubscribe and List-Unsubscribe-Post arrive on the delivered message', () => {});
});

// TODO(db): unskip once a test database is reachable.
describe.skip('/api/email/webhook', () => {
    test('a hard bounce sets unsubscribedAll on that user', () => {});
    test('an out-of-order email.sent does not overwrite a recorded bounce', () => {});
    test('an unknown provider id is acknowledged without an error', () => {});
});
