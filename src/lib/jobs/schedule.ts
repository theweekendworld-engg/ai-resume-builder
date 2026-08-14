/**
 * Derived scheduling for the periodic dispatchers (ADR-2, ADR-3).
 *
 * The cron tick is a dispatcher, not a worker: once an hour it decides what
 * work is due and enqueues the *dispatch* job for it, which then fans out per
 * user. This file is the "what is due" half.
 *
 * It exists because two handlers were built with nothing to fire them.
 * `radar_snapshot` and `mission_nudge` both have registered handlers, correct
 * fan-out and passing tests, and neither would ever have run in production —
 * a handler with no scheduler is as dead as a job kind with no handler, and it
 * is harder to notice because everything about it looks finished.
 *
 * Every enqueue here is dedupe-keyed to its own period, so the hourly tick is
 * idempotent: 24 ticks a day produce one nudge dispatch, and ~720 ticks a
 * month produce one Radar snapshot.
 */

import { enqueue } from '@/lib/jobs/runner';
import type { EnqueueFn } from '@/lib/jobs/types';
import { MISSION_NUDGE_JOB_KIND } from '@/lib/jobs/handlers/missionNudge';
import { RADAR_SNAPSHOT_JOB_KIND } from '@/lib/jobs/handlers/radarSnapshot';

/**
 * The hour, UTC, at which the daily and monthly dispatchers fire.
 *
 * 08:00 rather than midnight. These fan out into email, and a job that starts
 * composing at 00:00 UTC delivers into the middle of the night for most of
 * Europe. The per-user send still respects each recipient's own schedule where
 * one exists; this only controls when the work begins.
 */
export const DISPATCH_HOUR_UTC = 8;

/** Day-of-month for the Radar snapshot. Early, so the band reads as "this month". */
export const RADAR_SNAPSHOT_DAY = 1;

export type PeriodicScheduleResult = {
    missionNudgeJobId: string | null;
    radarSnapshotJobId: string | null;
};

/**
 * Enqueue whatever periodic dispatchers are due this hour.
 *
 * Failures are swallowed per-job and returned as nulls. Scheduling is additive
 * — a missed nudge is one quiet day, whereas an exception here would take the
 * whole tick down and with it the drain that recovers stuck jobs. That is the
 * same posture `scheduleDigestWork` takes for its pre-sync, for the same
 * reason.
 */
export async function schedulePeriodicWork(
    now: Date = new Date(),
    enqueueFn: EnqueueFn = enqueue,
): Promise<PeriodicScheduleResult> {
    const result: PeriodicScheduleResult = { missionNudgeJobId: null, radarSnapshotJobId: null };
    if (now.getUTCHours() !== DISPATCH_HOUR_UTC) return result;

    const day = now.toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);

    try {
        // Daily. The per-mission cadence (weekly, twice-weekly, fortnightly)
        // is enforced inside the handler against the last send, not here —
        // scheduling daily and letting the handler decide is what allows one
        // cadence to change without touching the cron.
        const nudge = await enqueueFn(
            MISSION_NUDGE_JOB_KIND,
            {},
            { dedupeKey: `${MISSION_NUDGE_JOB_KIND}:${day}`, priority: 75 },
        );
        result.missionNudgeJobId = nudge.jobId;
    } catch (error: unknown) {
        console.error('[schedule] mission nudge dispatch failed', error);
    }

    if (now.getUTCDate() === RADAR_SNAPSHOT_DAY) {
        try {
            const radar = await enqueueFn(
                RADAR_SNAPSHOT_JOB_KIND,
                {},
                { dedupeKey: `${RADAR_SNAPSHOT_JOB_KIND}:${month}`, priority: 80 },
            );
            result.radarSnapshotJobId = radar.jobId;
        } catch (error: unknown) {
            console.error('[schedule] radar snapshot dispatch failed', error);
        }
    }

    return result;
}
