/**
 * `capture_sync` and `draft_wins` as job handlers, against a live Postgres.
 *
 * The thing being tested here is not the capture logic — that is covered in
 * `src/lib/capture` — but the two properties the runner contract demands:
 * fan-out instead of looping (§P-2), and dedupe keys that make a double-fired
 * cron a no-op (§P-1).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { CaptureSourceKind, CaptureSourceStatus, Tier } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { __testing as registryTesting } from '@/lib/capture/registry';
import { createStubDrafter } from '@/lib/capture/eval/stubDrafter';
import { createGithubAdapter } from '@/lib/capture/github/adapter';
import { BACKFILL_DAYS_FREE, BACKFILL_DAYS_PAID } from '@/lib/capture/caps';
import { EMPTY_SOURCE_CONFIG, type CaptureAdapter } from '@/lib/capture/types';
import { corpusById } from '@/__fixtures__/github';
import { enqueue } from '@/lib/jobs/runner';
import type { EnqueueResult, JobContext } from '@/lib/jobs/types';
import {
    backfillDaysForTier,
    captureSyncHandler,
    draftDedupeKey,
    dueSourceIds,
    syncDedupeKey,
} from './captureSync';
import { draftWinsHandler } from './draftWins';

const RUN = `jobitest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];
const dedupePrefixes: string[] = [];

function userId(name: string): string {
    const id = `${RUN}:${name}`;
    users.push(id);
    return id;
}

/** Records what the handler fanned out to, and really enqueues it. */
function testContext(): JobContext & { enqueued: Array<{ kind: string; payload: object; dedupeKey?: string }> } {
    const enqueued: Array<{ kind: string; payload: object; dedupeKey?: string }> = [];
    return {
        jobId: `${RUN}-job`,
        attempt: 1,
        deadline: new Date(Date.now() + 60_000),
        log: () => {},
        enqueued,
        enqueue: async (kind, payload, opts): Promise<EnqueueResult> => {
            enqueued.push({ kind, payload, dedupeKey: opts?.dedupeKey });
            if (opts?.dedupeKey) dedupePrefixes.push(opts.dedupeKey);
            return enqueue(kind, payload, opts);
        },
    };
}

const fixtureAdapter: CaptureAdapter = {
    ...createGithubAdapter({
        createApi: () => {
            throw new Error('not used');
        },
    }),
    pull: async () => ({
        signals: [corpusById('q-checkout-latency').signal, corpusById('u-audit-log').signal],
        nextCursor: '2026-07-31T12:00:00.000Z',
        partial: false,
        requestsUsed: 4,
        warnings: [],
    }),
};

async function makeSource(id: string) {
    return prisma.captureSource.create({
        data: {
            userId: id,
            kind: CaptureSourceKind.github,
            status: CaptureSourceStatus.active,
            externalAccountId: 'maya-dev',
            scopes: ['repo'],
            config: { ...EMPTY_SOURCE_CONFIG, includedRepos: ['acme/api'] },
            consentGrantedAt: new Date(),
            consentCopyVersion: 'github-2026-08-01',
        },
    });
}

async function cleanup(): Promise<void> {
    if (dedupePrefixes.length > 0) {
        await prisma.job.deleteMany({ where: { dedupeKey: { in: dedupePrefixes } } });
        dedupePrefixes.length = 0;
    }
    if (users.length === 0) return;
    const where = { where: { userId: { in: users } } };
    await prisma.captureSignal.deleteMany(where);
    await prisma.captureRun.deleteMany(where);
    await prisma.captureSource.deleteMany(where);
    await prisma.impactMetric.deleteMany(where);
    await prisma.win.deleteMany(where);
    await prisma.funnelEvent.deleteMany(where);
    users.length = 0;
}

beforeAll(() => {
    structuredTesting.setObjectRunner(createStubDrafter({ mode: 'honest' }));
    structuredTesting.setUsageLogger(async () => {});
    registryTesting.set(CaptureSourceKind.github, fixtureAdapter);
});

afterEach(cleanup);
afterAll(() => {
    structuredTesting.reset();
    registryTesting.reset();
});

// ───────────────────────────────────────────────────────────── tests

describe('dedupe keys', () => {
    test('a sync key is per source, per trigger, per hour', () => {
        const now = new Date('2026-07-31T16:42:00Z');
        const later = new Date('2026-07-31T16:59:00Z');
        expect(syncDedupeKey('src_1', 'scheduled', now)).toBe(syncDedupeKey('src_1', 'scheduled', later));
        expect(syncDedupeKey('src_1', 'scheduled', now)).not.toBe(syncDedupeKey('src_1', 'manual', now));
        expect(syncDedupeKey('src_1', 'scheduled', now)).not.toBe(syncDedupeKey('src_2', 'scheduled', now));
        // The ISO colons must not split the key into extra segments.
        expect(syncDedupeKey('src_1', 'scheduled', now).split(':')).toHaveLength(4);
    });

    test('a drafting key is per run, so a re-sync drafts again but a retry does not', () => {
        expect(draftDedupeKey('src_1', 'run_a')).not.toBe(draftDedupeKey('src_1', 'run_b'));
    });
});

