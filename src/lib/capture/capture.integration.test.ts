/**
 * Capture against a live Postgres.
 *
 * These verify the claims the pure tests cannot: that
 * `@@unique([sourceId, externalId])` really does make a re-sync a no-op, that
 * the signal claim really does stop two overlapping runs paying twice, and that
 * disconnecting deletes the cache without touching the record.
 *
 * Requires the local Docker Postgres. `.env.test` pins DATABASE_URL to it.
 * Isolation: every test scopes its rows to a unique userId and deletes exactly
 * what it created. Never assume an empty database.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { CaptureRunStatus, CaptureSourceKind, CaptureSourceStatus, WinSource, WinStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { createStubDrafter } from './eval/stubDrafter';
import { runCaptureSync, deleteCachedSignals, nextSourceHealth, partitionByNoise, windowStartFor } from './sync';
import { claimCandidate, draftCapFor, rankCandidates, runDrafting, selectDigestDrafts } from './draftRun';
import { createGithubAdapter } from './github/adapter';
import { EMPTY_SOURCE_CONFIG, type CaptureAdapter, type PullResult, type RawSignal } from './types';
import { GITHUB_CORPUS, corpusById } from '@/__fixtures__/github';
import { BACKFILL_DRAFT_CAP, MODEL_CALLS_PER_RUN } from './caps';

const RUN = `capitest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function userId(name: string): string {
    const id = `${RUN}:${name}`;
    users.push(id);
    return id;
}

async function cleanup(): Promise<void> {
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

/** The pure half of the real GitHub adapter, with a scripted `pull`. */
function fixtureAdapter(signals: RawSignal[], overrides: Partial<PullResult> = {}): CaptureAdapter {
    const base = createGithubAdapter({
        createApi: () => {
            throw new Error('not used');
        },
    });
    return {
        ...base,
        pull: async () => ({
            signals,
            nextCursor: overrides.nextCursor ?? new Date('2026-07-31T12:00:00.000Z').toISOString(),
            partial: overrides.partial ?? false,
            requestsUsed: overrides.requestsUsed ?? 3,
            warnings: overrides.warnings ?? [],
        }),
    };
}

async function makeSource(id: string, config = { includedRepos: ['acme/api', 'acme/sdk-js'] }) {
    return prisma.captureSource.create({
        data: {
            userId: id,
            kind: CaptureSourceKind.github,
            status: CaptureSourceStatus.active,
            externalAccountId: 'maya-dev',
            scopes: ['repo'],
            config: { ...EMPTY_SOURCE_CONFIG, ...config },
            consentGrantedAt: new Date(),
            consentCopyVersion: 'github-2026-08-01',
        },
    });
}

/** A handful of corpus signals that all pass the noise layers. */
function goodSignals(): RawSignal[] {
    return [
        corpusById('q-checkout-latency').signal,
        corpusById('q-index-p99').signal,
        corpusById('u-multi-region').signal,
        corpusById('u-audit-log').signal,
    ];
}

beforeAll(() => {
    structuredTesting.setObjectRunner(createStubDrafter({ mode: 'honest' }));
    structuredTesting.setUsageLogger(async () => {});
});

afterEach(cleanup);
afterAll(() => {
    structuredTesting.reset();
});

// ═══════════════════════════════════════════════════ sync idempotency

