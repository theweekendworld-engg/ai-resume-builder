/**
 * Daily purge of rows that only matter for a short window and that nothing
 * else ever deleted (launch audit, 2026-10-02): rate-limit counters, expired
 * extension-connect grants, and free-score stashes that were never claimed.
 * Each delete is bounded by its index, so a big backlog drains over a few days
 * instead of holding a lock.
 */

import { prisma } from '@/lib/prisma';
import type { JobHandler, JobResultObject } from '@/lib/jobs/types';

export const PURGE_EXPIRED_JOB_KIND = 'purge_expired' as const;

const DAY = 86_400_000;

export const purgeExpiredHandler: JobHandler = async (_payload, ctx): Promise<JobResultObject> => {
    const now = Date.now();
    const [rateLimits, grants, scores] = await Promise.all([
        prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * DAY) } } }),
        prisma.extensionConnectGrant.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } }),
        prisma.pendingScore.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    ]);
    const result = { rateLimits: rateLimits.count, grants: grants.count, scores: scores.count };
    ctx.log('purge_expired: done', result);
    return result;
};
