/**
 * Postgres-as-queue job runner — ADR-1, ADR-2, impl/01 §P0.2.
 *
 * Structure note: every decision this file makes (backoff, budget, dedupe key
 * shape, claim predicate, chain depth, secret comparison) is a *pure exported
 * function* tested in `runner.test.ts`. The database-touching functions are
 * thin orchestration over those. That split is what keeps this file reviewable
 * and testable without a live Postgres.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, JobStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
    DrainResult,
    EnqueueOptions,
    EnqueueResult,
    Job,
    JobContext,
    JobHandler,
    JobKind,
    JobOutcome,
    JobResult,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_PRIORITY = 100;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BATCH_SIZE = 25;
export const DEFAULT_BUDGET_MS = 45_000;
export const MAX_BATCH_SIZE = 500;
export const MIN_BUDGET_MS = 1_000;
export const MAX_BUDGET_MS = 600_000;

/** Concurrency inside a single drain (ADR-2). */
export const JOB_CONCURRENCY = 4;

/** A `running` job whose lock is older than this is presumed dead. */
export const STUCK_AFTER_MS = 10 * 60_000;

/** Backoff cap, in minutes. */
export const MAX_BACKOFF_MINUTES = 60;

/** Smallest slice of time a claimed handler is ever given. */
export const MIN_HANDLER_GRACE_MS = 5_000;

/** Maximum self-retrigger chain length (ADR-2). */
export const MAX_CHAIN_DEPTH = 10;

export const CHAIN_DEPTH_HEADER = 'x-cron-chain-depth';

export const CRON_TICK_PATH = '/api/cron/tick';

/** Truncation limit for `Job.lastError`. */
export const MAX_ERROR_LENGTH = 2_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by the runner when a handler blows through `ctx.deadline`. */
export class JobDeadlineError extends Error {
    constructor(jobId: string, deadline: Date) {
        super(`job ${jobId} exceeded its deadline of ${deadline.toISOString()}`);
        this.name = 'JobDeadlineError';
    }
}

/** Thrown when a claimed job has no registered handler. Retries, then goes dead. */
export class UnknownJobKindError extends Error {
    constructor(kind: string) {
        super(`no handler registered for job kind "${kind}"`);
        this.name = 'UnknownJobKindError';
    }
}

// ---------------------------------------------------------------------------
// Pure logic — config resolution
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.floor(value)));
}

/** `JOB_BATCH_SIZE`, defaulted and clamped. Invalid input never widens the batch. */
export function resolveBatchSize(raw: string | undefined = process.env.JOB_BATCH_SIZE): number {
    const parsed = Number(String(raw ?? '').trim());
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
    return clampInt(parsed, 1, MAX_BATCH_SIZE);
}

