/**
 * `ingest_board`, against the real local Postgres.
 *
 * The adapter is stubbed via a fake `JobSource` provider so these tests are
 * about the STATE MACHINE — what a 404 streak does to a board, what happens to
 * a posting that disappears, whether a re-poll updates or duplicates. Those are
 * the parts that corrupt data quietly if they are wrong; the HTTP shapes are
 * covered in `boards.test.ts` and against the live hosts.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { JobSourceStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ingestBoardHandler, dueBoards } from './ingestBoard';

const tokens: string[] = [];

function token(label: string): string {
    const t = `test-${label}-${crypto.randomUUID().slice(0, 8)}`;
    tokens.push(t);
    return t;
}

async function makeSource(patch: {
    boardToken: string;
    provider?: 'greenhouse' | 'ashby' | 'lever';
    status?: JobSourceStatus;
    notFoundStreak?: number;
    lastFetchedAt?: Date | null;
}) {
    return prisma.jobSource.create({
        data: {
            provider: patch.provider ?? 'greenhouse',
            boardToken: patch.boardToken,
            companyName: patch.boardToken,
            discoveredVia: 'test',
            status: patch.status ?? JobSourceStatus.active,
            notFoundStreak: patch.notFoundStreak ?? 0,
            lastFetchedAt: patch.lastFetchedAt ?? null,
        },
        select: { id: true },
    });
}

/**
 * Point the adapter at a stub server response by monkey-patching global fetch
 * for the duration of one call. The handler resolves its adapter internally,
 * so this is the seam available without threading an injection parameter
 * through the job contract for tests alone.
 */
async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
        return await run();
    } finally {
        globalThis.fetch = original;
    }
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
    return (async () =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
}

function ghJobs(jobs: Array<{ id: number; title: string; location?: string }>) {
    return {
        jobs: jobs.map((j) => ({
            id: j.id,
            title: j.title,
            absolute_url: `https://example.test/${j.id}`,
            location: { name: j.location ?? 'New York, NY' },
            content: '<p>Role description.</p>',
        })),
    };
}

afterEach(async () => {
    while (tokens.length > 0) {
        const t = tokens.pop();
        if (!t) continue;
        await prisma.jobPosting.deleteMany({ where: { source: { boardToken: t } } });
        await prisma.jobSource.deleteMany({ where: { boardToken: t } });
    }
});

