/**
 * The sync stage — pull, filter, persist. PRD 02 §2, §3.3, §6, §7.3.
 *
 * Everything here is idempotent, and it is idempotent for a specific reason:
 * the job runner's handler deadline is *soft*. It stops waiting for a handler
 * but cannot cancel in-flight I/O, so a retry can execute while an abandoned
 * run is still writing. `CaptureSignal @@unique([sourceId, externalId])` is what
 * makes that harmless, and every write in this file is shaped to lean on it.
 *
 * The other invariant: **a sync never fails a digest**. Rate limits, budget
 * exhaustion and unavailable repos all resolve to a `degraded` run with a
 * resumable cursor. Only a genuinely broken source (revoked token) reaches
 * `failed`, and even then the digest composes from whatever is already stored.
 */

import { CaptureRunStatus, CaptureSourceStatus, Prisma, type CaptureSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import { AUTO_PAUSE_AFTER_FAILURES, MAX_REQUESTS_PER_SYNC } from './caps';
import { NOISE_RULES } from './noise';
import { requireAdapter } from './registry';
import {
    parseSourceConfig,
    type CaptureAdapter,
    type NoiseVerdict,
    type RawSignal,
    type SourceContext,
} from './types';

export type SyncTrigger = 'initial' | 'scheduled' | 'manual';

export type SyncSummary = {
    runId: string;
    status: CaptureRunStatus;
    scanned: number;
    stored: number;
    noise: number;
    partial: boolean;
    requestsUsed: number;
    nextCursor: string | null;
    warnings: string[];
};

// ───────────────────────────────────────────────────── source context

export function toSourceContext(source: CaptureSource): SourceContext {
    return {
        id: source.id,
        userId: source.userId,
        kind: source.kind,
        externalAccountId: source.externalAccountId,
        scopes: Array.isArray(source.scopes)
            ? (source.scopes as unknown[]).filter((scope): scope is string => typeof scope === 'string')
            : [],
        config: parseSourceConfig(source.config),
        cursor: source.cursor,
    };
}

/** Window start: the cursor when we have one, otherwise `fallbackDays` back. */
export function windowStartFor(source: CaptureSource, fallbackDays: number, now: Date): Date {
    if (source.cursor) {
        const parsed = new Date(source.cursor);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(now.getTime() - fallbackDays * 86_400_000);
}

// ───────────────────────────────────────────────────── noise partitioning

export type Partitioned = {
    /** Stored with `isNoise=false`; eligible for drafting. */
    keep: RawSignal[];
    /** Stored with `isNoise=true` so the user can see why (layers 2 and 3). */
    flagged: Array<{ signal: RawSignal; verdict: Extract<NoiseVerdict, { noise: true }> }>;
    /** Dropped before storage (layer 1). A bot PR must not even occupy a row. */
    dropped: number;
};

/**
 * §6.1 says layer-1 exclusions are dropped "before storing a signal", and that
 * is worth taking literally: dependabot on a busy monorepo is thousands of rows
 * a month that no surface will ever read.
 *
 * Layers 2 and 3 are stored and flagged instead, because those verdicts came
 * from the user's own configuration and they have a right to see what it did.
 */
export function partitionByNoise(
    adapter: CaptureAdapter,
    signals: readonly RawSignal[],
    config: SourceContext['config'],
): Partitioned {
    const keep: RawSignal[] = [];
    const flagged: Partitioned['flagged'] = [];
    let dropped = 0;

    for (const signal of signals) {
        const verdict = adapter.isNoise(signal, config);
        if (!verdict.noise) {
            keep.push(signal);
            continue;
        }
        if (verdict.layer === 1) dropped += 1;
        else flagged.push({ signal, verdict });
    }

    return { keep, flagged, dropped };
}

// ───────────────────────────────────────────────────── persistence

function signalRow(
    signal: RawSignal,
    source: CaptureSource,
    isNoise: boolean,
    noiseRule: string | null,
): Prisma.CaptureSignalCreateManyInput {
    return {
        userId: source.userId,
        sourceId: source.id,
        externalId: signal.externalId,
        kind: signal.kind,
        occurredAt: signal.occurredAt,
        title: signal.title.slice(0, 500),
        body: signal.body,
        url: signal.url,
        metadata: signal.metadata as Prisma.InputJsonValue,
        isNoise,
        noiseRule,
        // Flagged rows are terminal: nothing will ever draft from them, so mark
        // them processed now rather than leaving them in the drafting query.
        processedAt: isNoise ? new Date() : null,
    };
}

/**
 * `skipDuplicates` plus the unique constraint IS the idempotency. No read-then-write,
 * no upsert loop, no "have we seen this" set in memory — the database already
 * knows, and it is the only participant that knows under concurrency.
 */
export async function persistSignals(
    source: CaptureSource,
    partitioned: Partitioned,
): Promise<number> {
    const rows: Prisma.CaptureSignalCreateManyInput[] = [
        ...partitioned.keep.map((signal) => signalRow(signal, source, false, null)),
        ...partitioned.flagged.map((entry) => signalRow(entry.signal, source, true, entry.verdict.rule)),
    ];
    if (rows.length === 0) return 0;

    const result = await prisma.captureSignal.createMany({ data: rows, skipDuplicates: true });
    return result.count;
}

// ───────────────────────────────────────────────────── health

/** §7.3 — five consecutive failures auto-pauses; any success resets the count. */
export function nextSourceHealth(input: {
    errorCount: number;
    failed: boolean;
}): { status: CaptureSourceStatus; errorCount: number } {
    if (!input.failed) return { status: CaptureSourceStatus.active, errorCount: 0 };
    const errorCount = input.errorCount + 1;
    if (errorCount >= AUTO_PAUSE_AFTER_FAILURES) {
        return { status: CaptureSourceStatus.paused, errorCount };
    }
    return { status: CaptureSourceStatus.error, errorCount };
}

// ───────────────────────────────────────────────────── the run

export type RunSyncParams = {
    sourceId: string;
    trigger: SyncTrigger;
    /** Days back when there is no cursor. Entitlement-derived (§9). */
    backfillDays: number;
    now?: Date;
    maxRequests?: number;
    /** Injected by tests; production resolves from the registry. */
    adapter?: CaptureAdapter;
};

export async function runCaptureSync(params: RunSyncParams): Promise<SyncSummary | null> {
    const now = params.now ?? new Date();
    const source = await prisma.captureSource.findUnique({ where: { id: params.sourceId } });
    if (!source) return null;

    // A paused or revoked source is not an error, it is a user decision.
    if (source.status === CaptureSourceStatus.revoked) return null;
    if (source.status === CaptureSourceStatus.paused && params.trigger !== 'manual') return null;

    const context = toSourceContext(source);

    // §7.3 "zero repos selected" is a blocking setup error, not a silent empty run.
    if (context.config.includedRepos.length === 0) {
        await prisma.captureSource.update({
            where: { id: source.id },
            data: { lastError: 'No repositories selected', status: CaptureSourceStatus.error },
        });
        return null;
    }

    const adapter = params.adapter ?? requireAdapter(source.kind);
    const windowStart = windowStartFor(source, params.backfillDays, now);

    const run = await prisma.captureRun.create({
        data: {
            userId: source.userId,
            sourceId: source.id,
            status: CaptureRunStatus.running,
            trigger: params.trigger,
            windowStart,
            windowEnd: now,
        },
    });

    const startedAtMs = Date.now();

    try {
        const pull = await adapter.pull(context, windowStart, {
            maxRequests: params.maxRequests ?? MAX_REQUESTS_PER_SYNC,
            now,
        });

        const partitioned = partitionByNoise(adapter, pull.signals, context.config);
        const stored = await persistSignals(source, partitioned);

        const status = pull.partial ? CaptureRunStatus.degraded : CaptureRunStatus.success;
        const noiseCount = partitioned.dropped + partitioned.flagged.length;

        await prisma.captureRun.update({
            where: { id: run.id },
            data: {
                status,
                itemsScanned: pull.signals.length + partitioned.dropped,
                itemsNoise: noiseCount,
                finishedAt: new Date(),
                error: pull.warnings.length > 0 ? pull.warnings.slice(0, 3).join('; ').slice(0, 500) : null,
            },
        });

        const health = nextSourceHealth({ errorCount: source.errorCount, failed: false });
        await prisma.captureSource.update({
            where: { id: source.id },
            data: {
                // Advance only when the pull gave us a mark. A partial pull still
                // advances — its cursor is the minimum fully-processed watermark.
                cursor: pull.nextCursor ?? source.cursor,
                lastSyncedAt: now,
                lastSuccessAt: now,
                status: source.status === CaptureSourceStatus.paused ? source.status : health.status,
                errorCount: health.errorCount,
                lastError: null,
            },
        });

        await track(source.userId, 'capture_run_finished', {
            feature: 'github_capture',
            kind: source.kind,
            trigger: params.trigger,
            scanned: pull.signals.length + partitioned.dropped,
            noise: noiseCount,
            candidates: partitioned.keep.length,
            drafted: 0, // the drafting stage reports its own count
            costUsd: 0,
            durationMs: Date.now() - startedAtMs,
            status,
            requestsUsed: pull.requestsUsed,
        });

        return {
            runId: run.id,
            status,
            scanned: pull.signals.length + partitioned.dropped,
            stored,
            noise: noiseCount,
            partial: pull.partial,
            requestsUsed: pull.requestsUsed,
            nextCursor: pull.nextCursor,
            warnings: pull.warnings,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'sync failed';

        await prisma.captureRun.update({
            where: { id: run.id },
            data: { status: CaptureRunStatus.failed, finishedAt: new Date(), error: message.slice(0, 500) },
        });

        const health = nextSourceHealth({ errorCount: source.errorCount, failed: true });
        await prisma.captureSource.update({
            where: { id: source.id },
            data: {
                status: health.status,
                errorCount: health.errorCount,
                lastError: message.slice(0, 500),
                lastSyncedAt: now,
            },
        });

        await track(source.userId, 'source_error', {
            feature: 'github_capture',
            kind: source.kind,
            code: message.slice(0, 120),
            consecutiveCount: health.errorCount,
        });

        return {
            runId: run.id,
            status: CaptureRunStatus.failed,
            scanned: 0,
            stored: 0,
            noise: 0,
            partial: false,
            requestsUsed: 0,
            nextCursor: null,
            warnings: [message],
        };
    }
}

// ───────────────────────────────────────────────────── disconnect

/**
 * §7.2 — "We'll delete the raw GitHub data we cached within 24 hours." The Wins
 * survive: they are already part of the record, and deleting a user's history
 * because a connector went away would violate the never-delete invariant.
 */
export async function deleteCachedSignals(sourceId: string): Promise<number> {
    const result = await prisma.captureSignal.deleteMany({ where: { sourceId } });
    return result.count;
}

/** Signal rows whose `noiseRule` explains a filter decision, for the settings page. */
export const TERMINAL_NOISE_RULES: readonly string[] = [
    NOISE_RULES.excludedRepo,
    NOISE_RULES.excludedKeyword,
    NOISE_RULES.notIncludedRepo,
    NOISE_RULES.reviewNotSubstantive,
    NOISE_RULES.belowDraftThreshold,
];
