/**
 * Reconciliation sweep — integration tests against the live local Postgres.
 *
 * The sweep exists to catch drift the happy path cannot, so the tests have to
 * *create* that drift deliberately: rows written into exactly the state a crash
 * between the transaction and the Qdrant call would leave behind.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reconcileGraphHandler, type ReconcileReport } from './reconcileGraph';
import type { JobContext } from '../types';

const RUN = `itest-recon-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}:user`;
const created: string[] = [];

type Enqueued = { kind: string; payload: object };

function makeCtx(): { ctx: JobContext; enqueued: Enqueued[]; logs: string[] } {
    const enqueued: Enqueued[] = [];
    const logs: string[] = [];
    const ctx = {
        jobId: `${RUN}:job`,
        attempt: 1,
        deadline: new Date(Date.now() + 60_000),
        enqueue: async (kind: string, payload: object) => {
            enqueued.push({ kind, payload });
            return { jobId: `${RUN}:child`, deduped: false };
        },
        log: (message: string) => logs.push(message),
    } as unknown as JobContext;
    return { ctx, enqueued, logs };
}

async function makeWin(overrides: {
    status?: WinStatus;
    sensitivity?: WinSensitivity;
    embedded?: boolean;
    qdrantPointId?: string | null;
    grounded?: boolean;
}): Promise<string> {
    const win = await prisma.win.create({
        data: {
            userId: USER,
            title: `${RUN} win`,
            narrative: 'body',
            occurredAt: new Date(),
            category: WinCategory.shipped,
            source: WinSource.manual,
            status: overrides.status ?? WinStatus.confirmed,
            sensitivity: overrides.sensitivity ?? WinSensitivity.shareable,
            embedded: overrides.embedded ?? false,
            qdrantPointId: overrides.qdrantPointId ?? null,
        },
        select: { id: true },
    });
    created.push(win.id);

    if (overrides.grounded) {
        const evidence = await prisma.evidence.create({
            data: { userId: USER, kind: 'metric_confirmed', sourceRef: RUN, excerpt: 'x', confirmedByUser: true },
            select: { id: true },
        });
        await prisma.claimLink.create({
            data: {
                userId: USER, claimType: 'win', claimRefId: win.id,
                evidenceId: evidence.id, groundState: 'grounded',
            },
        });
    }
    return win.id;
}

/** Scoped to this run's user so the collection-wide orphan pass stays off. */
async function sweep(dryRun = false): Promise<{ report: ReconcileReport; enqueued: Enqueued[] }> {
    const { ctx, enqueued } = makeCtx();
    const report = (await reconcileGraphHandler({ userId: USER, dryRun }, ctx)) as ReconcileReport;
    return { report, enqueued };
}

afterEach(async () => {
    if (created.length > 0) {
        await prisma.job.deleteMany({ where: { OR: created.map((id) => ({ dedupeKey: { contains: id } })) } });
    }
    await prisma.claimLink.deleteMany({ where: { userId: USER } });
    await prisma.evidence.deleteMany({ where: { userId: USER } });
    await prisma.win.deleteMany({ where: { userId: USER } });
    created.length = 0;
});

describe('leaked vectors — the drift that is a privacy incident', () => {
    test('a confidential Win still carrying a vector is detected and cleared', async () => {
        // Exactly what a failed post-transaction Qdrant delete leaves behind.
        // A real UUID: Qdrant rejects malformed point ids outright, and this
        // test is about the leak, not about id validation.
        const winId = await makeWin({
            sensitivity: WinSensitivity.confidential,
            embedded: true,
            grounded: true,
        });

        const { report } = await sweep();
        expect(report.leaked).toBe(1);

        const row = await prisma.win.findUniqueOrThrow({ where: { id: winId } });
        expect(row.embedded).toBe(false);
        expect(row.qdrantPointId).toBeNull();
    });

    test('internal_only is treated the same as confidential', async () => {
        await makeWin({
            sensitivity: WinSensitivity.internal_only,
            embedded: true,
            grounded: true,
        });
        expect((await sweep()).report.leaked).toBe(1);
    });

    test('an archived Win keeps no vector — leaving confirmed means leaving retrieval', async () => {
        await makeWin({ status: WinStatus.archived, embedded: true, grounded: true });
        expect((await sweep()).report.leaked).toBe(1);
    });

    test('a shareable confirmed Win with a vector is left alone', async () => {
        const winId = await makeWin({ embedded: true, grounded: true });
        const { report } = await sweep();
        expect(report.leaked).toBe(0);

        const row = await prisma.win.findUniqueOrThrow({ where: { id: winId } });
        expect(row.embedded).toBe(true);
    });
});