describe('runCaptureSync', () => {
    test('stores signals, records a run, and advances the cursor', async () => {
        const id = userId('sync-basic');
        const source = await makeSource(id);

        const summary = await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter(goodSignals()),
        });

        expect(summary?.status).toBe(CaptureRunStatus.success);
        expect(summary?.stored).toBe(4);

        const stored = await prisma.captureSignal.count({ where: { sourceId: source.id } });
        expect(stored).toBe(4);

        const after = await prisma.captureSource.findUniqueOrThrow({ where: { id: source.id } });
        expect(after.cursor).toBe('2026-07-31T12:00:00.000Z');
        expect(after.lastSuccessAt).not.toBeNull();
        expect(after.errorCount).toBe(0);
    });

    test('§12 — re-running the initial sync creates ZERO duplicate signals', async () => {
        const id = userId('sync-idempotent');
        const source = await makeSource(id);
        const adapter = fixtureAdapter(goodSignals());

        const first = await runCaptureSync({ sourceId: source.id, trigger: 'initial', backfillDays: 90, adapter });
        const second = await runCaptureSync({ sourceId: source.id, trigger: 'initial', backfillDays: 90, adapter });

        expect(first?.stored).toBe(4);
        expect(second?.stored).toBe(0); // every row collided with the unique constraint

        expect(await prisma.captureSignal.count({ where: { sourceId: source.id } })).toBe(4);
    });

    test('bot signals are dropped before storage; user-config noise is stored and flagged', async () => {
        const id = userId('sync-noise');
        const source = await makeSource(id, { includedRepos: ['acme/api'] });

        const summary = await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter([
                corpusById('bot-dependabot-lodash').signal,
                corpusById('rev-lgtm').signal,
                corpusById('q-checkout-latency').signal,
            ]),
        });

        expect(summary?.noise).toBe(2);

        const rows = await prisma.captureSignal.findMany({ where: { sourceId: source.id } });
        // The bot row does not exist at all; the LGTM review exists, flagged.
        expect(rows).toHaveLength(2);
        const flagged = rows.filter((row) => row.isNoise);
        expect(flagged).toHaveLength(1);
        expect(flagged[0].noiseRule).toBe('review_not_substantive');
        expect(flagged[0].processedAt).not.toBeNull();
    });

    test('a partial pull marks the run degraded but still persists everything it got', async () => {
        const id = userId('sync-partial');
        const source = await makeSource(id);

        const summary = await runCaptureSync({
            sourceId: source.id,
            trigger: 'scheduled',
            backfillDays: 90,
            adapter: fixtureAdapter(goodSignals(), {
                partial: true,
                nextCursor: '2026-07-20T00:00:00.000Z',
                warnings: ['github rate limit (status 403)'],
            }),
        });

        expect(summary?.status).toBe(CaptureRunStatus.degraded);
        expect(summary?.stored).toBe(4);

        const after = await prisma.captureSource.findUniqueOrThrow({ where: { id: source.id } });
        // Resumable: the cursor sits at the watermark, not at "now".
        expect(after.cursor).toBe('2026-07-20T00:00:00.000Z');
        expect(after.status).toBe(CaptureSourceStatus.active);
        expect(after.errorCount).toBe(0);
    });

    test('a throwing adapter fails the run, increments errorCount, and never throws out', async () => {
        const id = userId('sync-failure');
        const source = await makeSource(id);
        const broken: CaptureAdapter = {
            ...fixtureAdapter([]),
            pull: async () => {
                throw new Error('token revoked at GitHub');
            },
        };

        const summary = await runCaptureSync({
            sourceId: source.id,
            trigger: 'scheduled',
            backfillDays: 90,
            adapter: broken,
        });

        expect(summary?.status).toBe(CaptureRunStatus.failed);
        const after = await prisma.captureSource.findUniqueOrThrow({ where: { id: source.id } });
        expect(after.errorCount).toBe(1);
        expect(after.status).toBe(CaptureSourceStatus.error);
        expect(after.lastError).toContain('token revoked');
    });

    test('a source with no repos selected refuses to sync and says why (§7.3)', async () => {
        const id = userId('sync-no-repos');
        const source = await makeSource(id, { includedRepos: [] });

        const summary = await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter(goodSignals()),
        });

        expect(summary).toBeNull();
        const after = await prisma.captureSource.findUniqueOrThrow({ where: { id: source.id } });
        expect(after.lastError).toBe('No repositories selected');
        expect(await prisma.captureSignal.count({ where: { sourceId: source.id } })).toBe(0);
    });

    test('§11 — two users pulling the same repo do not contaminate each other', async () => {
        const one = userId('sync-user-a');
        const two = userId('sync-user-b');
        const sourceA = await makeSource(one);
        const sourceB = await makeSource(two);
        const adapter = fixtureAdapter(goodSignals());

        await runCaptureSync({ sourceId: sourceA.id, trigger: 'initial', backfillDays: 90, adapter });
        await runCaptureSync({ sourceId: sourceB.id, trigger: 'initial', backfillDays: 90, adapter });

        // The same externalIds exist twice — once per source — because the unique
        // constraint is (sourceId, externalId), not externalId alone.
        expect(await prisma.captureSignal.count({ where: { userId: one } })).toBe(4);
        expect(await prisma.captureSignal.count({ where: { userId: two } })).toBe(4);
        const rowsA = await prisma.captureSignal.findMany({ where: { userId: one }, select: { sourceId: true } });
        expect(rowsA.every((row) => row.sourceId === sourceA.id)).toBe(true);
    });

    test('a paused source is skipped on a schedule but honours a manual sync', async () => {
        const id = userId('sync-paused');
        const source = await makeSource(id);
        await prisma.captureSource.update({
            where: { id: source.id },
            data: { status: CaptureSourceStatus.paused },
        });
        const adapter = fixtureAdapter(goodSignals());

        expect(await runCaptureSync({ sourceId: source.id, trigger: 'scheduled', backfillDays: 90, adapter })).toBeNull();
        const manual = await runCaptureSync({ sourceId: source.id, trigger: 'manual', backfillDays: 90, adapter });
        expect(manual?.stored).toBe(4);
        // A manual sync of a paused source does not silently un-pause it.
        const after = await prisma.captureSource.findUniqueOrThrow({ where: { id: source.id } });
        expect(after.status).toBe(CaptureSourceStatus.paused);
    });
});

