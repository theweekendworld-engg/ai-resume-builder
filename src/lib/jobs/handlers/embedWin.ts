/**
 * `embed_win` — write a confirmed, shareable Win into the vector store.
 *
 * Two properties this handler must have, both load-bearing:
 *
 * 1. **Idempotent.** The runner's handler deadline is *soft* — it stops waiting
 *    but cannot cancel in-flight I/O, so a retry can execute while an abandoned
 *    run is still writing. The point id is therefore derived deterministically
 *    from the Win id (uuid v5), so N concurrent runs converge on one point
 *    instead of N. The final DB write is a conditional `updateMany` (the
 *    `gateMeteredAction` idiom); if it matches nothing the Win stopped being
 *    embeddable underneath us and the run deletes the point it just wrote.
 *
 * 2. **Fail closed on sensitivity.** The handler re-reads the Win and re-checks
 *    `mayEmbed` at execution time. A Win downgraded between enqueue and run is
 *    not embedded, and any point it already had is removed (ADR-8, PRD 01 §12).
 */

import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import { WinSensitivity, WinStatus, type Win } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteFromQdrant, generateEmbedding, upsertToQdrant } from '@/lib/embeddings';
import { buildDedupeKey, enqueue } from '@/lib/jobs/runner';
import type { EnqueueResult, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { WIN_POINT_TYPE, mayEmbed } from '@/lib/graph/visibility';

export const EMBED_WIN_JOB_KIND = 'embed_win' as const;

/** Fixed namespace so `winPointId` is stable across processes and deploys. */
const WIN_POINT_NAMESPACE = '7c9f1f7a-1f5a-4a4e-9a1b-3f3f6a2c8d10';

const EmbedWinPayloadSchema = z.object({ winId: z.string().min(1).max(64) });

export type EmbedWinPayload = z.infer<typeof EmbedWinPayloadSchema>;

type EmbeddableWin = Pick<
    Win,
    'id' | 'userId' | 'title' | 'narrative' | 'skills' | 'occurredAt' | 'periodEnd' |
    'category' | 'employerId' | 'projectId' | 'sensitivity' | 'status' | 'source' | 'createdAt'
>;

// ───────────────────────────────────────────────────── injectable seam
//
// Test-only, mirroring `src/lib/ai/structured.ts`. A unit test must not make a
// real embedding call, but it MUST exercise the real Qdrant write/delete —
// "the point is gone" is half of thesis test 1.

export type WinEmbedder = (text: string, meta: { userId: string; winId: string }) => Promise<number[]>;

const defaultEmbedder: WinEmbedder = (text, meta) =>
    generateEmbedding({
        text,
        userId: meta.userId,
        operation: 'embedding_generate',
        metadata: { itemType: 'win', sourceId: meta.winId },
    });

let embedder: WinEmbedder = defaultEmbedder;

export const __testing = {
    setEmbedder(fn: WinEmbedder) {
        embedder = fn;
    },
    reset() {
        embedder = defaultEmbedder;
    },
};

// ───────────────────────────────────────────────────── pure helpers

/** Deterministic per Win. This is what makes a double-run a no-op. */
export function winPointId(winId: string): string {
    return uuidv5(winId, WIN_POINT_NAMESPACE);
}

export function winSkills(win: Pick<Win, 'skills'>): string[] {
    return Array.isArray(win.skills)
        ? (win.skills as unknown[]).filter((skill): skill is string => typeof skill === 'string')
        : [];
}

/** PRD 01 §7.2: `title + "\n" + narrative + "\n" + skills.join(", ")`. */
export function buildWinEmbeddingText(win: Pick<Win, 'title' | 'narrative' | 'skills'>): string {
    const skills = winSkills(win);
    return [win.title, win.narrative, skills.join(', ')].filter((part) => part && part.length > 0).join('\n');
}

/**
 * The payload is the other half of ADR-8: `sensitivity` is written here so the
 * vector filter in `qdrantExternalFilter` can be the same predicate as the SQL
 * one. Never remove it.
 */
export function buildWinQdrantPayload(win: EmbeddableWin, content: string): Record<string, unknown> {
    return {
        userId: win.userId,
        type: WIN_POINT_TYPE,
        sourceId: win.id,
        title: win.title,
        content,
        sensitivity: win.sensitivity,
        occurredAt: win.occurredAt.toISOString(),
        periodEnd: win.periodEnd ? win.periodEnd.toISOString() : null,
        category: win.category,
        employerId: win.employerId,
        projectId: win.projectId,
        source: win.source,
        skills: winSkills(win),
        createdAt: win.createdAt.toISOString(),
    };
}

export function embedWinDedupeKey(winId: string, updatedAt: Date): string {
    return buildDedupeKey('embed-win', [winId, updatedAt.toISOString()]);
}

// ───────────────────────────────────────────────────── enqueue / delete

/**
 * Called AFTER the confirm transaction commits, never inside it (PRD 01 §7.1).
 * A job enqueued inside a transaction that later rolls back is a job that
 * embeds a Win which does not exist.
 */
export async function enqueueEmbedWin(
    win: Pick<Win, 'id' | 'status' | 'sensitivity' | 'updatedAt'>,
    opts: { repairDay?: string } = {},
): Promise<EnqueueResult | null> {
    if (!mayEmbed(win)) return null;
    // A repair (the Win is marked embedded but its vector is gone) needs its own
    // key: the original key belongs to a job that already succeeded, so reusing
    // it would dedupe the repair into nothing.
    const base = embedWinDedupeKey(win.id, win.updatedAt);
    const dedupeKey = opts.repairDay ? buildDedupeKey('embed-win-repair', [win.id, opts.repairDay]) : base;
    try {
        return await enqueue(EMBED_WIN_JOB_KIND, { winId: win.id }, { dedupeKey });
    } catch (error) {
        // Embedding is a retrieval optimization; failing to schedule it must not
        // fail the confirm the user just made. The reconcile job picks it up.
        console.warn('[jobs/embedWin] enqueue failed', {
            winId: win.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Synchronous point removal — used by un-confirm and by a sensitivity
 * downgrade, both of which must not return success until the vector is gone
 * (PRD 01 §4.4, §12). Deletes by the deterministic id *and* any stored id, so a
 * point written by an older randomly-idded run is cleaned up too.
 */
export async function deleteWinPoint(params: { winId: string; storedPointId?: string | null }): Promise<void> {
    const ids = new Set<string>([winPointId(params.winId)]);
    if (params.storedPointId) ids.add(params.storedPointId);
    for (const id of ids) {
        await deleteFromQdrant(id);
    }
}

// ───────────────────────────────────────────────────── the handler

export const embedWinHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = EmbedWinPayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        // A malformed payload will never become well-formed; retrying is waste.
        ctx.log('embed_win: unusable payload', { issues: parsed.error.issues.length });
        return { embedded: false, reason: 'bad_payload' };
    }
    const { winId } = parsed.data;

    const win = await prisma.win.findUnique({ where: { id: winId } });
    if (!win) {
        ctx.log('embed_win: win no longer exists', { winId });
        return { embedded: false, reason: 'missing' };
    }

    // Re-checked here, not trusted from the payload: the Win may have been
    // un-confirmed or downgraded between enqueue and execution.
    if (!mayEmbed(win)) {
        await deleteWinPoint({ winId: win.id, storedPointId: win.qdrantPointId });
        await prisma.win.updateMany({
            where: { id: win.id },
            data: { embedded: false, qdrantPointId: null },
        });
        ctx.log('embed_win: not embeddable', { winId, status: win.status, sensitivity: win.sensitivity });
        return { embedded: false, reason: 'not_embeddable' };
    }

    const content = buildWinEmbeddingText(win);
    if (!content.trim()) {
        return { embedded: false, reason: 'empty' };
    }

    const vector = await embedder(content, { userId: win.userId, winId: win.id });
    const pointId = winPointId(win.id);
    await upsertToQdrant({ pointId, vector, payload: buildWinQdrantPayload(win, content) });

    // Conditional write (the `gateMeteredAction` idiom, CLAUDE.md conventions):
    // only claim the point if the Win is *still* embeddable.
    const marked = await prisma.win.updateMany({
        where: { id: win.id, status: WinStatus.confirmed, sensitivity: WinSensitivity.shareable },
        data: { embedded: true, qdrantPointId: pointId },
    });

    if (marked.count === 0) {
        // We lost the race with an un-confirm or a downgrade. Undo our own write
        // rather than leaving a point that no query is allowed to return.
        await deleteWinPoint({ winId: win.id });
        ctx.log('embed_win: raced with a downgrade, point removed', { winId });
        return { embedded: false, reason: 'raced' };
    }

    ctx.log('embed_win: ok', { winId, pointId });
    return { embedded: true, pointId, chars: content.length };
};