/** `CRON_TIME_BUDGET_MS`, defaulted and clamped. */
export function resolveBudgetMs(raw: string | undefined = process.env.CRON_TIME_BUDGET_MS): number {
    const parsed = Number(String(raw ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BUDGET_MS;
    return clampInt(parsed, MIN_BUDGET_MS, MAX_BUDGET_MS);
}

// ---------------------------------------------------------------------------
// Pure logic — dedupe keys
// ---------------------------------------------------------------------------

/**
 * Canonical dedupe-key construction. Idempotency in this system is entirely a
 * function of this string, so it is built in exactly one place.
 *
 * `buildDedupeKey('digest', [userId, weekStart])` -> `digest:<userId>:<weekStart>`
 *
 * Empty / nullish segments are dropped; whitespace is collapsed to `-`; `:` in
 * a segment is escaped to `_` so segments can never merge or split ambiguously.
 */
export function buildDedupeKey(
    namespace: string,
    parts: ReadonlyArray<string | number | Date | null | undefined> = [],
): string {
    const segments = [namespace, ...parts]
        .map(normalizeDedupeSegment)
        .filter((segment): segment is string => segment.length > 0);

    if (segments.length === 0) {
        throw new Error('buildDedupeKey requires at least one non-empty segment');
    }
    return segments.join(':');
}

function normalizeDedupeSegment(part: string | number | Date | null | undefined): string {
    if (part === null || part === undefined) return '';
    const raw = part instanceof Date ? part.toISOString() : String(part);
    return raw.trim().replace(/\s+/g, '-').replace(/:/g, '_');
}

// ---------------------------------------------------------------------------
// Pure logic — backoff and failure disposition
// ---------------------------------------------------------------------------

/** `min(2^attempts, 60)` minutes, per §P-1. `attempts` is the post-increment count. */
export function computeBackoffMinutes(attempts: number): number {
    const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
    if (n >= 6) return MAX_BACKOFF_MINUTES; // 2^6 = 64 > 60
    return Math.min(2 ** n, MAX_BACKOFF_MINUTES);
}

export function computeNextRunAt(attempts: number, now: Date = new Date()): Date {
    return new Date(now.getTime() + computeBackoffMinutes(attempts) * 60_000);
}

export interface FailureOutcome {
    /** Where the job lands: back in the queue, or dead. Never silently dropped. */
    status: Extract<JobStatus, 'pending' | 'dead'>;
    attempts: number;
    runAt: Date;
    finishedAt: Date | null;
    lastError: string;
}

/**
 * The whole retry policy, as one pure function.
 * `attempts` is the count *after* incrementing for the execution that failed.
 */
export function decideFailureOutcome(input: {
    attempts: number;
    maxAttempts: number;
    error: unknown;
    now?: Date;
}): FailureOutcome {
    const now = input.now ?? new Date();
    const attempts = Math.max(1, Math.floor(input.attempts));
    const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
    const lastError = formatJobError(input.error);

    if (attempts >= maxAttempts) {
        return { status: JobStatus.dead, attempts, runAt: now, finishedAt: now, lastError };
    }
    return {
        status: JobStatus.pending,
        attempts,
        runAt: computeNextRunAt(attempts, now),
        finishedAt: null,
        lastError,
    };
}

/** Never let a weird throw value break the failure path. Always a bounded string. */
export function formatJobError(error: unknown, maxLength: number = MAX_ERROR_LENGTH): string {
    let message: string;
    if (error instanceof Error) {
        message = error.message || error.name || 'Error';
    } else if (typeof error === 'string') {
        message = error;
    } else {
        try {
            message = JSON.stringify(error) ?? String(error);
        } catch {
            message = String(error);
        }
    }
    message = message.trim() || 'unknown error';
    return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

// ---------------------------------------------------------------------------
// Pure logic — time budget
// ---------------------------------------------------------------------------

export function elapsedMs(startedAtMs: number, nowMs: number = Date.now()): number {
    return Math.max(0, nowMs - startedAtMs);
}

/** Stop claiming once we are at or past the budget. */
export function isBudgetExhausted(
    startedAtMs: number,
    budgetMs: number,
    nowMs: number = Date.now(),
): boolean {
    return elapsedMs(startedAtMs, nowMs) >= budgetMs;
}

export function remainingBudgetMs(
    startedAtMs: number,
    budgetMs: number,
    nowMs: number = Date.now(),
): number {
    return Math.max(0, budgetMs - elapsedMs(startedAtMs, nowMs));
}

/**
 * A handler must return by the drain's budget, but always gets at least
 * `graceMs` — otherwise a job claimed one millisecond before the cutoff would
 * be born already-expired and burn an attempt for nothing.
 */
export function computeHandlerDeadline(
    startedAtMs: number,
    budgetMs: number,
    nowMs: number = Date.now(),
    graceMs: number = MIN_HANDLER_GRACE_MS,
): Date {
    return new Date(Math.max(startedAtMs + budgetMs, nowMs + graceMs));
}

// ---------------------------------------------------------------------------
// Pure logic — claim / recovery predicates
// ---------------------------------------------------------------------------

/** Jobs that are due right now, in run order. */
export function dueJobsWhere(now: Date = new Date()): Prisma.JobWhereInput {
    return { status: JobStatus.pending, runAt: { lte: now } };
}

export const DUE_JOBS_ORDER_BY: Prisma.JobOrderByWithRelationInput[] = [
    { priority: 'asc' },
    { runAt: 'asc' },
];

/**
 * The conditional-update predicate that makes claiming atomic. Same idiom as
 * the metered-quota consume in `src/lib/entitlements.ts:226`: the WHERE clause
 * restates the precondition, so only one racer's `updateMany` reports count 1.
 */
export function claimWhere(jobId: string, now: Date = new Date()): Prisma.JobWhereInput {
    return { id: jobId, status: JobStatus.pending, runAt: { lte: now } };
}

/** `running` rows whose lock has gone stale — the crashed-worker recovery set. */
export function stuckJobsWhere(
    now: Date = new Date(),
    staleAfterMs: number = STUCK_AFTER_MS,
): Prisma.JobWhereInput {
    return {
        status: JobStatus.running,
        lockedAt: { lt: new Date(now.getTime() - staleAfterMs) },
    };
}

export function createInstanceId(now: Date = new Date(), token: string = randomUUID()): string {
    const host = process.env.VERCEL_REGION || process.env.HOSTNAME || 'local';
    return `${host}-${now.getTime().toString(36)}-${token.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Pure logic — cron auth and self-retrigger
// ---------------------------------------------------------------------------

export function extractBearerToken(header: string | null | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() || null : null;
}

/** Length-independent, constant-time-within-length string comparison. */
export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) {
        // Burn a comparable amount of time so length isn't a timing oracle.
        timingSafeEqual(left, left);
        return false;
    }
    return timingSafeEqual(left, right);
}

/**
 * Mirrors `verifyTelegramWebhookSecret` (`src/lib/telegram.ts:33`) but fails
 * *closed* when unconfigured: an unauthenticated cron endpoint is a job-queue
 * denial-of-service surface, whereas the Telegram webhook is not.
 */
export function verifyCronSecret(
    authorizationHeader: string | null | undefined,
    configuredSecret: string | undefined = process.env.CRON_SECRET,
): boolean {
    const secret = configuredSecret?.trim();
    if (!secret) return false;
    const token = extractBearerToken(authorizationHeader);
    if (!token) return false;
    return safeEqual(token, secret);
}

/** Chain depth arrives as a header; anything unparseable is depth 0. */
export function parseChainDepth(raw: string | null | undefined): number {
    const parsed = Number(String(raw ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return clampInt(parsed, 0, MAX_CHAIN_DEPTH);
}

/**
 * Retrigger only while work remains and the chain is under the cap. The next
 * request carries `depth + 1`, so depths 0..9 chain and depth 10 stops.
 */
export function shouldRetrigger(input: {
    workRemaining: boolean;
    depth: number;
    maxDepth?: number;
}): boolean {
    const maxDepth = input.maxDepth ?? MAX_CHAIN_DEPTH;
    return input.workRemaining && input.depth < maxDepth;
}

/** Absolute URL of this endpoint, given a base. Tolerates trailing slashes. */
export function cronTickUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) throw new Error('cronTickUrl requires a base URL');
    return `${trimmed}${CRON_TICK_PATH}`;
}

// ---------------------------------------------------------------------------
// Pure logic — bounded concurrency
// ---------------------------------------------------------------------------

/**
 * Worker-pool over `items`, at most `limit` in flight, results in input order.
 * Preferred over chunked `Promise.allSettled` because one slow job in a chunk
 * doesn't idle the other three lanes.
 */
export async function runWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    if (items.length === 0) return results;

    const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    let cursor = 0;

    async function lane(): Promise<void> {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            try {
                results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
            } catch (reason: unknown) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    await Promise.all(Array.from({ length: lanes }, lane));
    return results;
}

/**
 * Races a handler against its deadline. `Promise.race` already attaches a
 * handler to the loser, so a late rejection cannot surface as unhandled.
 */
export async function withDeadline<T>(
    promise: Promise<T>,
    deadline: Date,
    jobId: string,
): Promise<T> {
    const ms = deadline.getTime() - Date.now();
    if (!Number.isFinite(ms)) return promise;
    if (ms <= 0) throw new JobDeadlineError(jobId, deadline);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new JobDeadlineError(jobId, deadline)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const handlers = new Map<JobKind, JobHandler>();

export function registerHandler(kind: JobKind, fn: JobHandler): void {
    handlers.set(kind, fn);
}

export function getHandler(kind: string): JobHandler | undefined {
    return handlers.get(kind as JobKind);
}

export function registeredKinds(): JobKind[] {
    return [...handlers.keys()].sort();
}

/** Test-only escape hatch; never called by application code. */
export function clearHandlers(): void {
    handlers.clear();
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2002';
    // Duck-typed fallback: a second @prisma/client instance breaks `instanceof`.
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
    );
}

/**
 * Insert a job. A duplicate `dedupeKey` is a normal outcome — it returns the
 * existing job id with `deduped: true` and never throws (§P0.2 step 2).
 */
export async function enqueue(
    kind: JobKind,
    payload: object = {},
    opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
    const data: Prisma.JobCreateInput = {
        kind,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        dedupeKey: opts.dedupeKey ?? null,
        priority: opts.priority ?? DEFAULT_PRIORITY,
        maxAttempts: Math.max(1, Math.floor(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
        runAt: opts.runAt ?? new Date(),
    };

    try {
        const job = await prisma.job.create({ data, select: { id: true } });
        return { jobId: job.id, deduped: false };
    } catch (error: unknown) {
        if (!opts.dedupeKey || !isUniqueViolation(error)) throw error;

        const existing = await prisma.job.findUnique({
            where: { dedupeKey: opts.dedupeKey },
            select: { id: true },
        });
        // The row can only be missing if it was deleted between insert and read.
        return { jobId: existing?.id ?? '', deduped: true };
    }
}

// ---------------------------------------------------------------------------
// Claiming and recovery
// ---------------------------------------------------------------------------

/**
 * Reset jobs abandoned by a crashed invocation. Counted as an attempt so a job
 * that reliably kills its worker still reaches `dead` instead of looping.
 */
export async function recoverStuckJobs(
    now: Date = new Date(),
    staleAfterMs: number = STUCK_AFTER_MS,
): Promise<number> {
    const stuck = await prisma.job.findMany({
        where: stuckJobsWhere(now, staleAfterMs),
        select: { id: true, attempts: true, maxAttempts: true },
        take: MAX_BATCH_SIZE,
    });
    if (stuck.length === 0) return 0;

    let recovered = 0;
    for (const job of stuck) {
        const outcome = decideFailureOutcome({
            attempts: job.attempts + 1,
            maxAttempts: job.maxAttempts,
            error: `lock expired after ${Math.round(staleAfterMs / 60_000)}m; presumed crashed`,
            now,
        });
        // Conditional update: only the racer that still sees `running` wins.
        const result = await prisma.job.updateMany({
            where: { id: job.id, status: JobStatus.running },
            data: {
                status: outcome.status,
                attempts: outcome.attempts,
                runAt: outcome.runAt,
                finishedAt: outcome.finishedAt,
                lastError: outcome.lastError,
                lockedAt: null,
                lockedBy: null,
            },
        });
        recovered += result.count;
    }
    return recovered;
}

/**
 * Atomically claim up to `batchSize` due jobs.
 *
 * Read the candidates, then take each one with a conditional `updateMany` that
 * restates `status = pending AND runAt <= now`. Postgres serializes the row
 * update, so exactly one racer gets `count === 1`; everyone else gets 0 and
 * moves on. Same shape as `gateMeteredAction` (`src/lib/entitlements.ts:226`).
 */
export async function claimJobs(
    batchSize: number,
    instanceId: string,
    now: Date = new Date(),
): Promise<Job[]> {
    const candidates = await prisma.job.findMany({
        where: dueJobsWhere(now),
        orderBy: DUE_JOBS_ORDER_BY,
        take: Math.max(1, Math.floor(batchSize)),
    });
    if (candidates.length === 0) return [];

    const claimed: Job[] = [];
    for (const candidate of candidates) {
        const result = await prisma.job.updateMany({
            where: claimWhere(candidate.id, now),
            data: { status: JobStatus.running, lockedAt: now, lockedBy: instanceId },
        });
        if (result.count === 1) {
            claimed.push({ ...candidate, status: JobStatus.running, lockedAt: now, lockedBy: instanceId });
        }
    }
    return claimed;
}

export async function countDueJobs(now: Date = new Date()): Promise<number> {
    return prisma.job.count({ where: dueJobsWhere(now) });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function toResultJson(result: JobResult): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (result === undefined || result === null) return Prisma.JsonNull;
    return result as Prisma.InputJsonValue;
}

function costOf(result: JobResult): number {
    const cost = result && typeof result === 'object' ? result.costUsd : undefined;
    return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * Run one claimed job to a terminal state. Never throws — the disposition is
 * always written to the row and returned as a `JobOutcome`.
 */
export async function executeJob(job: Job, deadline: Date): Promise<JobOutcome> {
    const attempt = job.attempts + 1;
    const startedAt = Date.now();
    const log = (message: string, meta?: Record<string, unknown>): void => {
        console.log(`[job ${job.kind} ${job.id} attempt ${attempt}] ${message}`, meta ?? '');
    };

    const ctx: JobContext = { jobId: job.id, attempt, deadline, enqueue, log };

    try {
        const handler = getHandler(job.kind);
        if (!handler) throw new UnknownJobKindError(job.kind);

        const result = await withDeadline(handler(job.payload, ctx), deadline, job.id);
        const durationMs = Date.now() - startedAt;

        await prisma.job.update({
            where: { id: job.id },
            data: {
                status: JobStatus.succeeded,
                finishedAt: new Date(),
                durationMs,
                costUsd: costOf(result),
                result: toResultJson(result),
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });

        return { jobId: job.id, kind: job.kind, status: 'succeeded', attempt, durationMs };
    } catch (error: unknown) {
        const durationMs = Date.now() - startedAt;
        const outcome = decideFailureOutcome({
            attempts: attempt,
            maxAttempts: job.maxAttempts,
            error,
            now: new Date(),
        });

        try {
            await prisma.job.update({
                where: { id: job.id },
                data: {
                    status: outcome.status,
                    attempts: outcome.attempts,
                    runAt: outcome.runAt,
                    finishedAt: outcome.finishedAt,
                    lastError: outcome.lastError,
                    durationMs,
                    lockedAt: null,
                    lockedBy: null,
                },
            });
        } catch (writeError: unknown) {
            // The row stays `running` and stuck-recovery will pick it up in 10m.
            console.error(`[job ${job.id}] failed to record failure`, writeError);
        }

        return {
            jobId: job.id,
            kind: job.kind,
            status: outcome.status === JobStatus.dead ? 'dead' : 'retrying',
            attempt,
            durationMs,
            error: outcome.lastError,
            nextRunAt: outcome.status === JobStatus.pending ? outcome.runAt.toISOString() : undefined,
        };
    }
}

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

/**
 * One bounded pass over the queue (ADR-2). Recovers stale locks, then claims
 * and runs batches until the time budget is spent or the queue is empty. It
 * never loops to empty by design: leftovers are the next tick's problem, or
 * the self-retrigger's.
 */
export async function drain(
    budgetMs: number = resolveBudgetMs(),
    batchSize: number = resolveBatchSize(),
): Promise<DrainResult> {
    const startedAtMs = Date.now();
    const instanceId = createInstanceId();

    const summary: DrainResult = {
        instanceId,
        recovered: 0,
        claimed: 0,
        succeeded: 0,
        retrying: 0,
        dead: 0,
        batches: 0,
        elapsedMs: 0,
        budgetMs,
        batchSize,
        budgetExhausted: false,
        workRemaining: false,
        outcomes: [],
    };

    try {
        summary.recovered = await recoverStuckJobs(new Date());
    } catch (error: unknown) {
        console.error('[drain] stuck-job recovery failed', error);
    }

    while (!isBudgetExhausted(startedAtMs, budgetMs)) {
        const now = new Date();
        const claimed = await claimJobs(batchSize, instanceId, now);
        if (claimed.length === 0) break;

        summary.batches += 1;
        summary.claimed += claimed.length;

        const deadline = computeHandlerDeadline(startedAtMs, budgetMs);
        const settled = await runWithConcurrency(claimed, JOB_CONCURRENCY, (job) =>
            executeJob(job, deadline),
        );

        for (const entry of settled) {
            if (entry.status !== 'fulfilled') {
                // executeJob is total; this can only be an infrastructure error.
                console.error('[drain] executeJob rejected', entry.reason);
                continue;
            }
            summary.outcomes.push(entry.value);
            if (entry.value.status === 'succeeded') summary.succeeded += 1;
            else if (entry.value.status === 'dead') summary.dead += 1;
            else summary.retrying += 1;
        }
    }

    summary.budgetExhausted = isBudgetExhausted(startedAtMs, budgetMs);
    summary.elapsedMs = elapsedMs(startedAtMs);

    try {
        summary.workRemaining = (await countDueJobs(new Date())) > 0;
    } catch (error: unknown) {
        console.error('[drain] due-work count failed', error);
        summary.workRemaining = false;
    }

    return summary;
}
