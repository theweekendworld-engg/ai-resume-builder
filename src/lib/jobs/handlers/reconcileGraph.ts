/**
 * Graph reconciliation sweep.
 *
 * Every write path that spans Postgres and Qdrant has a window where a crash
 * leaves the two disagreeing. Individually each window is small; across a
 * product whose entire premise is "the record is trustworthy", the union of
 * them is not. This is the janitor that closes them.
 *
 * Four drifts, in descending order of how much damage they do:
 *
 *   1. LEAKED  — a Win that must not be externally visible still has a vector.
 *      The exact failure ADR-8 exists to prevent: `unconfirmWin` and the
 *      sensitivity downgrade both delete the point *after* the transaction, so
 *      a failed delete leaves confidential work reachable by tailoring. This is
 *      the only drift that is a privacy incident rather than an inconsistency,
 *      so it is repaired first and counted separately.
 *
 *   2. UNGROUNDED — a `confirmed` Win with no grounded `ClaimLink`. Reported by
 *      D1: a crash between winning the `draft → confirmed` claim and the graph
 *      write leaves this behind, and it breaks CLAUDE.md rule 5 — the invariant
 *      the whole moat rests on. A magic-link replay repairs it, but only if the
 *      user happens to tap again.
 *
 *   3. MISSING  — a Win that should be embedded but has no live point. Benign:
 *      it is invisible to retrieval, so the record is quietly poorer than the
 *      user thinks. Re-enqueued rather than embedded inline, so the sweep stays
 *      cheap and the existing idempotent handler does the work.
 *
 *   4. ORPHANED — a point whose Win is gone. Reported by B1: `deleteWin`
 *      removes the point before the transaction, so a failed transaction can
 *      strand one. Wastes memory and can surface a deleted Win in search.
 *
 * Read-mostly and safe to run repeatedly. Repairs are capped per run so one
 * sweep cannot become an unbounded backfill.
 */

import { z } from 'zod';
import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { mayEmbed, WIN_POINT_TYPE } from '@/lib/graph/visibility';
import { deleteFromQdrant, scrollPointSourceIds } from '@/actions/embed';
import { deleteWinPoint, enqueueEmbedWin } from './embedWin';
import type { JobHandler, JobResult } from '../types';

/** Per-run ceilings. A sweep is a janitor, not a migration. */
export const RECONCILE_LIMITS = {
    /** Wins scanned per run. */
    scan: 2_000,
    /** Leaked vectors deleted per run. Deliberately generous: this one is a leak. */
    leaked: 500,
    /** Ungrounded Wins repaired per run — each costs a transaction. */
    ungrounded: 200,
    /** Embed jobs enqueued per run. */
    missing: 200,
} as const;

const PayloadSchema = z.object({
    /** Limit the sweep to one user. Used by tests and by targeted repair. */
    userId: z.string().min(1).optional(),
    /** Report drift without repairing it. */
    dryRun: z.boolean().optional(),
});

export type ReconcileReport = {
    scanned: number;
    leaked: number;
    ungrounded: number;
    missing: number;
    orphaned: number;
    repaired: number;
    dryRun: boolean;
};

/**
 * A Win is grounded when at least one of its ClaimLinks resolves to `grounded`.
 * Queried in one pass rather than per Win — the sweep runs over the whole table.
 */
async function groundedWinIds(winIds: string[]): Promise<Set<string>> {
    if (winIds.length === 0) return new Set();
    const links = await prisma.claimLink.findMany({
        where: { claimType: 'win', claimRefId: { in: winIds }, groundState: 'grounded' },
        select: { claimRefId: true },
        distinct: ['claimRefId'],
    });
    return new Set(links.map((l) => l.claimRefId));
}

