/**
 * The job-search journey's daily pass (docs/prd/11-job-journey.md §7).
 *
 * Dispatch (no userId): re-file emails a crash left behind, then enqueue one
 * child per user who has an inbox, a calendar, or an open application.
 * Child (userId): sync the calendar, record follow-up nudges, and send one
 * Telegram message when there is something new to follow up on.
 */

import { z } from 'zod';
import { ApplicationStatus } from '@prisma/client';

import { config } from '@/lib/config';
import { isEnabled } from '@/lib/flags';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { prisma } from '@/lib/prisma';
import { syncCalendar } from '@/services/calendar';
import { notifyTelegram, QUIET_DAYS, recordFollowUps, refileStuck } from '@/services/journey';

export const JOURNEY_DAILY_JOB_KIND = 'journey_daily' as const;

const PayloadSchema = z.object({ userId: z.string().min(1).max(64).optional() });

async function dueUserIds(): Promise<string[]> {
    const recent = new Date(Date.now() - 90 * 86_400_000);
    const [inboxes, calendars, open] = await Promise.all([
        prisma.emailInbox.findMany({ select: { userId: true }, take: 5_000 }),
        prisma.googleConnection.findMany({ select: { userId: true }, take: 5_000 }),
        prisma.applicationWorkspace.findMany({
            where: { applicationStatus: { in: [ApplicationStatus.submitted, ApplicationStatus.applied, ApplicationStatus.in_review] }, updatedAt: { gte: recent } },
            select: { userId: true },
            distinct: ['userId'],
            take: 5_000,
        }),
    ]);
    return [...new Set([...inboxes, ...calendars, ...open].map((row) => row.userId))];
}

async function dispatch(ctx: JobContext): Promise<JobResultObject> {
    const refiled = await refileStuck();
    const day = new Date().toISOString().slice(0, 10);
    let enqueued = 0;
    const userIds = await dueUserIds();
    for (const userId of userIds) {
        const { deduped } = await ctx.enqueue(JOURNEY_DAILY_JOB_KIND, { userId }, { dedupeKey: buildDedupeKey(JOURNEY_DAILY_JOB_KIND, [userId, day]) });
        if (!deduped) enqueued += 1;
    }
    return { mode: 'dispatch', refiled, due: userIds.length, enqueued };
}

async function runOne(userId: string): Promise<JobResultObject> {
    if (!(await isEnabled(userId, 'job_journey'))) return { mode: 'user', skipped: 'flag_off' };
    const hasCalendar = await prisma.googleConnection.count({ where: { userId } });
    const synced = hasCalendar ? await syncCalendar(userId) : null;
    const followUps = await recordFollowUps(userId);
    if (followUps.length > 0) {
        const names = followUps.slice(0, 3).map((job) => `${job.role ?? 'A role'}${job.company ? ` at ${job.company}` : ''}`);
        const more = followUps.length > 3 ? ` and ${followUps.length - 3} more` : '';
        await notifyTelegram(
            userId,
            `No reply in ${QUIET_DAYS}+ days: ${names.join(', ')}${more}. A short follow-up keeps you on their list.\n\nDraft one: ${config.app.url.replace(/\/$/, '')}/scout`,
        );
    }
    return {
        mode: 'user',
        calendar: synced ? (synced.success ? synced.data : { error: synced.error }) : 'not_connected',
        followUps: followUps.length,
    };
}

export const journeyDailyHandler: JobHandler = async (payload, ctx) => {
    const parsed = PayloadSchema.parse(payload ?? {});
    return parsed.userId ? runOne(parsed.userId) : dispatch(ctx);
};
