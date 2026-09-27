/**
 * Integration-test fixtures for the Work Log data layer.
 *
 * Deliberately NOT a `*.test.ts` file so the runner does not collect it.
 *
 * Every fixture is namespaced under a freshly generated `userId`, and teardown
 * only ever deletes rows carrying that id. The local database is shared with
 * real development data — a test that truncates a table is a test that deletes
 * someone's work.
 */

import { randomUUID } from 'node:crypto';
import {
    WinCategory,
    WinSensitivity,
    WinSource,
    type Win,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { qdrantClient } from '@/lib/qdrantClient';
import { ensureKnowledgeBaseCollection, KNOWLEDGE_BASE_COLLECTION } from '@/lib/embeddings';
import { createWinRecord, type NewWinInput } from '@/services/winGraph';
import type { JobContext } from '@/lib/jobs/types';

export const QDRANT_COLLECTION = KNOWLEDGE_BASE_COLLECTION;

export function newTestUserId(label = 'b1'): string {
    return `test-worklog-${label}-${randomUUID()}`;
}

/** A deterministic pseudo-embedding: no network, no API key, stable per text. */
export function fakeEmbedding(text: string, size = config.openai.embedding.size): number[] {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    const vector = new Array<number>(size);
    let state = seed >>> 0;
    for (let i = 0; i < size; i += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        vector[i] = state / 0xffffffff - 0.5;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
}

// ───────────────────────────────────────────────────────────── vector store helpers
//
// Through the live client binding, never raw HTTP to a Qdrant server: the
// store is Postgres/pgvector by default (src/lib/qdrantClient.ts), and a test
// must assert what is in the store the app actually wrote to.

export type QdrantPoint = { id: string; payload: Record<string, unknown> };

/** Raw scroll so a test can assert what is *actually* in the collection. */
export async function qdrantScroll(filter: unknown, limit = 50): Promise<QdrantPoint[]> {
    await ensureKnowledgeBaseCollection();
    const page = await qdrantClient.scroll(QDRANT_COLLECTION, {
        filter: filter as never,
        limit,
        with_payload: true,
    });
    return page.points.map((point) => ({
        id: String(point.id),
        payload: (point.payload ?? {}) as Record<string, unknown>,
    }));
}

export async function qdrantPointsForUser(userId: string): Promise<QdrantPoint[]> {
    return qdrantScroll({ must: [{ key: 'userId', match: { value: userId } }] });
}

export async function qdrantUpsertRaw(point: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
}): Promise<void> {
    await ensureKnowledgeBaseCollection();
    await qdrantClient.upsert(QDRANT_COLLECTION, { wait: true, points: [point] });
}

async function qdrantDeleteByUser(userId: string): Promise<void> {
    await ensureKnowledgeBaseCollection();
    await qdrantClient.delete(QDRANT_COLLECTION, {
        wait: true,
        filter: { must: [{ key: 'userId', match: { value: userId } }] },
    });
}

// ───────────────────────────────────────────────────────────── job context

export function fakeJobContext(overrides: Partial<JobContext> = {}): JobContext {
    return {
        jobId: `job-${randomUUID()}`,
        attempt: 1,
        deadline: new Date(Date.now() + 60_000),
        enqueue: async () => ({ jobId: `enqueued-${randomUUID()}`, deduped: false }),
        log: () => {},
        ...overrides,
    };
}

// ───────────────────────────────────────────────────────────── row factories

export async function makeExperience(params: {
    userId: string;
    company: string;
    role?: string;
    startDate: string;
    endDate?: string;
    current?: boolean;
}): Promise<{ id: string; company: string }> {
    const row = await prisma.userExperience.create({
        data: {
            userId: params.userId,
            company: params.company,
            role: params.role ?? 'Engineer',
            startDate: params.startDate,
            endDate: params.endDate ?? '',
            current: params.current ?? false,
        },
        select: { id: true, company: true },
    });
    return row;
}

/**
 * Win ids created per test user, remembered so teardown can still find the
 * `embed_win` job rows of a Win that the test itself deleted.
 */
const createdWinIds = new Map<string, string[]>();

/**
 * Register a Win created by something other than {@link makeWin} — a test that
 * goes through the server action, say. Teardown needs the id even after the
 * test has deleted the row.
 */
export function rememberWin(userId: string, winId: string): void {
    createdWinIds.set(userId, [...(createdWinIds.get(userId) ?? []), winId]);
}

export async function makeWin(input: Partial<NewWinInput> & { userId: string }): Promise<Win> {
    const win = await createWinRecord({
        title: 'Cut checkout p95 latency from 800ms to 180ms',
        narrative: 'Rewrote the pricing lookup as a single batched query.',
        occurredAt: new Date('2026-07-14T00:00:00.000Z'),
        category: WinCategory.improved,
        sensitivity: WinSensitivity.shareable,
        source: WinSource.manual,
        ...input,
    });
    rememberWin(input.userId, win.id);
    return win;
}

// ───────────────────────────────────────────────────────────── teardown

/**
 * Removes everything this user's fixtures could have written, in FK-safe order.
 * Scoped by `userId` only — never a truncate, never a date range.
 */
export async function cleanupTestUser(userId: string): Promise<void> {
    const wins = await prisma.win.findMany({ where: { userId }, select: { id: true } });
    // Union with the ids we recorded at creation: a test that exercised
    // `deleteWin` has already removed the row, but its job rows remain.
    const winIds = [...new Set([...wins.map((win) => win.id), ...(createdWinIds.get(userId) ?? [])])];
    createdWinIds.delete(userId);

    await prisma.claimLink.deleteMany({ where: { userId } });
    // ClaimLink cascades from Evidence, but drafts can leave orphan evidence too.
    await prisma.evidence.deleteMany({ where: { userId } });
    await prisma.impactMetric.deleteMany({ where: { userId } });
    if (winIds.length > 0) {
        await prisma.job.deleteMany({
            where: { OR: winIds.map((winId) => ({ dedupeKey: { startsWith: `embed-win:${winId}` } })) },
        });
    }
    await prisma.win.deleteMany({ where: { userId } });
    await prisma.userExperience.deleteMany({ where: { userId } });
    await prisma.funnelEvent.deleteMany({ where: { userId } });
    await prisma.apiUsageLog.deleteMany({ where: { userId } });
    await prisma.usageQuota.deleteMany({ where: { userId } });
    await prisma.subscription.deleteMany({ where: { userId } });

    await qdrantDeleteByUser(userId);
}
