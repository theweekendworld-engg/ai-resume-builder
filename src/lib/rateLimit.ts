/**
 * Rate limits for every expensive or abusable entry point.
 *
 * ── Why this changed (launch audit, 2026-10-02) ─────────────────────────────
 *
 * Every limiter here used Upstash and returned "allowed" when Redis was not
 * configured, and Redis was not configured in production. So the product had
 * no rate limiting at all: an anonymous script could call `/api/score` (a file
 * parse plus model calls) as fast as it liked.
 *
 * Now each check uses Upstash when it is configured, and otherwise a
 * fixed-window counter in Postgres (`RateLimitHit`, one atomic upsert), so a
 * limit is real wherever the app runs. Each bucket has its own key prefix: two
 * limiters can never share a counter by accident.
 *
 * An infrastructure error fails OPEN and is logged. A limiter that takes the
 * product down when the database blips is a worse outage than the abuse it
 * guards against; the per-user cost cap (src/lib/usageTracker.ts) is the
 * backstop behind it.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { prisma } from '@/lib/prisma';

type Window = { limit: number; windowSec: number; message: string };

/** Every bucket, in one place, so the limits can be read and reviewed together. */
export const RATE_LIMITS = {
    kb: { limit: 30, windowSec: 60, message: 'Too many requests. Please try again in a minute.' },
    ai: { limit: 20, windowSec: 60, message: 'Too many AI requests. Please try again in a minute.' },
    github: { limit: 30, windowSec: 60, message: 'Too many GitHub requests. Please try again in a minute.' },
    anonScore: { limit: 10, windowSec: 3_600, message: "You've reached the free limit for now. Please try again in a little while." },
    funnel: { limit: 60, windowSec: 60, message: 'Too many events.' },
    winToken: { limit: 20, windowSec: 60, message: 'Too many actions from this link. Try again in a minute.' },
    chat: { limit: 30, windowSec: 60, message: 'That is a lot of messages at once. Give it a minute.' },
    /** Uploads and imports: each is a blob write plus a parse. */
    upload: { limit: 10, windowSec: 600, message: 'Too many uploads. Try again in a few minutes.' },
    /** Anonymous writes that create a row (extension connect, score stash). */
    anonWrite: { limit: 20, windowSec: 600, message: 'Too many requests. Try again in a few minutes.' },
    /** Third-party compile/enrichment calls billed per request. */
    external: { limit: 30, windowSec: 600, message: 'Too many requests. Try again in a few minutes.' },
    /** Queue drains triggered by the health check: at most one a minute, globally. */
    kick: { limit: 1, windowSec: 60, message: 'Already draining.' },
    /** Retrying one failed generation: a few tries, not a free loop. Keyed by session. */
    retry: { limit: 3, windowSec: 86_400, message: 'This one has been retried a few times today. Start a new resume instead.' },
} as const satisfies Record<string, Window>;

export type RateBucket = keyof typeof RATE_LIMITS;
export type RateResult = { allowed: boolean; error?: string };

// ───────────────────────────────────────────────────────────── backends

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
    if (redis !== undefined) return redis;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
    return redis;
}

const upstash = new Map<RateBucket, Ratelimit>();
function upstashLimiter(bucket: RateBucket, r: Redis): Ratelimit {
    let limiter = upstash.get(bucket);
    if (!limiter) {
        const { limit, windowSec } = RATE_LIMITS[bucket];
        limiter = new Ratelimit({
            redis: r,
            limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
            prefix: `rl:${bucket}`,
            analytics: false,
        });
        upstash.set(bucket, limiter);
    }
    return limiter;
}

/** Fixed window in Postgres: `count` for (key, windowStart), incremented atomically. */
async function postgresHit(bucket: RateBucket, identifier: string): Promise<number> {
    const { windowSec } = RATE_LIMITS[bucket];
    const now = Date.now();
    const windowStart = new Date(now - (now % (windowSec * 1_000)));
    const key = `${bucket}:${identifier}`.slice(0, 300);
    const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
        RETURNING "count"`;
    return Number(rows[0]?.count ?? 1);
}

// ───────────────────────────────────────────────────────────── the check

let disabledForTests = process.env.NODE_ENV === 'test';

export async function checkRateLimit(bucket: RateBucket, identifier: string): Promise<RateResult> {
    if (disabledForTests) return { allowed: true };
    const window = RATE_LIMITS[bucket];
    try {
        const r = getRedis();
        if (r) {
            const result = await upstashLimiter(bucket, r).limit(identifier);
            return result.success ? { allowed: true } : { allowed: false, error: window.message };
        }
        const count = await postgresHit(bucket, identifier);
        return count <= window.limit ? { allowed: true } : { allowed: false, error: window.message };
    } catch (error) {
        console.error('[rateLimit] limiter unavailable; allowing', {
            bucket,
            error: error instanceof Error ? error.message : String(error),
        });
        return { allowed: true };
    }
}

/** Which backend is live, for the health check. */
export function rateLimitBackend(): 'upstash' | 'postgres' {
    return getRedis() ? 'upstash' : 'postgres';
}

// ───────────────────────────────────────────────────────────── named checks
// Kept for their call sites; each is one line over `checkRateLimit`.

export const checkKbRateLimit = (id: string) => checkRateLimit('kb', id);
export const checkAiRateLimit = (id: string) => checkRateLimit('ai', id);
export const checkGitHubRateLimit = (id: string) => checkRateLimit('github', id);
export const checkAnonScoreRateLimit = (id: string) => checkRateLimit('anonScore', id);
export const checkFunnelEventRateLimit = (id: string) => checkRateLimit('funnel', id);
/** `identifier` is the digest token root, never the full signed token. */
export const checkWinTokenRateLimit = (id: string) => checkRateLimit('winToken', id);
/** Chat messages, on every channel (docs/prd/10-chat.md): talking is free, so this bounds the router's bill. */
export const checkChatRateLimit = (userId: string) => checkRateLimit('chat', userId);

export const __testing = {
    enable() {
        disabledForTests = false;
    },
    disable() {
        disabledForTests = true;
    },
    resetRedis() {
        redis = undefined;
        upstash.clear();
    },
};
