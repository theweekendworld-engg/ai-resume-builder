import { afterEach, describe, expect, test } from 'bun:test';
import { secretsMatch, verifyTelegramWebhookSecret } from './telegram';

const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
afterEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = saved;
});

describe('Telegram webhook secret (launch audit 2026-10-02)', () => {
    test('fails closed when no secret is configured', () => {
        delete process.env.TELEGRAM_WEBHOOK_SECRET;
        expect(verifyTelegramWebhookSecret('anything')).toBe(false);
        expect(verifyTelegramWebhookSecret(null)).toBe(false);
    });

    test('accepts only the exact secret', () => {
        process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret-value';
        expect(verifyTelegramWebhookSecret('s3cret-value')).toBe(true);
        expect(verifyTelegramWebhookSecret('s3cret-valuE')).toBe(false);
        expect(verifyTelegramWebhookSecret('s3cret')).toBe(false);
        expect(verifyTelegramWebhookSecret(null)).toBe(false);
    });

    test('secretsMatch handles length mismatch without throwing', () => {
        expect(secretsMatch('a', 'abc')).toBe(false);
        expect(secretsMatch(undefined, 'abc')).toBe(false);
    });
});
