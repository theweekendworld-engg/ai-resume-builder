/**
 * Job runner contracts — impl/00 §P-1 and §P-2.
 *
 * Deliberately transport-agnostic: swapping the Postgres drain for a hosted
 * queue later should change `runner.ts` and nothing else (ADR-1 exit path).
 */

import type { Job, JobStatus } from '@prisma/client';

export type { Job, JobStatus };

/**
 * Every kind of background work in the system. `noop` exists for smoke
 * testing the runner end to end in production (P0.2 "done when").
 */
export type JobKind =
    | 'noop'
    | 'capture_sync'
    | 'draft_wins'
    | 'weekly_digest'
    | 'month_in_review'
    | 'embed_win'
    | 'embed_profile_item'
    | 'purge_expired'
    | 'ingest_board'
    | 'skill_rollup'
    | 'radar_snapshot'
    | 'mission_nudge'
    | 'reconcile_qdrant'
    | 'proactive_downgrade'
    | 'email_send';

export const JOB_KINDS: readonly JobKind[] = [
    'noop',
    'capture_sync',
    'draft_wins',
    'weekly_digest',
    'month_in_review',
    'embed_win',
    'embed_profile_item',
    'purge_expired',
    'ingest_board',
    'skill_rollup',
    'radar_snapshot',
    'mission_nudge',
    'reconcile_qdrant',
    'proactive_downgrade',
    'email_send',
] as const;

export function isJobKind(value: unknown): value is JobKind {
    return typeof value === 'string' && (JOB_KINDS as readonly string[]).includes(value);
}

export interface EnqueueOptions {
    /** When the job becomes eligible. Defaults to now. */
    runAt?: Date;
    /** Unique idempotency key. A duplicate enqueue is a silent no-op, not an error. */
    dedupeKey?: string;
    /** Lower runs first. Defaults to 100. */
    priority?: number;
    /** Attempts before the job is marked `dead`. Defaults to 3. */
    maxAttempts?: number;
}

export interface EnqueueResult {
    jobId: string;
    deduped: boolean;
}

export type EnqueueFn = (
    kind: JobKind,
    payload: object,
    opts?: EnqueueOptions,
) => Promise<EnqueueResult>;

export type JobLog = (message: string, meta?: Record<string, unknown>) => void;

/**
 * What a handler receives. `deadline` is a hard contract: the runner aborts a
 * handler that has not resolved by then and treats it as a normal failure.
 */
export interface JobContext {
    jobId: string;
    /** 1-based: the attempt currently being executed. */
    attempt: number;
    deadline: Date;
    /** Fan out to child jobs. Handlers never loop over users themselves (§P-2). */
    enqueue: EnqueueFn;
    log: JobLog;
}

/**
 * Anything JSON-serializable. `costUsd`, when present, is copied onto the
 * `Job` row so per-feature cost roll-ups work without a second write.
 */
export interface JobResultObject {
    costUsd?: number;
    [key: string]: unknown;
}

export type JobResult = JobResultObject | void | null;

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<JobResult>;

/** Terminal disposition of a single execution inside a drain. */
export type JobOutcomeStatus = 'succeeded' | 'retrying' | 'dead';

export interface JobOutcome {
    jobId: string;
    kind: string;
    status: JobOutcomeStatus;
    attempt: number;
    durationMs: number;
    error?: string;
    /** Only set when the job is being retried. */
    nextRunAt?: string;
}

export interface DrainResult {
    instanceId: string;
    /** Jobs reset from a stale `running` lock at the top of this drain. */
    recovered: number;
    claimed: number;
    succeeded: number;
    retrying: number;
    dead: number;
    batches: number;
    elapsedMs: number;
    budgetMs: number;
    batchSize: number;
    /** True when the drain stopped claiming because the time budget ran out. */
    budgetExhausted: boolean;
    /** True when due work is still sitting in the table — the retrigger signal. */
    workRemaining: boolean;
    outcomes: JobOutcome[];
}