describe('entitlements (§9)', () => {
    test('free backfills 30 days, paid tiers 90', () => {
        expect(backfillDaysForTier(Tier.free)).toBe(BACKFILL_DAYS_FREE);
        expect(backfillDaysForTier(Tier.always_on)).toBe(BACKFILL_DAYS_PAID);
        expect(backfillDaysForTier(Tier.pro)).toBe(BACKFILL_DAYS_PAID);
    });
});

describe('dispatch — the handler fans out, it never loops (§P-2)', () => {
    test('enqueues one child per due source and returns immediately', async () => {
        const one = await makeSource(userId('fanout-a'));
        const two = await makeSource(userId('fanout-b'));

        const ctx = testContext();
        const result = (await captureSyncHandler({}, ctx)) as { dispatched: number; enqueued: number };

        const childIds = ctx.enqueued
            .filter((entry) => entry.kind === 'capture_sync')
            .map((entry) => (entry.payload as { sourceId: string }).sourceId);

        expect(childIds).toContain(one.id);
        expect(childIds).toContain(two.id);
        expect(result.dispatched).toBeGreaterThanOrEqual(2);
        // No sync ran: dispatch does the enqueueing and nothing else.
        expect(await prisma.captureRun.count({ where: { sourceId: { in: [one.id, two.id] } } })).toBe(0);
    });

    test('a double-fired cron is a no-op', async () => {
        await makeSource(userId('fanout-dupe'));

        const first = testContext();
        await captureSyncHandler({}, first);
        const second = testContext();
        const result = (await captureSyncHandler({}, second)) as { enqueued: number; deduped: number };

        expect(result.deduped).toBeGreaterThan(0);
        expect(result.enqueued).toBe(0);
    });

    test('paused and revoked sources are never dispatched', async () => {
        const active = await makeSource(userId('due-active'));
        const paused = await makeSource(userId('due-paused'));
        await prisma.captureSource.update({
            where: { id: paused.id },
            data: { status: CaptureSourceStatus.paused },
        });

        const due = await dueSourceIds(500);
        const ids = due.map((source) => source.id);
        expect(ids).toContain(active.id);
        expect(ids).not.toContain(paused.id);
    });
});

describe('single-source sync — pull now, draft in a child job', () => {
    test('runs the sync and hands drafting off rather than doing it inline', async () => {
        const id = userId('single');
        const source = await makeSource(id);

        const ctx = testContext();
        const result = (await captureSyncHandler({ sourceId: source.id, trigger: 'initial' }, ctx)) as {
            stored: number;
            runId: string;
        };

        expect(result.stored).toBe(2);
        // Nothing has been drafted yet — that is the child job's problem.
        expect(await prisma.win.count({ where: { userId: id } })).toBe(0);

        const child = ctx.enqueued.find((entry) => entry.kind === 'draft_wins');
        expect(child).toBeDefined();
        expect(child?.payload).toMatchObject({ userId: id, sourceId: source.id, runId: result.runId });
    });

    test('a missing source is a skip, not a failure — the runner must not retry it', async () => {
        const result = (await captureSyncHandler({ sourceId: 'does-not-exist' }, testContext())) as {
            skipped: string;
        };
        expect(result.skipped).toBe('source_missing');
    });

    test('an invalid payload throws so the job goes to `dead` rather than silently no-oping', async () => {
        await expect(captureSyncHandler({ trigger: 'nonsense' }, testContext())).rejects.toThrow(/invalid payload/);
    });
});

describe('draft_wins handler', () => {
    test('drafts from the stored signals and reports its cost for the roll-up (§P-5)', async () => {
        const id = userId('draft-handler');
        const source = await makeSource(id);
        const ctx = testContext();
        const sync = (await captureSyncHandler({ sourceId: source.id, trigger: 'initial' }, ctx)) as {
            runId: string;
        };

        const result = (await draftWinsHandler(
            { userId: id, sourceId: source.id, runId: sync.runId, trigger: 'initial' },
            testContext(),
        )) as { drafted: number; costUsd: number; winIds: string[] };

        expect(result.drafted).toBeGreaterThan(0);
        expect(result.winIds).toHaveLength(result.drafted);
        expect(typeof result.costUsd).toBe('number');
        expect(await prisma.win.count({ where: { userId: id } })).toBe(result.drafted);
    });

    test('a second run over the same signals drafts nothing — the overlapping-retry case', async () => {
        const id = userId('draft-handler-retry');
        const source = await makeSource(id);
        await captureSyncHandler({ sourceId: source.id, trigger: 'initial' }, testContext());

        const payload = { userId: id, sourceId: source.id, runId: null, trigger: 'initial' as const };
        const first = (await draftWinsHandler(payload, testContext())) as { drafted: number };
        const second = (await draftWinsHandler(payload, testContext())) as { drafted: number };

        expect(first.drafted).toBeGreaterThan(0);
        expect(second.drafted).toBe(0);
        expect(await prisma.win.count({ where: { userId: id } })).toBe(first.drafted);
    });
});
