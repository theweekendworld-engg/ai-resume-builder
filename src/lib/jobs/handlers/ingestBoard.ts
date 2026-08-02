/**
 * `ingest_board` — pull one public job board, then persist its postings.
 *
 * Two modes in one handler, distinguished by the payload, matching the shape
 * `capture_sync` already established:
 *
 *   `{}`               dispatch: enqueue one child per due board, then return
 *   `{ sourceId }`     the actual fetch-and-store for a single board
 *
 * The dispatch mode exists because of the fan-out rule (impl/00 §P-2). A
 * handler that walked every board in one invocation would be one slow host
 * away from taking the whole tick down, and Vercel's function timeout makes
 * that a correctness problem rather than a stylistic one.
 *
 * ── Politeness, and why it is scheduling rather than sleeping ───────────
 *
 * PRD 04 §3.1 asks for one request per second per host. Boards of the same
 * provider share a host, and the runner drains with concurrency, so N children
 * would otherwise hit Greenhouse simultaneously. Rather than sleep inside the
 * child — which burns paid wall-clock and does not actually serialise anything
 * across concurrent workers — the dispatcher STAGGERS `runAt` per host. The
 * spacing then holds regardless of how many workers are draining, and it
 * survives an invocation boundary.
 */

import { z } from 'zod';
import { JobSourceStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildDedupeKey, enqueue } from '@/lib/jobs/runner';
import type { JobHandler, JobResultObject } from '@/lib/jobs/types';
import {
    adapterFor,
    MIN_REQUEST_SPACING_MS,
    NOT_FOUND_STREAK_LIMIT,
    type RawPosting,
} from '@/lib/radar/boards';
import { normalizeRole } from '@/lib/radar/role';
import { normalizeGeo } from '@/lib/radar/geo';

export const INGEST_BOARD_JOB_KIND = 'ingest_board' as const;

const PayloadSchema = z.object({
    sourceId: z.string().min(1).max(64).optional(),
    /** Fan-out ceiling, so one tick cannot enqueue the entire table. */
    limit: z.number().int().min(1).max(500).default(120),
});

export type IngestBoardPayload = z.infer<typeof PayloadSchema>;

/** Re-poll a healthy board daily; back off the ones that are failing. */
const FRESH_AFTER_MS = 20 * 60 * 60 * 1000;
const THROTTLED_RETRY_MS = 60 * 60 * 1000;

/**
 * Boards worth polling now.
 *
 * `inactive` is excluded outright — five 404s means the board is gone, and a
 * retired board should cost nothing. `throttled` is included but only after a
 * cooling period, which is what makes a 429 a delay rather than a death.
 */
export async function dueBoards(limit: number): Promise<Array<{ id: string; host: string }>> {
    const cutoff = new Date(Date.now() - FRESH_AFTER_MS);
    const throttleCutoff = new Date(Date.now() - THROTTLED_RETRY_MS);

    const rows = await prisma.jobSource.findMany({
        where: {
            OR: [
                {
                    status: JobSourceStatus.active,
                    OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: cutoff } }],
                },
                {
                    status: JobSourceStatus.throttled,
                    OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: throttleCutoff } }],
                },
            ],
        },
        orderBy: [{ lastFetchedAt: { sort: 'asc', nulls: 'first' } }],
        take: limit,
        select: { id: true, provider: true },
    });

    return rows.flatMap((row) => {
        const adapter = adapterFor(row.provider);
        // A source for a provider we do not implement (Lever today) is skipped
        // rather than dead-lettered — the row is legitimate, we just cannot
        // read it yet.
        return adapter ? [{ id: row.id, host: adapter.host }] : [];
    });
}

/**
 * Enqueue one child per board, spaced per host.
 *
 * Two boards on different hosts may run at the same moment; two on the same
 * host are at least `MIN_REQUEST_SPACING_MS` apart.
 */
async function dispatch(limit: number): Promise<JobResultObject> {
    const boards = await dueBoards(limit);
    const nextSlotByHost = new Map<string, number>();
    const now = Date.now();
    let enqueued = 0;

    for (const board of boards) {
        const slot = nextSlotByHost.get(board.host) ?? now;
        nextSlotByHost.set(board.host, slot + MIN_REQUEST_SPACING_MS);

        const { deduped } = await enqueue(
            INGEST_BOARD_JOB_KIND,
            { sourceId: board.id },
            {
                // One in-flight ingest per board per hour. A double-fired cron
                // is then a no-op rather than a doubled request to the host.
                dedupeKey: buildDedupeKey(INGEST_BOARD_JOB_KIND, [board.id, hourBucket(now)]),
                runAt: new Date(slot),
            },
        );
        if (!deduped) enqueued += 1;
    }

    return { mode: 'dispatch', due: boards.length, enqueued };
}

function hourBucket(atMs: number): string {
    return new Date(atMs).toISOString().slice(0, 13);
}

/**
 * Persist one board's postings.
 *
 * Upsert by `(sourceId, externalId)` so a re-poll updates rather than
 * duplicates, and postings that vanished from the board are closed rather than
 * deleted — a closed posting is still evidence a role was advertised, and the
 * band windows read `postedAt`, not liveness.
 */
