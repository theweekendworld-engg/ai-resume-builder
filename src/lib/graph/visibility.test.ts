/**
 * THESIS TEST 2 (PRD 08 §10, ADR-8, CLAUDE.md rule 3).
 *
 *   A Win with sensitivity='confidential' never appears in external retrieval.
 *
 * The assertions below are all on the QUERY FILTER — the SQL predicate and the
 * Qdrant predicate — and on the fact that the row/point is excluded when the
 * store is asked using them. A test that generated a resume and checked "it
 * didn't mention the confidential thing" would pass by luck; this one cannot.
 *
 * Note the third test in particular: it force-inserts a confidential point into
 * Qdrant and then asserts the external filter excludes it. That proves the
 * filter, not the absence of the point.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { WinSensitivity, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    EXTERNAL_BLOCKED_SENSITIVITIES,
    EXTERNAL_SAFE,
    EXTERNAL_SAFE_STATUSES,
    WIN_POINT_TYPE,
    externalRetrievalFilter,
    internalRetrievalFilter,
    isExternallyShareable,
    mayEmbed,
    qdrantExternalFilter,
} from '@/lib/graph/visibility';
import { confirmWin } from '@/services/winGraph';
import { embedWinHandler, __testing as embedTesting } from '@/lib/jobs/handlers/embedWin';
import {
    cleanupTestUser,
    fakeEmbedding,
    fakeJobContext,
    makeWin,
    newTestUserId,
    qdrantPointsForUser,
    qdrantScroll,
    qdrantUpsertRaw,
} from '@/services/winFixtures.test-utils';

const users: string[] = [];

function user(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

beforeAll(() => {
    embedTesting.setEmbedder(async (text: string) => fakeEmbedding(text));
});

afterAll(() => {
    embedTesting.reset();
});

afterEach(async () => {
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupTestUser(id);
    }
});

// ═══════════════════════════════════════════════════ the filter itself

describe('THESIS 2 — the filter, asserted directly', () => {
    test('the SQL filter pins sensitivity to shareable and status to confirmed', () => {
        const where = externalRetrievalFilter('user_42');
        expect(where).toEqual({
            userId: 'user_42',
            sensitivity: WinSensitivity.shareable,
            status: { in: [WinStatus.confirmed] },
        });
        expect(EXTERNAL_SAFE.sensitivity).toBe(WinSensitivity.shareable);
        expect(EXTERNAL_SAFE_STATUSES).toEqual([WinStatus.confirmed]);
    });

    test('the Qdrant filter carries the same three clauses', () => {
        expect(qdrantExternalFilter('user_42')).toEqual({
            must: [
                { key: 'userId', match: { value: 'user_42' } },
                { key: 'type', match: { value: WIN_POINT_TYPE } },
                { key: 'sensitivity', match: { value: WinSensitivity.shareable } },
            ],
        });
    });

    test('every non-shareable sensitivity is blocked, and the list is exhaustive', () => {
        const all = Object.values(WinSensitivity);
        const blocked = all.filter((value) => !isExternallyShareable(value));
        expect(blocked.sort()).toEqual([...EXTERNAL_BLOCKED_SENSITIVITIES].sort());
        expect(blocked).toContain(WinSensitivity.confidential);
        expect(blocked).toContain(WinSensitivity.internal_only);
    });

    test('mayEmbed is false for anything not confirmed+shareable', () => {
        expect(mayEmbed({ status: WinStatus.confirmed, sensitivity: WinSensitivity.shareable })).toBe(true);
        expect(mayEmbed({ status: WinStatus.confirmed, sensitivity: WinSensitivity.confidential })).toBe(false);
        expect(mayEmbed({ status: WinStatus.confirmed, sensitivity: WinSensitivity.internal_only })).toBe(false);
        expect(mayEmbed({ status: WinStatus.draft, sensitivity: WinSensitivity.shareable })).toBe(false);
    });

    test('the internal filter admits internal_only but still refuses confidential', () => {
        const where = internalRetrievalFilter('user_42');
        expect(where.sensitivity).toEqual({
            in: [WinSensitivity.shareable, WinSensitivity.internal_only],
        });
    });
});

// ═══════════════════════════════════════════════════ the filter, applied

describe('THESIS 2 — the filter applied to the real stores', () => {
    test('a confidential Win is excluded by the SQL filter, and it is still on disk', async () => {
        const userId = user('sql');
        const shareable = await makeWin({ userId, title: 'Public: cut latency' });
        const confidential = await makeWin({
            userId,
            title: 'Confidential: the security incident',
            sensitivity: WinSensitivity.confidential,
        });
        const internal = await makeWin({
            userId,
            title: 'Internal: headcount plan',
            sensitivity: WinSensitivity.internal_only,
        });

        await confirmWin({ userId, winId: shareable.id });
        await confirmWin({ userId, winId: confidential.id });
        await confirmWin({ userId, winId: internal.id });

        const external = await prisma.win.findMany({
            where: externalRetrievalFilter(userId),
            select: { id: true },
        });
        expect(external.map((row) => row.id)).toEqual([shareable.id]);

        // Excluded from retrieval, never deleted.
        expect(await prisma.win.count({ where: { userId } })).toBe(3);
    });

    test('a confidential Win is never written to Qdrant in the first place', async () => {
        const userId = user('never-embedded');
        const confidential = await makeWin({
            userId,
            sensitivity: WinSensitivity.confidential,
            title: 'Unreleased product launch date slipped',
        });

        await confirmWin({ userId, winId: confidential.id });
        // Even if the job somehow runs, the handler refuses.
        const outcome = await embedWinHandler({ winId: confidential.id }, fakeJobContext());
        expect(outcome).toMatchObject({ embedded: false });

        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
        const stored = await prisma.win.findUniqueOrThrow({ where: { id: confidential.id } });
        expect(stored.embedded).toBe(false);
        expect(stored.qdrantPointId).toBeNull();
    });

    test('the Qdrant external filter excludes a confidential point that IS in the collection', async () => {
        const userId = user('qdrant-filter');

        const shareable = await makeWin({ userId, title: 'Shareable win' });
        await confirmWin({ userId, winId: shareable.id });
        await embedWinHandler({ winId: shareable.id }, fakeJobContext());

        // Plant a confidential point directly. If the filter were a prompt
        // instruction (or absent) this point would come back.
        await qdrantUpsertRaw({
            id: '00000000-0000-4000-8000-0000000000c1',
            vector: fakeEmbedding('planted confidential point'),
            payload: {
                userId,
                type: WIN_POINT_TYPE,
                sourceId: 'planted-confidential',
                sensitivity: WinSensitivity.confidential,
                title: 'Planted confidential win',
                content: 'Planted confidential win',
            },
        });

        const everything = await qdrantPointsForUser(userId);
        expect(everything).toHaveLength(2);

        const externalOnly = await qdrantScroll(qdrantExternalFilter(userId));
        expect(externalOnly).toHaveLength(1);
        expect(externalOnly[0].payload.sourceId).toBe(shareable.id);
        expect(externalOnly[0].payload.sensitivity).toBe(WinSensitivity.shareable);
    });
});
