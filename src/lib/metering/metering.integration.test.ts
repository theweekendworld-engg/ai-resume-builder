/**
 * Metering at the point of value, against the local Postgres:
 *   - Month in Review charges once per month, never per view (three reloads
 *     used to exhaust Free), and a refusal leaves no receipt behind.
 *   - A unit taken for work that then fails to start is given back (packets
 *     did not refund a failed workflow start).
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { gateMeteredAction } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { chargeOncePerMonth, receiptAction } from './monthlyReceipt';
import { withRefundOnFailure } from './refundOnFailure';

const USER = `itest-metering-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const env = process.env as Record<string, string | undefined>;
const originalEnforce = env.ENTITLEMENTS_ENFORCE;

async function used(action: string): Promise<number> {
    const rows = await prisma.usageQuota.findMany({ where: { userId: USER, action }, select: { used: true } });
    return rows.reduce((sum, row) => sum + row.used, 0);
}

afterEach(() => {
    env.ENTITLEMENTS_ENFORCE = originalEnforce;
});
afterAll(async () => {
    await prisma.usageQuota.deleteMany({ where: { userId: USER } });
    await prisma.funnelEvent.deleteMany({ where: { userId: USER } });
});

describe('month in review: once per month-document', () => {
    test('repeat views of the same month are free', async () => {
        expect((await chargeOncePerMonth(USER, '2026-07')).ok).toBe(true);
        expect((await chargeOncePerMonth(USER, '2026-07')).ok).toBe(true);
        expect((await chargeOncePerMonth(USER, '2026-07')).ok).toBe(true);
        expect(await used('month_in_review')).toBe(1);
        expect(await prisma.usageQuota.count({ where: { userId: USER, action: receiptAction('2026-07') } })).toBe(1);
    });

    test('a different month is a new charge', async () => {
        await chargeOncePerMonth(USER, '2026-06');
        expect(await used('month_in_review')).toBe(2);
    });

    test('concurrent first views charge once', async () => {
        await Promise.all([1, 2, 3, 4].map(() => chargeOncePerMonth(USER, '2026-05')));
        expect(await used('month_in_review')).toBe(3);
    });

    test('an exhausted trial is refused with a message and leaves no receipt', async () => {
        env.ENTITLEMENTS_ENFORCE = 'true';
        const outcome = await chargeOncePerMonth(USER, '2026-04');
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.message.length).toBeGreaterThan(10);
        expect(await prisma.usageQuota.count({ where: { userId: USER, action: receiptAction('2026-04') } })).toBe(0);
    });
});

describe('withRefundOnFailure', () => {
    test('a failed start gives the unit back and rethrows', async () => {
        await gateMeteredAction(USER, 'review_packet');
        expect(await used('review_packet')).toBe(1);
        await expect(
            withRefundOnFailure({ userId: USER, action: 'review_packet', reason: 'test' }, async () => {
                throw new Error('WorkflowAPIError: no runner');
            }),
        ).rejects.toThrow('no runner');
        expect(await used('review_packet')).toBe(0);
    });

    test('a successful start keeps the unit', async () => {
        await gateMeteredAction(USER, 'review_packet');
        const value = await withRefundOnFailure({ userId: USER, action: 'review_packet', reason: 'test' }, async () => 'started');
        expect(value).toBe('started');
        expect(await used('review_packet')).toBe(1);
    });
});