describe('storing postings', () => {
    test('a successful poll stores postings and marks the board healthy', async () => {
        const t = token('ok');
        const src = await makeSource({ boardToken: t });

        const result = await withFetch(
            respond(200, ghJobs([{ id: 1, title: 'Senior Backend Engineer' }]), { etag: 'W/"1"' }),
            () => ingestBoardHandler({ sourceId: src.id }, {} as never),
        );

        expect(result).toMatchObject({ result: 'ok', upserted: 1 });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.etag).toBe('W/"1"');
        expect(row.lastSuccessAt).not.toBeNull();
        expect(row.errorCount).toBe(0);
    });

    test('re-polling the same posting updates rather than duplicating', async () => {
        const t = token('upsert');
        const src = await makeSource({ boardToken: t });

        await withFetch(respond(200, ghJobs([{ id: 7, title: 'Engineer' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never),
        );
        await withFetch(respond(200, ghJobs([{ id: 7, title: 'Staff Engineer' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never),
        );

        const postings = await prisma.jobPosting.findMany({ where: { sourceId: src.id } });
        expect(postings).toHaveLength(1);
        expect(postings[0].title).toBe('Staff Engineer');
        // The re-classification must follow the new title.
        expect(postings[0].seniority).toBe('staff_plus');
    });

    test('a posting that leaves the board is closed, never deleted', async () => {
        // A closed posting is still evidence a role was advertised, and band
        // windows read `postedAt`, not liveness.
        const t = token('close');
        const src = await makeSource({ boardToken: t });

        await withFetch(respond(200, ghJobs([{ id: 1, title: 'A' }, { id: 2, title: 'B' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never),
        );
        await withFetch(respond(200, ghJobs([{ id: 1, title: 'A' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never),
        );

        const all = await prisma.jobPosting.findMany({ where: { sourceId: src.id }, orderBy: { externalId: 'asc' } });
        expect(all).toHaveLength(2);
        expect(all.find((p) => p.externalId === '1')?.closedAt).toBeNull();
        expect(all.find((p) => p.externalId === '2')?.closedAt).not.toBeNull();
    });

    test('a posting that comes back is reopened', async () => {
        const t = token('reopen');
        const src = await makeSource({ boardToken: t });

        await withFetch(respond(200, ghJobs([{ id: 1, title: 'A' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));
        await withFetch(respond(200, ghJobs([])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));
        await withFetch(respond(200, ghJobs([{ id: 1, title: 'A' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        const p = await prisma.jobPosting.findFirstOrThrow({ where: { sourceId: src.id } });
        expect(p.closedAt).toBeNull();
    });
});

describe('board health', () => {
    test('a 404 increments the streak without retiring the board', async () => {
        const t = token('404');
        const src = await makeSource({ boardToken: t });

        const result = await withFetch(respond(404), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        expect(result).toMatchObject({ result: 'not_found', streak: 1, retired: false });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.status).toBe(JobSourceStatus.active);
    });

    test('the fifth consecutive 404 retires it', async () => {
        const t = token('retire');
        const src = await makeSource({ boardToken: t, notFoundStreak: 4 });

        const result = await withFetch(respond(404), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        expect(result).toMatchObject({ retired: true, streak: 5 });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.status).toBe(JobSourceStatus.inactive);
    });

    test('one good poll clears a streak short of the limit', async () => {
        // Otherwise a board that 404s four times over four months would retire
        // on an unrelated blip a year later.
        const t = token('recover');
        const src = await makeSource({ boardToken: t, notFoundStreak: 3 });

        await withFetch(respond(200, ghJobs([{ id: 1, title: 'Engineer' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.notFoundStreak).toBe(0);
    });

    test('a 304 is a success: counters reset, nothing re-stored', async () => {
        const t = token('304');
        const src = await makeSource({ boardToken: t, notFoundStreak: 2 });

        const result = await withFetch(respond(304), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        expect(result).toMatchObject({ result: 'not_modified' });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.notFoundStreak).toBe(0);
        expect(row.lastSuccessAt).not.toBeNull();
    });

    test('a 429 throttles rather than counting as a failure', async () => {
        const t = token('429');
        const src = await makeSource({ boardToken: t });

        await withFetch(respond(429), () => ingestBoardHandler({ sourceId: src.id }, {} as never));

        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.status).toBe(JobSourceStatus.throttled);
        // Being rate limited is not the board's fault, nor ours.
        expect(row.notFoundStreak).toBe(0);
    });

    test('a throttled board that answers is healthy again', async () => {
        const t = token('unthrottle');
        const src = await makeSource({ boardToken: t, status: JobSourceStatus.throttled });

        await withFetch(respond(200, ghJobs([{ id: 1, title: 'Engineer' }])), () =>
            ingestBoardHandler({ sourceId: src.id }, {} as never));

        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.status).toBe(JobSourceStatus.active);
    });

    test('a 500 throws, so the runner owns the retry policy', async () => {
        // A second retry policy invented here would fight the runner's.
        const t = token('500');
        const src = await makeSource({ boardToken: t });

        await expect(
            withFetch(respond(500, {}), () => ingestBoardHandler({ sourceId: src.id }, {} as never)),
        ).rejects.toThrow();

        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: src.id } });
        expect(row.errorCount).toBe(1);
    });
});

describe('due-board selection', () => {
    test('a retired board is never polled again', async () => {
        const t = token('inactive');
        const src = await makeSource({ boardToken: t, status: JobSourceStatus.inactive });
        const due = await dueBoards(500);
        expect(due.map((d) => d.id)).not.toContain(src.id);
    });

    test('a board for an unimplemented provider is skipped, not dead-lettered', async () => {
        const t = token('lever');
        const src = await makeSource({ boardToken: t, provider: 'lever' });
        const due = await dueBoards(500);
        expect(due.map((d) => d.id)).not.toContain(src.id);
    });

    test('a never-fetched board is due', async () => {
        const t = token('fresh');
        const src = await makeSource({ boardToken: t, lastFetchedAt: null });
        const due = await dueBoards(500);
        expect(due.map((d) => d.id)).toContain(src.id);
    });

    test('a board polled minutes ago is not due again', async () => {
        const t = token('recent');
        const src = await makeSource({ boardToken: t, lastFetchedAt: new Date() });
        const due = await dueBoards(500);
        expect(due.map((d) => d.id)).not.toContain(src.id);
    });
});

describe('missing source', () => {
    test('a deleted board is a no-op, not a crash', async () => {
        const result = await ingestBoardHandler({ sourceId: 'does-not-exist' }, {} as never);
        expect(result).toMatchObject({ skipped: 'source_missing' });
    });
});
