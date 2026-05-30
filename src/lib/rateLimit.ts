import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let ratelimitKb: Ratelimit | null | undefined = undefined;
let ratelimitAi: Ratelimit | null | undefined = undefined;
let ratelimitGitHub: Ratelimit | null | undefined = undefined;
let ratelimitAnonScore: Ratelimit | null | undefined = undefined;
let ratelimitFunnelEvent: Ratelimit | null | undefined = undefined;

function getRedis(): Redis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
}

function getKbLimiter(): Ratelimit | null {
    if (ratelimitKb !== undefined) return ratelimitKb;
    const redis = getRedis();
    ratelimitKb = redis
        ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(30, '1 m'),
              analytics: true,
          })
        : null;
    return ratelimitKb;
}

function getAiLimiter(): Ratelimit | null {
    if (ratelimitAi !== undefined) return ratelimitAi;
    const redis = getRedis();
    ratelimitAi = redis
        ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(20, '1 m'),
              analytics: true,
          })
        : null;
    return ratelimitAi;
}

function getGitHubLimiter(): Ratelimit | null {
    if (ratelimitGitHub !== undefined) return ratelimitGitHub;
    const redis = getRedis();
    ratelimitGitHub = redis
        ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(30, '1 m'),
              analytics: true,
          })
        : null;
    return ratelimitGitHub;
}

function getAnonScoreLimiter(): Ratelimit | null {
    if (ratelimitAnonScore !== undefined) return ratelimitAnonScore;
    const redis = getRedis();
    ratelimitAnonScore = redis
        ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(10, '1 h'),
              analytics: true,
          })
        : null;
    return ratelimitAnonScore;
}

export async function checkKbRateLimit(identifier: string): Promise<{ allowed: boolean; error?: string }> {
    const limiter = getKbLimiter();
    if (!limiter) return { allowed: true };
    const result = await limiter.limit(identifier);
    if (result.success) return { allowed: true };
    return { allowed: false, error: 'Too many requests. Please try again in a minute.' };
}

export async function checkAiRateLimit(identifier: string): Promise<{ allowed: boolean; error?: string }> {
    const limiter = getAiLimiter();
    if (!limiter) return { allowed: true };
    const result = await limiter.limit(identifier);
    if (result.success) return { allowed: true };
    return { allowed: false, error: 'Too many AI requests. Please try again in a minute.' };
}

export async function checkGitHubRateLimit(identifier: string): Promise<{ allowed: boolean; error?: string }> {
    const limiter = getGitHubLimiter();
    if (!limiter) return { allowed: true };
    const result = await limiter.limit(identifier);
    if (result.success) return { allowed: true };
    return { allowed: false, error: 'Too many GitHub requests. Please try again in a minute.' };
}

export async function checkAnonScoreRateLimit(identifier: string): Promise<{ allowed: boolean; error?: string }> {
    const limiter = getAnonScoreLimiter();
    if (!limiter) return { allowed: true };
    const result = await limiter.limit(identifier);
    if (result.success) return { allowed: true };
    return { allowed: false, error: "You've reached the free limit for now. Please try again in a little while." };
}

function getFunnelEventLimiter(): Ratelimit | null {
    if (ratelimitFunnelEvent !== undefined) return ratelimitFunnelEvent;
    const redis = getRedis();
    ratelimitFunnelEvent = redis
        ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(60, '1 m'),
              analytics: false,
          })
        : null;
    return ratelimitFunnelEvent;
}

export async function checkFunnelEventRateLimit(identifier: string): Promise<{ allowed: boolean }> {
    const limiter = getFunnelEventLimiter();
    if (!limiter) return { allowed: true };
    const result = await limiter.limit(identifier);
    return { allowed: result.success };
}
