/**
 * `capture_sync` — pull new signals for one source, then hand off to drafting.
 *
 * Two modes in one handler, distinguished by the payload:
 *
 *   `{}`                      dispatch: enqueue one child per due source
 *   `{ sourceId, trigger }`   the actual sync for a single source
 *
 * The dispatch mode exists because of the fan-out rule (impl/00 §P-2): a
 * handler that would process N users enqueues N child jobs and returns. It
 * never loops over users itself. On Vercel that is not a style preference — one
 * slow GitHub account would take the whole invocation down with it, and with it
 * everyone else's digest.
 *
 * Registration lives in `src/lib/jobs/registry.ts`, which this file deliberately
 * does not touch.
 */

import { z } from 'zod';
import { CaptureSourceStatus, Tier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getUserTier } from '@/lib/entitlements';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { BACKFILL_DAYS_FREE, BACKFILL_DAYS_PAID } from '@/lib/capture/caps';
import { runCaptureSync, type SyncTrigger } from '@/lib/capture/sync';

export const CAPTURE_SYNC_JOB_KIND = 'capture_sync' as const;
export const DRAFT_WINS_JOB_KIND = 'draft_wins' as const;

const TriggerSchema = z.enum(['initial', 'scheduled', 'manual']);

const CaptureSyncPayloadSchema = z.object({
    sourceId: z.string().min(1).max(64).optional(),
    trigger: TriggerSchema.default('scheduled'),
    /** Dispatch fan-out ceiling. Keeps one tick from enqueueing 50k children. */
    limit: z.number().int().min(1).max(2_000).optional(),
});

export type CaptureSyncPayload = z.infer<typeof CaptureSyncPayloadSchema>;

/** §9 — Free backfills 30 days, paid tiers 90. */
export function backfillDaysForTier(tier: Tier): number {
    return tier === Tier.free ? BACKFILL_DAYS_FREE : BACKFILL_DAYS_PAID;
}

/**
 * Sources eligible for a scheduled pull.
 *
 * `paused` and `revoked` are excluded here rather than inside the child job so
 * a paused source costs nothing at all. `error` sources are included: §7.3
 * auto-pauses at five consecutive failures, so anything still in `error` is
 * inside its retry budget and deserves another attempt.
 */
export async function dueSourceIds(limit: number): Promise<Array<{ id: string; userId: string }>> {
    return prisma.captureSource.findMany({
        where: { status: { in: [CaptureSourceStatus.active, CaptureSourceStatus.error] } },
        orderBy: [{ lastSyncedAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
        select: { id: true, userId: true },
    });
}

/** Per-source, per-hour. A double-fired cron is a no-op (impl/00 §P-1). */
export function syncDedupeKey(sourceId: string, trigger: SyncTrigger, now: Date): string {
    return buildDedupeKey('capture_sync', [sourceId, trigger, now.toISOString().slice(0, 13)]);
}

export function draftDedupeKey(sourceId: string, runId: string): string {
    return buildDedupeKey('draft_wins', [sourceId, runId]);
}

export const captureSyncHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = CaptureSyncPayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(`capture_sync: invalid payload — ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const { sourceId, trigger } = parsed.data;

    if (!sourceId) return dispatch(parsed.data, ctx);

    const source = await prisma.captureSource.findUnique({
        where: { id: sourceId },
        select: { userId: true },
    });
    if (!source) return { skipped: 'source_missing' };

    const tier = await getUserTier(source.userId);
    const summary = await runCaptureSync({
        sourceId,
        trigger,
        backfillDays: backfillDaysForTier(tier),
    });

    if (!summary) return { skipped: 'source_not_syncable' };

    // Drafting is a separate job on purpose: a rate-limited pull still leaves
    // whatever it did fetch draftable, and a model outage does not roll back
    // signals we already stored.
    const child = await ctx.enqueue(
        DRAFT_WINS_JOB_KIND,
        { userId: source.userId, sourceId, runId: summary.runId, trigger },
        { dedupeKey: draftDedupeKey(sourceId, summary.runId), priority: 90 },
    );

    ctx.log('capture sync finished', {
        sourceId,
        status: summary.status,
        stored: summary.stored,
        partial: summary.partial,
        requestsUsed: summary.requestsUsed,
    });

    return {
        sourceId,
        runId: summary.runId,
        status: summary.status,
        scanned: summary.scanned,
        stored: summary.stored,
        noise: summary.noise,
        partial: summary.partial,
        draftJobId: child.jobId,
    };
};

async function dispatch(payload: CaptureSyncPayload, ctx: JobContext): Promise<JobResultObject> {
    const now = new Date();
    const sources = await dueSourceIds(payload.limit ?? 500);

    let enqueued = 0;
    let deduped = 0;
    for (const source of sources) {
        const result = await ctx.enqueue(
            CAPTURE_SYNC_JOB_KIND,
            { sourceId: source.id, trigger: payload.trigger },
            { dedupeKey: syncDedupeKey(source.id, payload.trigger, now) },
        );
        if (result.deduped) deduped += 1;
        else enqueued += 1;
    }

    ctx.log('capture sync dispatched', { sources: sources.length, enqueued, deduped });
    return { dispatched: sources.length, enqueued, deduped };
}