async function storePostings(sourceId: string, postings: RawPosting[]): Promise<{
    upserted: number;
    closed: number;
    withComp: number;
}> {
    const seen = new Set<string>();
    let withComp = 0;

    for (const posting of postings) {
        seen.add(posting.externalId);
        const comp = posting.compensation;
        if (comp) withComp += 1;

        // The band cell this posting belongs to. Geo is normalised BEFORE the
        // role key is built: keying on the raw string put "New York, NY (HQ)"
        // and "New York, NY" in different cells and left most postings
        // unusable.
        const geo = normalizeGeo(posting.location);
        const role = normalizeRole(posting.title, geo.bucket ?? '');

        const data = {
            title: posting.title,
            location: posting.location,
            geoBucket: geo.bucket,
            department: posting.department,
            absoluteUrl: posting.absoluteUrl,
            contentHash: hashOf(posting.description),
            postedAt: posting.postedAt,
            updatedAtSource: posting.updatedAtSource,
            closedAt: null,
            compLow: comp ? Math.round(comp.low) : null,
            compHigh: comp ? Math.round(comp.high) : null,
            compCurrency: comp?.currency ?? null,
            compPeriod: comp?.period ?? null,
            compAnnualLow: comp ? Math.round(comp.annualLow) : null,
            compAnnualHigh: comp ? Math.round(comp.annualHigh) : null,
            compSource: comp?.source ?? null,
            compLabel: comp?.label ?? null,
            compBandEligible: comp?.bandEligible ?? false,
            compRejectReason: comp?.rejectReason ?? null,
            skills: [] as string[],
            roleFamily: role.family,
            seniority: role.seniority,
            bandKey: role.bandKey,
        };

        await prisma.jobPosting.upsert({
            where: { sourceId_externalId: { sourceId, externalId: posting.externalId } },
            create: { sourceId, externalId: posting.externalId, ...data },
            update: data,
        });
    }

    // Anything we hold as open but the board no longer lists has closed.
    const closed = await prisma.jobPosting.updateMany({
        where: { sourceId, closedAt: null, externalId: { notIn: [...seen] } },
        data: { closedAt: new Date() },
    });

    return { upserted: postings.length, closed: closed.count, withComp };
}

/** Cheap content fingerprint, so a re-extraction can be scoped to what changed. */
function hashOf(text: string): string {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

async function ingestOne(sourceId: string): Promise<JobResultObject> {
    const source = await prisma.jobSource.findUnique({
        where: { id: sourceId },
        select: { id: true, provider: true, boardToken: true, etag: true, lastModified: true, notFoundStreak: true },
    });
    if (!source) return { mode: 'ingest', skipped: 'source_missing' };

    const adapter = adapterFor(source.provider);
    if (!adapter) return { mode: 'ingest', skipped: 'no_adapter', provider: source.provider };

    const outcome = await adapter.fetchBoard({
        boardToken: source.boardToken,
        etag: source.etag,
        lastModified: source.lastModified,
    });
    const fetchedAt = new Date();

    switch (outcome.kind) {
        case 'not_modified':
            // A free confirmation that nothing changed. Reset the failure
            // counters: the board answered us correctly.
            await prisma.jobSource.update({
                where: { id: sourceId },
                data: { lastFetchedAt: fetchedAt, lastSuccessAt: fetchedAt, notFoundStreak: 0, errorCount: 0, lastError: null },
            });
            return { mode: 'ingest', result: 'not_modified' };

        case 'not_found': {
            const streak = source.notFoundStreak + 1;
            const retire = streak >= NOT_FOUND_STREAK_LIMIT;
            await prisma.jobSource.update({
                where: { id: sourceId },
                data: {
                    lastFetchedAt: fetchedAt,
                    notFoundStreak: streak,
                    ...(retire ? { status: JobSourceStatus.inactive } : {}),
                    lastError: 'board_not_found',
                },
            });
            return { mode: 'ingest', result: 'not_found', streak, retired: retire };
        }

        case 'throttled':
            await prisma.jobSource.update({
                where: { id: sourceId },
                data: { lastFetchedAt: fetchedAt, status: JobSourceStatus.throttled, lastError: 'throttled' },
            });
            return { mode: 'ingest', result: 'throttled', retryAfterMs: outcome.retryAfterMs };

        case 'error':
            await prisma.jobSource.update({
                where: { id: sourceId },
                data: { lastFetchedAt: fetchedAt, errorCount: { increment: 1 }, lastError: outcome.message.slice(0, 500) },
            });
            // Thrown so the runner applies its own backoff and retry budget
            // rather than this handler inventing a second retry policy.
            throw new Error(`ingest_board(${source.boardToken}): ${outcome.message}`);

        case 'ok': {
            const stored = await storePostings(sourceId, outcome.postings);
            await prisma.jobSource.update({
                where: { id: sourceId },
                data: {
                    lastFetchedAt: fetchedAt,
                    lastSuccessAt: fetchedAt,
                    etag: outcome.etag,
                    lastModified: outcome.lastModified,
                    notFoundStreak: 0,
                    errorCount: 0,
                    lastError: null,
                    // A board that answers after being throttled is healthy again.
                    status: JobSourceStatus.active,
                },
            });
            return { mode: 'ingest', result: 'ok', ...stored };
        }
    }
}

export const ingestBoardHandler: JobHandler = async (payload) => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(`ingest_board: invalid payload — ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }

    const { sourceId, limit } = parsed.data;
    return sourceId ? ingestOne(sourceId) : dispatch(limit);
};
