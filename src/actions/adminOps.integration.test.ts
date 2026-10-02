/**
 * Operator tools (launch plan wave 3), against the local Postgres.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { gateMeteredAction } from '@/lib/entitlements';
import { enforceUsageLimit } from '@/lib/usageTracker';
import { forgetSuspension, SuspendedError } from '@/lib/suspension';
import { renderOperatorDigest, summarizeLastDay } from '@/lib/jobs/handlers/operatorDigest';

const clerk = installClerkMock();
const admin = await import('./admin');
const { GET: health } = await import('@/app/api/health/route');

const RUN = `itest-ops-${Date.now()}`;
const ADMIN = `${RUN}-admin`;
const TARGET = `${RUN}-target`;
let originalAdmins: string | undefined;
let jobId = '';

beforeAll(async () => {
    originalAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = ADMIN;
    const job = await prisma.job.create({
        data: { kind: 'noop', payload: {}, status: 'dead', attempts: 5, lastError: 'boom', dedupeKey: `${RUN}-dead`, finishedAt: new Date() },
    });
    jobId = job.id;
});

afterAll(async () => {
    process.env.ADMIN_USER_IDS = originalAdmins;
    await prisma.userSuspension.deleteMany({ where: { userId: TARGET } });
    await prisma.adminAction.deleteMany({ where: { adminUserId: ADMIN } });
    await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: RUN } } });
    clerk.signOut();
});

describe('suspension', () => {
    test('a non-admin cannot suspend anyone', async () => {
        clerk.signIn(TARGET);
        await expect(admin.suspendUser({ target: ADMIN, reason: 'nope' })).rejects.toThrow(/Admin/);
    });

    test('a suspended user cannot spend: no model call, no metered action', async () => {
        clerk.signIn(ADMIN);
        const result = await admin.suspendUser({ target: TARGET, reason: 'abuse test' });
        expect(result.success).toBe(true);
        forgetSuspension(TARGET);
        await expect(enforceUsageLimit(TARGET)).rejects.toBeInstanceOf(SuspendedError);
        await expect(gateMeteredAction(TARGET, 'link_analysis')).rejects.toBeInstanceOf(SuspendedError);
    });

    test('unsuspending restores, and both are in the audit log', async () => {
        clerk.signIn(ADMIN);
        await admin.unsuspendUser({ target: TARGET });
        forgetSuspension(TARGET);
        await expect(enforceUsageLimit(TARGET)).resolves.toBeUndefined();
        const actions = await admin.listAdminActions({ target: TARGET });
        expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['suspend_user', 'unsuspend_user']));
    });

    test('an admin cannot suspend themselves', async () => {
        clerk.signIn(ADMIN);
        expect((await admin.suspendUser({ target: ADMIN, reason: 'oops' })).success).toBe(false);
    });
});

describe('dead jobs', () => {
    test('retry requeues a dead job, once', async () => {
        clerk.signIn(ADMIN);
        expect((await admin.resolveDeadJob({ jobId, op: 'retry' })).success).toBe(true);
        const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        expect(job.status).toBe('pending');
        expect(job.attempts).toBe(0);
        expect((await admin.resolveDeadJob({ jobId, op: 'retry' })).success).toBe(false);
    });
});

describe('operator digest', () => {
    test('summarizes the last day and renders problems first', async () => {
        const summary = await summarizeLastDay();
        expect(summary.modelCalls.total).toBeGreaterThanOrEqual(0);
        const text = renderOperatorDigest(
            { ...summary, deadJobs: [{ kind: 'embed_win', count: 2 }], configErrors: ['email'] },
            'https://www.patronus.cv',
        );
        expect(text).toContain('⚠️ 2 to look at');
        expect(text).toContain('embed_win ×2');
        expect(text).toContain('https://www.patronus.cv/admin/ops');
        const quiet = renderOperatorDigest({ ...summary, deadJobs: [], configErrors: [], runs: { total: 0, failed: 0 }, modelCalls: { total: 0, failed: 0 } }, 'https://x');
        expect(quiet).toContain('nothing broke');
    });
});

describe('health', () => {
    test('says the database answers, and nothing else', async () => {
        const res = await health();
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ ok: true, db: 'up' });
        expect(Object.keys(body).sort()).toEqual(['db', 'ms', 'ok']);
    });
});
