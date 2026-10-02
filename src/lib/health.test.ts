import { describe, expect, test } from 'bun:test';
import { configHealth } from './health';

const FULL = {
    CRON_SECRET: 'x', OPENROUTER_API_KEY: 'x', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b.c', WIN_MAGIC_LINK_SECRET: 'x',
    RAZORPAY_KEY_ID: 'x', RAZORPAY_KEY_SECRET: 'x', TAVILY_API_KEY: 'x', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_WEBHOOK_SECRET: 'x',
    TELEGRAM_BOT_USERNAME: 'x', NEXT_PUBLIC_APP_URL: 'https://patronus.cv',
    UPSTASH_REDIS_REST_URL: 'https://r', UPSTASH_REDIS_REST_TOKEN: 'x',
};

describe('configHealth', () => {
    test('a complete environment passes every check', () => {
        expect(configHealth(FULL).filter((check) => !check.ok)).toEqual([]);
    });

    // Production on 2026-09-27: no email provider, no payment provider.
    test('names what is missing, never a value', () => {
        const failing = configHealth({ ...FULL, RESEND_API_KEY: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' }).filter((c) => !c.ok);
        expect(failing.map((c) => c.id).sort()).toEqual(['email', 'payments']);
        expect(JSON.stringify(failing)).not.toContain('a@b.c');
    });

    test('a protected vercel.app URL is flagged', () => {
        const check = configHealth({ ...FULL, NEXT_PUBLIC_APP_URL: 'https://x.vercel.app' }).find((c) => c.id === 'app_url');
        expect(check?.ok).toBe(false);
    });

    test('the vector store needs nothing by default; a Qdrant opt-in needs a server', () => {
        expect(configHealth(FULL).some((c) => c.id === 'vector_store')).toBe(false);
        expect(configHealth({ ...FULL, VECTOR_STORE: 'qdrant' }).find((c) => c.id === 'vector_store')?.ok).toBe(false);
        expect(configHealth({ ...FULL, VECTOR_STORE: 'qdrant', QDRANT_URL: 'https://q' }).find((c) => c.id === 'vector_store')?.ok).toBe(true);
    });

    test('half a WhatsApp config is flagged; none at all is not', () => {
        expect(configHealth(FULL).some((c) => c.id === 'whatsapp')).toBe(false);
        expect(configHealth({ ...FULL, WHATSAPP_ACCESS_TOKEN: 'x' }).find((c) => c.id === 'whatsapp')?.ok).toBe(false);
    });
});