export const reconcileGraphHandler: JobHandler = async (payload, ctx): Promise<JobResult> => {
    const input = PayloadSchema.parse(payload ?? {});
    const dryRun = input.dryRun ?? false;

    const wins = await prisma.win.findMany({
        where: {
            ...(input.userId ? { userId: input.userId } : {}),
            status: { not: WinStatus.dismissed },
        },
        select: {
            id: true, userId: true, status: true, sensitivity: true,
            embedded: true, qdrantPointId: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: RECONCILE_LIMITS.scan,
    });

    const report: ReconcileReport = {
        scanned: wins.length, leaked: 0, ungrounded: 0, missing: 0,
        orphaned: 0, repaired: 0, dryRun,
    };

    // --- 1. Leaked vectors. Repaired first; this one is a privacy incident. ---
    const leaked = wins.filter((w) => !mayEmbed(w) && (w.embedded || w.qdrantPointId));
    report.leaked = leaked.length;

    for (const win of leaked.slice(0, RECONCILE_LIMITS.leaked)) {
        if (dryRun) continue;
        try {
            await deleteWinPoint({ winId: win.id, storedPointId: win.qdrantPointId });
            await prisma.win.update({
                where: { id: win.id },
                data: { embedded: false, qdrantPointId: null },
            });
            report.repaired += 1;
        } catch (error: unknown) {
            // Leave it flagged rather than clearing the columns: a Win marked
            // un-embedded while its vector survives is worse than a known leak,
            // because the next sweep would no longer see it.
            ctx.log('reconcile: failed to delete leaked point', {
                winId: win.id,
                error: error instanceof Error ? error.message : 'unknown',
            });
        }
    }

    // --- 2. Confirmed but ungrounded. Breaks rule 5. ---
    const confirmed = wins.filter((w) => w.status === WinStatus.confirmed);
    const grounded = await groundedWinIds(confirmed.map((w) => w.id));
    const ungrounded = confirmed.filter((w) => !grounded.has(w.id));
    report.ungrounded = ungrounded.length;

    if (!dryRun && ungrounded.length > 0) {
        // Reported, not silently repaired. Re-running the confirm transaction
        // from a sweep would fabricate evidence for a Win whose source artifact
        // we cannot reconstruct here — the honest move is to surface it and let
        // the truthfulness chips ask the user. Fail closed, per ADR §4.1.
        for (const win of ungrounded.slice(0, RECONCILE_LIMITS.ungrounded)) {
            ctx.log('reconcile: confirmed win has no grounded claim', {
                winId: win.id, userId: win.userId,
            });
        }
    }

    // --- 3. Should be embedded, no live point. ---
    const missing = wins.filter((w) => mayEmbed(w) && !w.embedded);
    report.missing = missing.length;

    for (const win of missing.slice(0, RECONCILE_LIMITS.missing)) {
        if (dryRun) continue;
        await enqueueEmbedWin(win);
        report.repaired += 1;
    }

    // --- 4. Orphaned vectors: a point whose Win no longer exists. ---
    //
    // Only detectable from the Qdrant side, so it is skipped for a single-user
    // sweep (the scroll is collection-wide and the cost would not be scoped).
    if (!input.userId) {
        const points = await scrollPointSourceIds({
            type: WIN_POINT_TYPE,
            limit: RECONCILE_LIMITS.scan,
        });

        if (points.length > 0) {
            const live = await prisma.win.findMany({
                where: { id: { in: [...new Set(points.map((p) => p.sourceId))] } },
                select: { id: true },
            });
            const liveIds = new Set(live.map((w) => w.id));
            const orphans = points.filter((p) => !liveIds.has(p.sourceId));
            report.orphaned = orphans.length;

            for (const orphan of orphans.slice(0, RECONCILE_LIMITS.leaked)) {
                if (dryRun) continue;
                try {
                    await deleteFromQdrant(orphan.pointId);
                    report.repaired += 1;
                } catch (error: unknown) {
                    ctx.log('reconcile: failed to delete orphaned point', {
                        pointId: orphan.pointId,
                        error: error instanceof Error ? error.message : 'unknown',
                    });
                }
            }
        }
    }

    ctx.log('reconcile complete', { ...report, pointType: WIN_POINT_TYPE });
    return report;
};
