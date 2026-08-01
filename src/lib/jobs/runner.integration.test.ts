/**
 * Job runner — integration tests against a live Postgres.
 *
 * These verify the claims `runner.test.ts` cannot: atomicity, dedupe as a
 * database guarantee, backoff persistence, and stuck-lock recovery. The pure
 * unit suite proves the *policy* is right; this proves the *storage* is.
 *
 * Requires the local Docker Postgres. `.env.test` pins DATABASE_URL to it —
 * `bun test` sets NODE_ENV=test and Bun deliberately skips `.env.local` in that
 * mode, so without `.env.test` these would run against production.
 *
 * Isolation: every test tags its rows with a unique kind-scoped dedupeKey
 * prefix and deletes only what it created. Never assume an empty table.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { JobStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    STUCK_AFTER_MS,
    claimJobs,
    createInstanceId,
    drain,
    enqueue,
    recoverStuckJobs,
    registerHandler,
} from './runner';

/** Unique per run so parallel/repeat runs never collide. */
const RUN = `itest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const created: string[] = [];

function key(name: string): string {
    return `${RUN}:${name}`;
}

async function track<T extends { jobId: string }>(p: Promise<T>): Promise<T> {
    const r = await p;
    created.push(r.jobId);
    return r;
}

/** Rows this run created, plus any children they fanned out to. */
async function cleanup(): Promise<void> {
    await prisma.job.deleteMany({
        where: { OR: [{ id: { in: created } }, { dedupeKey: { startsWith: `${RUN}:` } }] },
    });
    created.length = 0;
}

beforeAll(() => {
    // Handlers used below. Registration is idempotent.
    registerHandler('noop', async (payload) => {
        const p = (payload ?? {}) as { failWith?: string; sleepMs?: number; echo?: unknown };
        if (p.failWith) throw new Error(p.failWith);
        if (p.sleepMs) await new Promise((r) => setTimeout(r, p.sleepMs));
        return { echoed: p.echo ?? null };
    });
});

afterEach(cleanup);

describe('enqueue — dedupe is a database guarantee', () => {
    test('duplicate dedupeKey returns deduped:true, same jobId, one row, no throw', async () => {
        const k = key('dupe');
        const first = await track(enqueue('noop', { n: 1 }, { dedupeKey: k }));
        const second = await enqueue('noop', { n: 2 }, { dedupeKey: k });

        expect(first.deduped).toBe(false);
        expect(second.deduped).toBe(true);
        expect(second.jobId).toBe(first.jobId);

        const rows = await prisma.job.findMany({ where: { dedupeKey: k } });
        expect(rows).toHaveLength(1);
        // The loser's payload must not overwrite the winner's.
        expect((rows[0].payload as { n: number }).n).toBe(1);
    });

    test('concurrent enqueues of the same key still produce exactly one row', async () => {
        const k = key('dupe-race');
        const results = await Promise.all(
            Array.from({ length: 8 }, (_, i) => enqueue('noop', { i }, { dedupeKey: k })),
        );
        results.forEach((r) => created.push(r.jobId));

        const rows = await prisma.job.findMany({ where: { dedupeKey: k } });
        expect(rows).toHaveLength(1);
        expect(results.filter((r) => !r.deduped)).toHaveLength(1);
        expect(new Set(results.map((r) => r.jobId)).size).toBe(1);
    });
});

describe('claim — atomicity', () => {
    test('two concurrent claims never return the same job', async () => {
        const n = 6;
        await Promise.all(
            Array.from({ length: n }, (_, i) =>
                track(enqueue('noop', { i }, { dedupeKey: key(`race-${i}`) })),
            ),
        );

        const [a, b] = await Promise.all([
            claimJobs(n, createInstanceId()),
            claimJobs(n, createInstanceId()),
        ]);

        const mine = new Set(created);
        const aIds = a.filter((j) => mine.has(j.id)).map((j) => j.id);
        const bIds = b.filter((j) => mine.has(j.id)).map((j) => j.id);
        const overlap = aIds.filter((id) => bIds.includes(id));

        expect(overlap).toEqual([]);
        // Every claimed row is genuinely locked, by exactly one instance.
        const claimed = await prisma.job.findMany({ where: { id: { in: [...aIds, ...bIds] } } });
        claimed.forEach((j) => {
            expect(j.status).toBe(JobStatus.running);
            expect(j.lockedBy).toBeTruthy();
        });
    });

    test('claim respects priority then runAt, and skips a future runAt', async () => {
        const past = new Date(Date.now() - 60_000);
        const older = new Date(Date.now() - 120_000);
        const future = new Date(Date.now() + 60 * 60_000);

        const low = await track(enqueue('noop', {}, { dedupeKey: key('p200'), priority: 200, runAt: older }));
        const hiNew = await track(enqueue('noop', {}, { dedupeKey: key('p100-new'), priority: 100, runAt: past }));
        const hiOld = await track(enqueue('noop', {}, { dedupeKey: key('p100-old'), priority: 100, runAt: older }));
        const later = await track(enqueue('noop', {}, { dedupeKey: key('future'), priority: 1, runAt: future }));

        const claimed = await claimJobs(50, createInstanceId());
        const order = claimed.map((j) => j.id).filter((id) => created.includes(id));

        // Future job is not eligible at any priority.
        expect(order).not.toContain(later.jobId);
        // priority 100 before 200; within a priority, older runAt first.
        expect(order.indexOf(hiOld.jobId)).toBeLessThan(order.indexOf(hiNew.jobId));
        expect(order.indexOf(hiNew.jobId)).toBeLessThan(order.indexOf(low.jobId));
    });
});

describe('execution — failure, backoff, and dead-lettering', () => {
    test('a throwing handler increments attempts and reschedules with backoff', async () => {
        const { jobId } = await track(
            enqueue('noop', { failWith: 'boom' }, { dedupeKey: key('retry'), maxAttempts: 3 }),
        );

        const before = Date.now();
        await drain(10_000, 50);

        const row = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        expect(row.status).toBe(JobStatus.pending);
        expect(row.attempts).toBe(1);
        expect(row.lastError).toContain('boom');
        expect(row.lockedAt).toBeNull();
        expect(row.lockedBy).toBeNull();
        // 2^1 = 2 minutes, allowing for drain duration.
        const delayMs = row.runAt.getTime() - before;
        expect(delayMs).toBeGreaterThan(60_000);
        expect(delayMs).toBeLessThan(3 * 60_000);
    });

    test('maxAttempts exhausted transitions to dead and the row survives', async () => {
        const { jobId } = await track(
            enqueue('noop', { failWith: 'fatal' }, { dedupeKey: key('dead'), maxAttempts: 1 }),
        );

        await drain(10_000, 50);

        const row = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        expect(row.status).toBe(JobStatus.dead);
        expect(row.finishedAt).not.toBeNull();
        expect(row.lastError).toContain('fatal');
    });

    test('a successful job records duration, result, and clears its lock', async () => {
        const { jobId } = await track(
            enqueue('noop', { echo: 'hello' }, { dedupeKey: key('ok') }),
        );

        await drain(10_000, 50);

        const row = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        expect(row.status).toBe(JobStatus.succeeded);
        expect(row.finishedAt).not.toBeNull();
        expect(row.durationMs).toBeGreaterThanOrEqual(0);
        expect(row.lockedAt).toBeNull();
        expect(row.lockedBy).toBeNull();
        expect(row.lastError).toBeNull();
        expect((row.result as { echoed: string }).echoed).toBe('hello');
    });
});

describe('stuck-lock recovery', () => {
    test('locked 11 minutes ago is reclaimed; 9 minutes ago is not', async () => {
        const stale = await track(enqueue('noop', {}, { dedupeKey: key('stale') }));
        const fresh = await track(enqueue('noop', {}, { dedupeKey: key('fresh') }));

        const now = Date.now();
        await prisma.job.update({
            where: { id: stale.jobId },
            data: {
                status: JobStatus.running,
                lockedAt: new Date(now - (STUCK_AFTER_MS + 60_000)),
                lockedBy: 'dead-worker',
            },
        });
        await prisma.job.update({
            where: { id: fresh.jobId },
            data: {
                status: JobStatus.running,
                lockedAt: new Date(now - (STUCK_AFTER_MS - 60_000)),
                lockedBy: 'live-worker',
            },
        });

        const recovered = await recoverStuckJobs();
        expect(recovered).toBeGreaterThanOrEqual(1);

        const staleRow = await prisma.job.findUniqueOrThrow({ where: { id: stale.jobId } });
        const freshRow = await prisma.job.findUniqueOrThrow({ where: { id: fresh.jobId } });

        expect(staleRow.status).toBe(JobStatus.pending);
        expect(staleRow.attempts).toBe(1);
        expect(staleRow.lockedAt).toBeNull();

        // Still held — recovering a live worker's job would double-run it.
        expect(freshRow.status).toBe(JobStatus.running);
        expect(freshRow.lockedBy).toBe('live-worker');
    });
});

describe('drain — bounded by its time budget', () => {
    test('stops claiming at the budget and reports work remaining', async () => {
        // Each job sleeps; concurrency 4 means ~3 sequential rounds minimum.
        await Promise.all(
            Array.from({ length: 24 }, (_, i) =>
                track(enqueue('noop', { sleepMs: 120 }, { dedupeKey: key(`slow-${i}`) })),
            ),
        );

        const budgetMs = 300;
        const started = Date.now();
        const result = await drain(budgetMs, 4);
        const took = Date.now() - started;

        expect(result.budgetExhausted).toBe(true);
        expect(result.workRemaining).toBe(true);
        expect(result.claimed).toBeLessThan(24);
        // Returns near the budget, not after draining everything (~720ms+).
        expect(took).toBeLessThan(budgetMs + 1_500);

        const leftover = await prisma.job.count({
            where: { dedupeKey: { startsWith: `${RUN}:slow-` }, status: JobStatus.pending },
        });
        expect(leftover).toBeGreaterThan(0);
    });
});