// ═══════════════════════════════════════════════════════ drafting

describe('runDrafting', () => {
    async function seed(name: string, signals: RawSignal[] = goodSignals()) {
        const id = userId(name);
        const source = await makeSource(id);
        await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter(signals),
        });
        return { id, source };
    }

    test('creates one Win per candidate, binds the signal, and marks it processed', async () => {
        const { id, source } = await seed('draft-basic');

        const summary = await runDrafting({ userId: id, sourceId: source.id, runId: null, trigger: 'initial' });

        expect(summary.drafted).toBeGreaterThan(0);
        const wins = await prisma.win.findMany({ where: { userId: id } });
        expect(wins).toHaveLength(summary.drafted);
        expect(wins.every((win) => win.source === WinSource.github)).toBe(true);
        expect(wins.every((win) => win.status === WinStatus.draft)).toBe(true);
        expect(wins.every((win) => win.signalId !== null)).toBe(true);

        const signals = await prisma.captureSignal.findMany({ where: { sourceId: source.id } });
        expect(signals.every((signal) => signal.processedAt !== null)).toBe(true);
        expect(signals.filter((signal) => signal.winId !== null).length).toBe(summary.drafted);
    });

    test('§12 — re-running drafting creates ZERO duplicate Wins', async () => {
        const { id, source } = await seed('draft-idempotent');

        const first = await runDrafting({ userId: id, sourceId: source.id, runId: null, trigger: 'initial' });
        const second = await runDrafting({ userId: id, sourceId: source.id, runId: null, trigger: 'initial' });

        expect(first.drafted).toBeGreaterThan(0);
        expect(second.drafted).toBe(0);
        expect(second.candidates).toBe(0);
        expect(await prisma.win.count({ where: { userId: id } })).toBe(first.drafted);
    });

    test('a claimed candidate cannot be claimed twice — the overlapping-retry guard', async () => {
        const { source } = await seed('draft-claim');
        const rows = await prisma.captureSignal.findMany({
            where: { sourceId: source.id, isNoise: false, processedAt: null },
        });
        const adapter = fixtureAdapter([]);
        const ranked = rankCandidates(adapter, rows, null);
        expect(ranked.length).toBeGreaterThan(0);

        const now = new Date();
        expect(await claimCandidate(ranked[0], now)).toBe(true);
        expect(await claimCandidate(ranked[0], now)).toBe(false);
    });

    test('the Win carries a period when several PRs are one effort (§4.1)', async () => {
        const grouped = GITHUB_CORPUS.filter((entry) => entry.groupWith === 'payments-migration').map(
            (entry) => entry.signal,
        );
        const { id, source } = await seed('draft-grouped', grouped);

        const summary = await runDrafting({ userId: id, sourceId: source.id, runId: null, trigger: 'initial' });

        expect(summary.candidates).toBe(1);
        expect(summary.drafted).toBe(1);
        const win = await prisma.win.findFirstOrThrow({ where: { userId: id } });
        expect(win.periodEnd).not.toBeNull();
        expect(win.periodEnd!.getTime()).toBeGreaterThan(win.occurredAt.getTime());

        // Every member signal is bound to the one Win.
        const bound = await prisma.captureSignal.count({ where: { sourceId: source.id, winId: win.id } });
        expect(bound).toBe(6);
    });

    test('§6.5 — the draft cap is honoured and the run is marked degraded', async () => {
        const { id, source } = await seed('draft-cap');

        const summary = await runDrafting({
            userId: id,
            sourceId: source.id,
            runId: null,
            trigger: 'initial',
            maxDrafts: 1,
        });

        expect(summary.drafted).toBe(1);
        expect(summary.status).toBe(CaptureRunStatus.degraded);
        expect(await prisma.win.count({ where: { userId: id } })).toBe(1);
    });

    test('updates the CaptureRun counters when given a run id', async () => {
        const id = userId('draft-run-counters');
        const source = await makeSource(id);
        const sync = await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter(goodSignals()),
        });

        const summary = await runDrafting({
            userId: id,
            sourceId: source.id,
            runId: sync!.runId,
            trigger: 'initial',
        });

        const run = await prisma.captureRun.findUniqueOrThrow({ where: { id: sync!.runId } });
        expect(run.winsDrafted).toBe(summary.drafted);
        expect(run.candidates).toBe(summary.candidates);
        expect(run.finishedAt).not.toBeNull();
    });
});

