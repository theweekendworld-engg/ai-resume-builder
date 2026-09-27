/**
 * `link_analysis` is charged for job analyses only (audit 2026-09-27, §K),
 * against the local Postgres. A note, an article or an "other" link used to
 * burn one of Free's three analyses while the run page said nothing was
 * charged.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { setScoutKind } from '@/lib/scout/pipeline';
import { FREE_REFRESH_DAYS, METER_KEY, readMeter, refreshCharge } from '@/lib/scout/metering';
import { __testing, refreshScoutRun, startScoutRun } from '@/services/scout';

const USER = `itest-meter-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function used(): Promise<number> {
    const rows = await prisma.usageQuota.findMany({ where: { userId: USER, action: 'link_analysis' }, select: { used: true } });
    return rows.reduce((sum, row) => sum + row.used, 0);
}

beforeAll(() => {
    // No real analysis: the stages are what classify would drive; the test
    // plays classify by calling setScoutKind directly.
    __testing.setStagesRunner(async () => undefined);
});

afterAll(async () => {
    __testing.setStagesRunner(null);
    await prisma.agentRun.deleteMany({ where: { userId: USER } });
    await prisma.usageQuota.deleteMany({ where: { userId: USER } });
    await prisma.funnelEvent.deleteMany({ where: { userId: USER } });
});

describe('link_analysis is charged at value', () => {
    test('a work note gets its unit back at classify, exactly once', async () => {
        const before = await used();
        const started = await startScoutRun({
            userId: USER,
            input: { text: 'Shipped the webhook retry queue today; failed deliveries now back off instead of dropping.', source: 'dashboard' },
        });
        if (!started.success) throw new Error(started.error);
        expect(await used()).toBe(before + 1);

        await setScoutKind(started.data.run.id, 'work_note');
        expect(await used()).toBe(before);

        // A replayed classify step must not mint quota.
        await setScoutKind(started.data.run.id, 'work_note');
        expect(await used()).toBe(before);
        const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: started.data.run.id } });
        expect(readMeter(run.result)).toMatchObject({ charged: true, refunded: true });
    });

    test.each(['knowledge', 'company_signal', 'other'] as const)('a %s run is free', async (kind) => {
        const before = await used();
        const started = await startScoutRun({
            userId: USER,
            input: { text: `A post about something (${kind}) that is long enough to analyse, ${Math.random()}`, source: 'dashboard' },
        });
        if (!started.success) throw new Error(started.error);
        await setScoutKind(started.data.run.id, kind);
        expect(await used()).toBe(before);
    });

    test('a job run keeps its unit, and sharing it again is free', async () => {
        const before = await used();
        const url = `https://www.linkedin.com/jobs/view/${Math.floor(4_000_000_000 + Math.random() * 99_999_999)}/`;
        const first = await startScoutRun({ userId: USER, input: { url, source: 'dashboard' } });
        if (!first.success) throw new Error(first.error);
        await setScoutKind(first.data.run.id, 'job_posting');
        expect(await used()).toBe(before + 1);

        const again = await startScoutRun({ userId: USER, input: { url, source: 'telegram' } });
        if (!again.success) throw new Error(again.error);
        expect(again.data.created).toBe(false);
        expect(await used()).toBe(before + 1);
    });

    test('refreshing a job is free within 7 days and charges once after', async () => {
        const url = `https://www.linkedin.com/jobs/view/${Math.floor(4_100_000_000 + Math.random() * 99_999_999)}/`;
        const started = await startScoutRun({ userId: USER, input: { url, source: 'dashboard' } });
        if (!started.success) throw new Error(started.error);
        const id = started.data.run.id;
        await setScoutKind(id, 'job_posting');
        await prisma.agentRun.update({ where: { id }, data: { status: 'succeeded' } });

        const before = await used();
        expect((await refreshScoutRun(USER, id)).success).toBe(true);
        expect(await used()).toBe(before);

        // Age the receipt past the free window.
        await prisma.agentRun.update({ where: { id }, data: { status: 'succeeded' } });
        const old = new Date(Date.now() - (FREE_REFRESH_DAYS + 1) * 86_400_000).toISOString();
        await prisma.$executeRaw`
            UPDATE "AgentRun" SET "result" = jsonb_set("result", ARRAY[${METER_KEY}::text, 'chargedAt'], to_jsonb(${old}::text))
            WHERE "id" = ${id}
        `;
        expect((await refreshScoutRun(USER, id)).success).toBe(true);
        expect(await used()).toBe(before + 1);

        // The receipt survives the refresh's section invalidation.
        const run = await prisma.agentRun.findUniqueOrThrow({ where: { id } });
        expect(readMeter(run.result)?.charged).toBe(true);
    });
});

describe('refreshCharge (pure)', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const receipt = (daysAgo: number) => ({
        [METER_KEY]: { charged: true, refunded: false, chargedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() },
    });

    test('non-job kinds never pay to refresh', () => {
        for (const kind of ['work_note', 'knowledge', 'company_signal', 'other', null]) {
            expect(refreshCharge({ kind, result: receipt(30), createdAt: now }, now)).toBe(false);
        }
    });

    test('a job pays only once the last charge is older than the free window', () => {
        expect(refreshCharge({ kind: 'job_posting', result: receipt(2), createdAt: now }, now)).toBe(false);
        expect(refreshCharge({ kind: 'hiring_post', result: receipt(8), createdAt: now }, now)).toBe(true);
    });

    test('a run from before receipts falls back to its creation time', () => {
        expect(refreshCharge({ kind: 'job_posting', result: {}, createdAt: new Date(now.getTime() - 86_400_000) }, now)).toBe(false);
        expect(refreshCharge({ kind: 'job_posting', result: {}, createdAt: new Date(now.getTime() - 10 * 86_400_000) }, now)).toBe(true);
    });
});
