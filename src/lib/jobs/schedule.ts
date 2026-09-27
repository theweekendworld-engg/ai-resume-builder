/**
 * Derived scheduling for the periodic dispatchers (ADR-2, ADR-3).
 *
 * The cron tick is a dispatcher, not a worker: once a day it decides what
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
import { CAPTURE_SYNC_JOB_KIND } from '@/lib/jobs/handlers/captureSync';
import { INGEST_BOARD_JOB_KIND } from '@/lib/jobs/handlers/ingestBoard';
import { MISSION_NUDGE_JOB_KIND } from '@/lib/jobs/handlers/missionNudge';
import { MONTH_IN_REVIEW_JOB_KIND } from '@/lib/jobs/handlers/monthInReview';
import { RADAR_SNAPSHOT_JOB_KIND } from '@/lib/jobs/handlers/radarSnapshot';

/**
 * The tick is DAILY (Vercel Hobby allows one cron a day, `vercel.json`
 * `0 3 * * *`, 08:30 IST). Until 2026-09-27 this file assumed an hourly tick
 * and only dispatched when `getUTCHours() === 8`, an hour a daily 03:xx tick
 * never reaches, so mission nudges and Radar snapshots could never fire (and
 * nothing at all ran, because the tick route was behind the login wall).
 *
 * The rule now: every tick dispatches everything periodic, and each dispatch
 * is dedupe-keyed to its own period (day / month). A second tick in
 * the same period is a no-op; a MISSED tick is recovered by the next one,
 * because nothing depends on hitting a particular hour.
 */

/** Kept for callers and tests that imported it; no longer gates anything. */
export const DISPATCH_HOUR_UTC = 3;

/** Day-of-month for the Radar snapshot. Early, so the band reads as "this month". */
export const RADAR_SNAPSHOT_DAY = 1;

export type PeriodicScheduleResult = {
    missionNudgeJobId: string | null;
    radarSnapshotJobId: string | null;
    captureSyncJobId: string | null;
    monthInReviewJobId: string | null;
    ingestBoardJobId: string | null;
    skillRollupJobId: string | null;
    reconcileJobId: string | null;
    downgradeJobId: string | null;
};

/**
 * Enqueue every periodic dispatcher. Failures are swallowed per job and
 * returned as nulls: scheduling is additive, and an exception here would take
 * the whole tick down, and with it the drain that recovers stuck jobs.
 */
export async function schedulePeriodicWork(
    now: Date = new Date(),
    enqueueFn: EnqueueFn = enqueue,
): Promise<PeriodicScheduleResult> {
    const day = now.toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);
    const result: PeriodicScheduleResult = {
        missionNudgeJobId: null,
        radarSnapshotJobId: null,
        captureSyncJobId: null,
        monthInReviewJobId: null,
        ingestBoardJobId: null,
        skillRollupJobId: null,
        reconcileJobId: null,
        downgradeJobId: null,
    };

    // Priority: lower runs first. Capture before anything that reads drafts;
    // ingest before rollup and radar, which read postings.
    const plan: Array<[keyof PeriodicScheduleResult, string, string, number]> = [
        // Daily GitHub sync. Nothing scheduled it before: sources only synced
        // on save or "Sync now", and "the next one runs automatically" was false.
        ['captureSyncJobId', CAPTURE_SYNC_JOB_KIND, `${CAPTURE_SYNC_JOB_KIND}:daily:${day}`, 20],
        ['ingestBoardJobId', INGEST_BOARD_JOB_KIND, `${INGEST_BOARD_JOB_KIND}:daily:${day}`, 30],
        ['skillRollupJobId', 'skill_rollup', `skill_rollup:daily:${day}`, 60],
        // Daily; the per-mission cadence is enforced inside the handler.
        ['missionNudgeJobId', MISSION_NUDGE_JOB_KIND, `${MISSION_NUDGE_JOB_KIND}:${day}`, 75],
        ['downgradeJobId', 'proactive_downgrade', `proactive_downgrade:${day}`, 90],
        // Monthly. Keyed to the month, so the first tick of the month runs it
        // and any later tick that month (or a recovery after a missed day) is a no-op.
        ['radarSnapshotJobId', RADAR_SNAPSHOT_JOB_KIND, `${RADAR_SNAPSHOT_JOB_KIND}:${month}`, 80],
        ['monthInReviewJobId', MONTH_IN_REVIEW_JOB_KIND, `${MONTH_IN_REVIEW_JOB_KIND}:${month}`, 78],
        // Daily integrity sweep of the evidence graph against the vector store.
        // It was weekly; daily since the pgvector move (2026-09-27), because it
        // is also what re-embeds rows whose vectors are missing, and a cheap
        // SQL scan no longer justifies making a user wait a week for that.
        ['reconcileJobId', 'reconcile_qdrant', `reconcile_qdrant:${day}`, 95],
    ];

    for (const [field, kind, dedupeKey, priority] of plan) {
        try {
            const job = await enqueueFn(kind as Parameters<EnqueueFn>[0], {}, { dedupeKey, priority });
            result[field] = job.jobId;
        } catch (error: unknown) {
            console.error(`[schedule] ${kind} dispatch failed`, error);
        }
    }
    return result;
}