// ═══════════════════════════════════════════════════════ disconnect

describe('disconnect (§7.2)', () => {
    test('deletes the cached signals and leaves the Wins alone', async () => {
        const id = userId('disconnect');
        const source = await makeSource(id);
        await runCaptureSync({
            sourceId: source.id,
            trigger: 'initial',
            backfillDays: 90,
            adapter: fixtureAdapter(goodSignals()),
        });
        const drafted = await runDrafting({ userId: id, sourceId: source.id, runId: null, trigger: 'initial' });
        expect(drafted.drafted).toBeGreaterThan(0);

        const removed = await deleteCachedSignals(source.id);

        expect(removed).toBeGreaterThan(0);
        expect(await prisma.captureSignal.count({ where: { sourceId: source.id } })).toBe(0);
        // The record survives. Never delete user records (CLAUDE.md invariants).
        expect(await prisma.win.count({ where: { userId: id } })).toBe(drafted.drafted);
    });
});

// ═══════════════════════════════════════════════════════ pure helpers

describe('pure helpers that the DB tests lean on', () => {
    test('the window falls back to the entitlement days when there is no cursor', () => {
        const now = new Date('2026-07-31T00:00:00Z');
        const withCursor = windowStartFor({ cursor: '2026-07-01T00:00:00.000Z' } as never, 90, now);
        expect(withCursor.toISOString()).toBe('2026-07-01T00:00:00.000Z');

        const withoutCursor = windowStartFor({ cursor: null } as never, 30, now);
        expect(withoutCursor.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });

    test('health: five consecutive failures auto-pause, any success resets (§7.3)', () => {
        expect(nextSourceHealth({ errorCount: 0, failed: true })).toEqual({
            status: CaptureSourceStatus.error,
            errorCount: 1,
        });
        expect(nextSourceHealth({ errorCount: 4, failed: true })).toEqual({
            status: CaptureSourceStatus.paused,
            errorCount: 5,
        });
        expect(nextSourceHealth({ errorCount: 4, failed: false })).toEqual({
            status: CaptureSourceStatus.active,
            errorCount: 0,
        });
    });

    test('partitioning separates dropped, flagged and kept', () => {
        const adapter = fixtureAdapter([]);
        const partitioned = partitionByNoise(
            adapter,
            [
                corpusById('bot-dependabot-lodash').signal,
                corpusById('rev-lgtm').signal,
                corpusById('q-checkout-latency').signal,
            ],
            EMPTY_SOURCE_CONFIG,
        );
        expect(partitioned.dropped).toBe(1);
        expect(partitioned.flagged).toHaveLength(1);
        expect(partitioned.keep).toHaveLength(1);
    });

    test('§6.5 caps: 40 on the initial backfill, model-call bound afterwards', () => {
        expect(draftCapFor('initial')).toBe(BACKFILL_DRAFT_CAP);
        expect(draftCapFor('scheduled')).toBe(MODEL_CALLS_PER_RUN);
    });

    test('the digest surfaces five and reports the overflow ("+7 more in your log")', () => {
        const drafts = Array.from({ length: 12 }, (_unused, index) => ({ confidence: index / 12 }));
        const { surfaced, overflow } = selectDigestDrafts(drafts);
        expect(surfaced).toHaveLength(5);
        expect(overflow).toBe(7);
        expect(surfaced[0].confidence).toBeGreaterThan(surfaced[4].confidence);
    });
});
