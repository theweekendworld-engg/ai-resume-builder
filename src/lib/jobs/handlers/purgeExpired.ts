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
export const STALE_RUN_MS = 15 * 60_000;
export const STALE_GENERATION_MS = 30 * 60_000;

export const purgeExpiredHandler: JobHandler = async (_payload, ctx): Promise<JobResultObject> => {
    const now = Date.now();
    const [rateLimits, grants, scores] = await Promise.all([
        prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * DAY) } } }),
        prisma.extensionConnectGrant.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } }),
        prisma.pendingScore.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    ]);
    // Work a killed function left mid-flight. Marked failed so it can be
    // retried; before this, nothing ever moved it, and a stalled Scout run
    // blocked its link from being analysed again (audit 2026-10-02).
    const [runs, sessions] = await Promise.all([
        prisma.agentRun.updateMany({
            where: { status: { in: ['queued', 'running'] }, updatedAt: { lt: new Date(now - STALE_RUN_MS) } },
            data: { status: 'failed', error: 'This stopped before it finished. Share the link again to retry.' },
        }),
        prisma.generationSession.updateMany({
            where: { status: 'generating', updatedAt: { lt: new Date(now - STALE_GENERATION_MS) } },
            data: { status: 'failed', errorMessage: 'Generation stopped before it finished. Retry it.' },
        }),
    ]);
    const result = { rateLimits: rateLimits.count, grants: grants.count, scores: scores.count, staleRuns: runs.count, staleGenerations: sessions.count };
    ctx.log('purge_expired: done', result);
    return result;
};
