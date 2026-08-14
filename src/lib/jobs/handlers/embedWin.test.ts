/**
 * `embed_win` handler — idempotency and fail-closed behaviour (ADR-10 §2).
 *
 * The runner's handler deadline is soft: it stops waiting but cannot cancel
 * in-flight I/O, so a retry can run while an abandoned attempt is still
 * writing. Everything below is about that: N runs produce one point, and a run
 * that finishes after the Win stopped being embeddable cleans up after itself.
 *
 * Real Postgres, real Qdrant, faked embedding vector.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { WinSensitivity, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    buildWinEmbeddingText,
    buildWinQdrantPayload,
    embedWinDedupeKey,
    embedWinHandler,
    enqueueEmbedWin,
    winPointId,
    __testing as embedTesting,
} from '@/lib/jobs/handlers/embedWin';
import { WIN_POINT_TYPE } from '@/lib/graph/visibility';
import { confirmWin } from '@/services/winGraph';
import {
    cleanupTestUser,
    fakeEmbedding,
    fakeJobContext,
    makeWin,
    newTestUserId,
    qdrantPointsForUser,
} from '@/services/winFixtures.test-utils';

const users: string[] = [];

function user(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

let embedCalls = 0;

beforeAll(() => {
    embedTesting.setEmbedder(async (text: string) => {
        embedCalls += 1;
        return fakeEmbedding(text);
    });
});

afterAll(() => {
    embedTesting.reset();
});

afterEach(async () => {
    embedCalls = 0;
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupTestUser(id);
    }
});

describe('pure helpers', () => {
    test('the point id is deterministic per win — that is what makes retries safe', () => {
        expect(winPointId('win-abc')).toBe(winPointId('win-abc'));
        expect(winPointId('win-abc')).not.toBe(winPointId('win-def'));
        expect(winPointId('win-abc')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test('embedding text is title + narrative + skills (PRD 01 §7.2)', () => {
        expect(
            buildWinEmbeddingText({ title: 'T', narrative: 'N', skills: ['a', 'b'] as unknown as never }),
        ).toBe('T\nN\na, b');
    });

    test('the payload carries sensitivity — the vector half of ADR-8', () => {
        const payload = buildWinQdrantPayload(
            {
                id: 'w1',
                userId: 'u1',
                title: 'T',
                narrative: 'N',
                skills: [] as unknown as never,
                occurredAt: new Date('2026-07-14T00:00:00.000Z'),
                periodEnd: null,
                category: 'improved',
                employerId: null,
                projectId: null,
                sensitivity: WinSensitivity.shareable,
                status: WinStatus.confirmed,
                source: 'manual',
                createdAt: new Date('2026-07-15T00:00:00.000Z'),
            },
            'T\nN',
        );
        expect(payload.sensitivity).toBe(WinSensitivity.shareable);
        expect(payload.type).toBe(WIN_POINT_TYPE);
        expect(payload.userId).toBe('u1');
        expect(payload.occurredAt).toBe('2026-07-14T00:00:00.000Z');
    });

    test('the dedupe key changes when the win changes, so an edit re-embeds', () => {
        const a = embedWinDedupeKey('w1', new Date('2026-07-14T00:00:00.000Z'));
        const b = embedWinDedupeKey('w1', new Date('2026-07-15T00:00:00.000Z'));
        expect(a).not.toBe(b);
        expect(a.startsWith('embed-win:w1')).toBe(true);
    });
});

describe('idempotency', () => {
    test('running the handler three times leaves exactly one point', async () => {
        const userId = user('idem');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });

        for (let index = 0; index < 3; index += 1) {
            const result = await embedWinHandler({ winId: win.id }, fakeJobContext());
            expect(result).toMatchObject({ embedded: true, pointId: winPointId(win.id) });
        }

        const points = await qdrantPointsForUser(userId);
        expect(points).toHaveLength(1);
        expect(points[0].id).toBe(winPointId(win.id));

        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.qdrantPointId).toBe(winPointId(win.id));
        expect(stored.embedded).toBe(true);
    });

    test('concurrent runs converge on one point', async () => {
        const userId = user('concurrent');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });

        await Promise.all([
            embedWinHandler({ winId: win.id }, fakeJobContext()),
            embedWinHandler({ winId: win.id }, fakeJobContext()),
            embedWinHandler({ winId: win.id }, fakeJobContext()),
        ]);

        expect(await qdrantPointsForUser(userId)).toHaveLength(1);
    });

    test('enqueue dedupes on the same win+updatedAt', async () => {
        const userId = user('enqueue');
        const win = await makeWin({ userId });
        await prisma.win.update({
            where: { id: win.id },
            data: { status: WinStatus.confirmed, confirmedAt: new Date() },
        });
        const confirmed = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });

        const first = await enqueueEmbedWin(confirmed);
        const second = await enqueueEmbedWin(confirmed);

        expect(first?.deduped).toBe(false);
        expect(second?.deduped).toBe(true);
        expect(second?.jobId).toBe(first?.jobId);
    });
});

describe('fail closed', () => {
    test('a win that was un-confirmed between enqueue and run is not embedded', async () => {
        const userId = user('unconfirmed');
        const win = await makeWin({ userId });
        // never confirmed
        const result = await embedWinHandler({ winId: win.id }, fakeJobContext());
        expect(result).toMatchObject({ embedded: false, reason: 'not_embeddable' });
        expect(embedCalls).toBe(0);
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
    });

    test('a stale run that finishes after a downgrade deletes the point it wrote', async () => {
        const userId = user('raced');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });

        // Simulate the abandoned-run window: the handler has read the Win and is
        // about to write, and the downgrade lands mid-flight.
        embedTesting.setEmbedder(async (text: string) => {
            await prisma.win.update({
                where: { id: win.id },
                data: { sensitivity: WinSensitivity.confidential },
            });
            return fakeEmbedding(text);
        });

        const result = await embedWinHandler({ winId: win.id }, fakeJobContext());
        expect(result).toMatchObject({ embedded: false, reason: 'raced' });
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);

        embedTesting.setEmbedder(async (text: string) => fakeEmbedding(text));
    });

    test('a handler run for a deleted win is a no-op, not a throw', async () => {
        const result = await embedWinHandler({ winId: 'does-not-exist' }, fakeJobContext());
        expect(result).toMatchObject({ embedded: false, reason: 'missing' });
    });

    test('a malformed payload does not retry forever', async () => {
        const result = await embedWinHandler({ nope: true }, fakeJobContext());
        expect(result).toMatchObject({ embedded: false, reason: 'bad_payload' });
    });

    test('a downgraded win that still has a point gets it removed on the next run', async () => {
        const userId = user('cleanup');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });
        await embedWinHandler({ winId: win.id }, fakeJobContext());
        expect(await qdrantPointsForUser(userId)).toHaveLength(1);

        // Bypass updateWin so the point is deliberately left orphaned.
        await prisma.win.update({
            where: { id: win.id },
            data: { sensitivity: WinSensitivity.internal_only },
        });

        const result = await embedWinHandler({ winId: win.id }, fakeJobContext());
        expect(result).toMatchObject({ embedded: false, reason: 'not_embeddable' });
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.qdrantPointId).toBeNull();
        expect(stored.embedded).toBe(false);
    });
});
