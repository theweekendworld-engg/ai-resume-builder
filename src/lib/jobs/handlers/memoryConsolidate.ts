/**
 * `memory_consolidate` — the weekly tidy of long-term memory
 * (docs/impl/08-memory.md §5).
 *
 * Two modes, by payload, like every dispatcher here (handlers fan out, never
 * loop):
 *
 *   `{}`                  dispatch: one child per user whose memories gained
 *                         a captured line in the last 7 days, then return
 *   `{ userId, week }`    consolidate that user (one model call)
 *
 * Idempotency, two layers: the schedule's dedupe key is the week, each
 * child's is `memory_consolidate:<userId>:<week>`; and a child that runs
 * again finds nothing to do, because what it rewrote is no longer a fresh
 * capture (`src/services/memoryConsolidation.ts`).
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { consolidationWindowStart, weekKeyFor } from '@/lib/memory/week';
import { CAPTURED_SOURCES, consolidateMemories } from '@/services/memoryConsolidation';

export const MEMORY_CONSOLIDATE_JOB_KIND = 'memory_consolidate' as const;

const DEFAULT_DISPATCH_LIMIT = 2_000;

const PayloadSchema = z.object({
    userId: z.string().min(1).max(191).optional(),
    /** yyyy-mm-dd, the Monday of the week being consolidated. */
    week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
});

export function memoryConsolidateDedupeKey(userId: string, week: string): string {
    return buildDedupeKey(MEMORY_CONSOLIDATE_JOB_KIND, [userId, week]);
}

/** Users with a freshly captured, still-active memory since `since`. */
export async function usersWithFreshMemories(since: Date, limit: number): Promise<string[]> {
    const rows = await prisma.userMemory.findMany({
        where: { status: 'active', source: { in: [...CAPTURED_SOURCES] }, createdAt: { gte: since } },
        distinct: ['userId'],
        select: { userId: true },
        orderBy: { userId: 'asc' },
        take: limit,
    });
    return rows.map((row) => row.userId);
}

async function dispatch(limit: number, ctx: JobContext, now: Date): Promise<JobResultObject> {
    const week = weekKeyFor(now);
    const users = await usersWithFreshMemories(consolidationWindowStart(now), limit);
    let enqueued = 0;
    let deduped = 0;
    for (const userId of users) {
        const result = await ctx.enqueue(
            MEMORY_CONSOLIDATE_JOB_KIND,
            { userId, week },
            { dedupeKey: memoryConsolidateDedupeKey(userId, week), priority: 120 },
        );
        if (result.deduped) deduped += 1;
        else enqueued += 1;
    }
    ctx.log('memory consolidation dispatched', { week, users: users.length, enqueued, deduped });
    return { week, users: users.length, enqueued, deduped };
}

export const memoryConsolidateHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(`memory_consolidate: invalid payload — ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    if (!parsed.data.userId) return dispatch(parsed.data.limit ?? DEFAULT_DISPATCH_LIMIT, ctx, new Date());
    const result = await consolidateMemories(parsed.data.userId, { weekKey: parsed.data.week });
    return { ...result };
};
