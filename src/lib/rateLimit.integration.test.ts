/**
 * The Postgres fallback limiter (no Upstash), against the local database.
 * Production ran with no limiter at all because Upstash was never configured.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { __testing, checkRateLimit, RATE_LIMITS, rateLimitBackend } from './rateLimit';

const ID = `itest-rl-${Date.now()}-${Math.random()}`;
const saved = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };

beforeAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __testing.resetRedis();
    __testing.enable();
});

afterAll(async () => {
    __testing.disable();
    process.env.UPSTASH_REDIS_REST_URL = saved.url;
    process.env.UPSTASH_REDIS_REST_TOKEN = saved.token;
    __testing.resetRedis();
    await prisma.rateLimitHit.deleteMany({ where: { key: { contains: ID } } });
});

describe('rate limits without Upstash', () => {
    test('the backend is Postgres', () => {
        expect(rateLimitBackend()).toBe('postgres');
    });

    test('allows up to the limit, then refuses with the bucket\'s message', async () => {
        const { limit, message } = RATE_LIMITS.anonScore;
        for (let i = 0; i < limit; i += 1) expect((await checkRateLimit('anonScore', ID)).allowed).toBe(true);
        const over = await checkRateLimit('anonScore', ID);
        expect(over.allowed).toBe(false);
        expect(over.error).toBe(message);
    });

    test('buckets do not share a counter', async () => {
        expect((await checkRateLimit('chat', ID)).allowed).toBe(true);
    });

    test('concurrent hits are counted exactly (atomic upsert)', async () => {
        const id = `${ID}-burst`;
        const results = await Promise.all(Array.from({ length: 40 }, () => checkRateLimit('chat', id)));
        expect(results.filter((r) => r.allowed)).toHaveLength(RATE_LIMITS.chat.limit);
    });
});
