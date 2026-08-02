/**
 * `getMonthInReview` — the read path for `/log/review/[yyyy-mm]`.
 *
 * The property this file exists to hold: what the page renders comes from the
 * `MonthlyReview` row, so the page and the email say the same thing — and a
 * month that was composed but never emailed renders in full, paragraph included.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { WinCategory, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { cleanupTestUser, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import {
    buildMonthInReview,
    markMonthInReviewSent,
    persistMonthInReview,
} from '@/services/monthInReview';

let currentUserId: string | null = null;
mock.module('@clerk/nextjs/server', () => ({
    auth: async () => ({ userId: currentUserId }),
}));

const { getMonthInReview } = await import('@/actions/monthInReview');

const JULY = { year: 2026, month: 7 };
const NOW = new Date('2026-08-01T09:00:00.000Z');

const users: string[] = [];

async function seedJuly(label: string, count = 4): Promise<string> {
    const userId = newTestUserId(label);
    users.push(userId);
    for (let index = 0; index < count; index += 1) {
        const win = await makeWin({
            userId,
            title: `Cut the ${index} ms path from 800ms to 180ms`,
            narrative: 'Rewrote the pricing lookup as a batched query.',
            category: index % 2 === 0 ? WinCategory.improved : WinCategory.shipped,
            occurredAt: new Date(Date.UTC(2026, 6, 5 + index)),
            source: WinSource.manual,
            employerId: null,
        });
        await prisma.win.update({
            where: { id: win.id },
            data: { status: WinStatus.confirmed, confirmedAt: new Date(Date.UTC(2026, 6, 5 + index)) },
        });
    }
    currentUserId = userId;
    return userId;
}

beforeEach(() => {
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setObjectRunner(async () => ({
        object: { paragraph: 'The pricing lookup work took the path from 800ms to 180ms.' },
        inputTokens: 10,
        outputTokens: 10,
    }));
});

afterEach(async () => {
    aiTesting.reset();
    currentUserId = null;
    while (users.length > 0) {
        const id = users.pop();
        if (!id) continue;
        await prisma.monthlyReview.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

describe('getMonthInReview', () => {
    test('refuses anything that is not a finished month', async () => {
        await seedJuly('guard');

        for (const bad of ['july', '2026-13', '20267', '']) {
            const result = await getMonthInReview(bad);
            expect(result.success).toBe(false);
            if (!result.success) expect(result.code).toBe('invalid_input');
        }

        // A month still in progress has no review; say so rather than render half of one.
        const future = await getMonthInReview('2099-01');
        expect(future.success).toBe(false);
        if (!future.success) expect(future.code).toBe('not_found');
    });

    test('is signed-in only', async () => {
        currentUserId = null;
        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('unauthenticated');
    });

    test('a composed-but-unsent month renders in full, paragraph included', async () => {
        const userId = await seedJuly('unsent');
        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        await persistMonthInReview(userId, review!);

        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.source).toBe('composed');
        expect(result.data.sentAt).toBeNull();
        expect(result.data.paragraph).toContain('800ms to 180ms');
        expect(result.data.headline).toBe('4 wins, 4 with hard numbers');
        expect(result.data.label).toBe('July 2026');
        expect(result.data.receipt).toContain('This review drew on 4 wins from July');
        expect(result.data.mixSentence.length).toBeGreaterThan(0);
        expect(result.data.mix.map((row) => row.category)).toContain('improved');
    });

    test('a sent month reads back as sent, with the timestamp', async () => {
        const userId = await seedJuly('sent');
        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        await persistMonthInReview(userId, review!);
        await markMonthInReviewSent(userId, '2026-07', NOW);

        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.source).toBe('sent');
        expect(result.data.sentAt?.toISOString()).toBe(NOW.toISOString());
        expect(result.data.paragraph).toContain('800ms to 180ms');
    });

    test('the row is the source of truth: editing a win later does not rewrite the document', async () => {
        const userId = await seedJuly('frozen');
        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        await persistMonthInReview(userId, review!);

        await prisma.win.updateMany({
            where: { userId },
            data: { title: 'Retitled long after the review went out' },
        });

        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.headline).toBe('4 wins, 4 with hard numbers');
        expect(result.data.paragraph).toContain('800ms to 180ms');
    });

    test('a month with no row renders every computed block and spends nothing', async () => {
        const userId = await seedJuly('legacy');
        let modelCalls = 0;
        aiTesting.setObjectRunner(async () => {
            modelCalls += 1;
            return { object: { paragraph: 'x' }, inputTokens: 0, outputTokens: 0 };
        });

        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.source).toBe('computed');
        // A paragraph rewritten on every page load is a document nobody can
        // screenshot, so it is absent rather than regenerated.
        expect(result.data.paragraph).toBeNull();
        expect(modelCalls).toBe(0);
        expect(result.data.headline).toBe('4 wins, 4 with hard numbers');
        expect(result.data.receipt).toContain('This review drew on 4 wins from July');
        expect(userId).toBeTruthy();
    });

    test('a month with no confirmed wins and no row is a 404, not an empty document', async () => {
        await seedJuly('gap');
        const result = await getMonthInReview('2026-05');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('not_found');
    });

    test('one user cannot read another users review', async () => {
        const owner = await seedJuly('owner');
        const review = await buildMonthInReview({ userId: owner, period: JULY, now: NOW });
        await persistMonthInReview(owner, review!);

        const intruder = newTestUserId('intruder');
        users.push(intruder);
        currentUserId = intruder;

        const result = await getMonthInReview('2026-07');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('not_found');
    });
});