describe('confirmed but ungrounded — the rule 5 violation', () => {
    test('a confirmed Win with no grounded ClaimLink is reported', async () => {
        await makeWin({ status: WinStatus.confirmed, grounded: false });
        expect((await sweep()).report.ungrounded).toBe(1);
    });

    test('a grounded Win is not reported', async () => {
        await makeWin({ status: WinStatus.confirmed, grounded: true });
        expect((await sweep()).report.ungrounded).toBe(0);
    });

    test('a draft is not expected to be grounded', async () => {
        await makeWin({ status: WinStatus.draft, grounded: false });
        expect((await sweep()).report.ungrounded).toBe(0);
    });

    test('it is reported, never silently repaired', async () => {
        // Manufacturing evidence for a Win whose source artifact cannot be
        // reconstructed would be exactly the fabrication the product forbids.
        const winId = await makeWin({ status: WinStatus.confirmed, grounded: false });
        await sweep();

        const links = await prisma.claimLink.count({ where: { claimRefId: winId } });
        expect(links).toBe(0);
        const row = await prisma.win.findUniqueOrThrow({ where: { id: winId } });
        expect(row.status).toBe(WinStatus.confirmed);
    });
});

describe('missing vectors', () => {
    test('an embeddable Win with no vector is re-enqueued, not embedded inline', async () => {
        const winId = await makeWin({ embedded: false, grounded: true });
        const { report } = await sweep();

        expect(report.missing).toBe(1);

        // `enqueueEmbedWin` goes through the module-level `enqueue`, not
        // `ctx.enqueue`, because server actions call it too. So assert the row.
        const jobs = await prisma.job.findMany({
            where: { kind: 'embed_win', dedupeKey: { contains: winId } },
        });
        expect(jobs).toHaveLength(1);
        await prisma.job.deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } });
    });

    test('a Win marked embedded whose vector is gone gets a repair job', async () => {
        // Every row in production after the Qdrant Cloud cluster was lost: the
        // column says embedded, the store has nothing. The original embed job
        // succeeded long ago, so the repair must not reuse its dedupe key.
        const winId = await makeWin({ embedded: true, qdrantPointId: crypto.randomUUID(), grounded: true });
        const { report } = await sweep();

        expect(report.missing).toBe(1);
        const jobs = await prisma.job.findMany({ where: { kind: 'embed_win', dedupeKey: { contains: winId } } });
        expect(jobs).toHaveLength(1);
        expect(jobs[0].dedupeKey).toContain('embed-win-repair');
    });

    test('a Win whose vector is live is not re-enqueued', async () => {
        const { upsertToQdrant, deleteFromQdrant } = await import('@/lib/embeddings');
        const { config } = await import('@/lib/config');
        const winId = await makeWin({ embedded: true, grounded: true });
        const vector = Array.from({ length: config.openai.embedding.size }, (_, i) => (i === 0 ? 1 : 0));
        const pointId = await upsertToQdrant({ vector, payload: { userId: USER, type: 'win', sourceId: winId } });
        try {
            const { report } = await sweep();
            expect(report.missing).toBe(0);
        } finally {
            await deleteFromQdrant(pointId);
        }
    });

    test('a confidential Win is never enqueued for embedding', async () => {
        const winId = await makeWin({
            sensitivity: WinSensitivity.confidential, embedded: false, grounded: true,
        });
        const { report } = await sweep();
        expect(report.missing).toBe(0);

        const jobs = await prisma.job.count({
            where: { kind: 'embed_win', dedupeKey: { contains: winId } },
        });
        expect(jobs).toBe(0);
    });
});

describe('dryRun', () => {
    test('reports every drift and repairs none of it', async () => {
        const leakedId = await makeWin({
            sensitivity: WinSensitivity.confidential, embedded: true, grounded: true,
        });
        await makeWin({ status: WinStatus.confirmed, grounded: false });
        await makeWin({ embedded: false, grounded: true });

        const { report } = await sweep(true);

        expect(report.dryRun).toBe(true);
        expect(report.leaked).toBe(1);
        expect(report.ungrounded).toBe(1);
        // Two: the dedicated fixture, and the ungrounded one, which is also
        // shareable and unembedded. A Win can be in more than one drift class.
        expect(report.missing).toBe(2);
        expect(report.repaired).toBe(0);

        const jobs = await prisma.job.count({
            where: { kind: 'embed_win', dedupeKey: { contains: RUN } },
        });
        expect(jobs).toBe(0);

        // The leak is still there — a dry run must not have touched it.
        const row = await prisma.win.findUniqueOrThrow({ where: { id: leakedId } });
        expect(row.embedded).toBe(true);
    });
});

describe('idempotence', () => {
    test('a second sweep finds nothing left to repair', async () => {
        await makeWin({ sensitivity: WinSensitivity.confidential, embedded: true, grounded: true });

        const first = await sweep();
        expect(first.report.leaked).toBe(1);

        const second = await sweep();
        expect(second.report.leaked).toBe(0);
        expect(second.report.repaired).toBe(0);
    });

    test('dismissed Wins are out of scope entirely', async () => {
        await makeWin({ status: WinStatus.dismissed, embedded: true, grounded: false });
        const { report } = await sweep();
        expect(report.scanned).toBe(0);
    });
});
