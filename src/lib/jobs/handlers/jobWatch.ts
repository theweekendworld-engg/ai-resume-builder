/**
 * `job_watch` — the nightly job watch (docs/prd/12-job-watch.md).
 *
 * Dispatch (no userId): one child per user who watches a company or targets a
 * role, dedupe-keyed to the day. Child (userId): refresh, shortlist, score,
 * gate, and at most one morning message (`runWatchForUser`).
 *
 * Fan-out, not a loop: scoring is a model call per posting, and one user's
 * slow board must not take everyone else's morning with it.
 */

import { z } from 'zod';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { runWatchForUser, watchUserIds } from '@/services/jobWatch';

export const JOB_WATCH_JOB_KIND = 'job_watch' as const;

const PayloadSchema = z.object({ userId: z.string().min(1).max(64).optional() });

async function dispatch(ctx: JobContext): Promise<JobResultObject> {
    const day = new Date().toISOString().slice(0, 10);
    const userIds = await watchUserIds();
    let enqueued = 0;
    for (const userId of userIds) {
        const { deduped } = await ctx.enqueue(JOB_WATCH_JOB_KIND, { userId }, { dedupeKey: buildDedupeKey(JOB_WATCH_JOB_KIND, [userId, day]) });
        if (!deduped) enqueued += 1;
    }
    return { mode: 'dispatch', due: userIds.length, enqueued };
}

async function runOne(userId: string, ctx: JobContext): Promise<JobResultObject> {
    const result = await runWatchForUser(userId, { deadline: ctx.deadline });
    return { mode: 'user', ...result, alert: result.alert ? { ...result.alert } : null };
}

export const jobWatchHandler: JobHandler = async (payload, ctx) => {
    const parsed = PayloadSchema.parse(payload ?? {});
    return parsed.userId ? runOne(parsed.userId, ctx) : dispatch(ctx);
};
