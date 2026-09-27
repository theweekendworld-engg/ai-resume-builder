/**
 * Work Log correctness (audit 2026-09-27, §G/§H), against the local Postgres.
 *
 * Each test pins one thing a user saw go wrong:
 *   - capturing a win called the model twice and charged twice;
 *   - "Log it" saved a draft while the toast said "Logged";
 *   - undoing a dismissal only changed the screen;
 *   - "Keep both" after a duplicate prompt had no way to be honoured;
 *   - the first-run "Connect GitHub" state could never render.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CaptureSourceKind, CaptureSourceStatus, WinSource, WinStatus } from '@prisma/client';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { prisma } from '@/lib/prisma';
import { loadLogSurface } from '@/components/log/surface.server';
import { __testing as draftTesting } from '@/services/winDrafting';
import { cleanupTestUser, newTestUserId, rememberWin } from '@/services/winFixtures.test-utils';
import * as winGraph from '@/services/winGraph';
import { createWinCore, dismissWinCore, logWinCore } from '@/services/wins';

const MODEL_OUTPUT = {
    title: 'Cut checkout p99 from 900ms to 300ms',
    narrative: 'Moved the payment retries onto a durable queue.',
    category: 'shipped',
    occurredAtHint: 'today',
    explicitDate: null,
    skills: ['queues'],
    collaborators: [],
    suggestedSensitivity: 'shareable',
    quantified: true,
    impact: { metric: 'p99 latency', baseline: '900ms', result: '300ms', delta: null, scope: null, timeframe: null },
    quantifyPrompt: null,
    confidence: 0.9,
};

/** The structured draft a user saw in quick capture and edited. */
const EDITED_DRAFT = {
    title: 'Cut checkout p99 from 900ms to 300ms (edited)',
    narrative: 'Moved payment retries onto a durable queue; the edit the model would have lost.',
    category: 'shipped' as const,
    occurredAt: new Date(),
    skills: ['queues'],
    collaborators: [],
    suggestedSensitivity: 'shareable' as const,
    quantified: true,
    impact: { metric: 'p99 latency', baseline: '900ms', result: '300ms' },
    quantifyPrompt: null,
    confidence: 0.9,
};

let modelCalls = 0;
let embedCalls = 0;
const users: string[] = [];
function user(label: string): string {
    const id = newTestUserId(`wlc-${label}`);
    users.push(id);
    return id;
}

beforeAll(() => {
    aiTesting.setObjectRunner(async () => {
        modelCalls += 1;
        return { object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 };
    });
    aiTesting.setUsageLogger(async () => {});
    draftTesting.setEmbedder(async () => {
        embedCalls += 1;
        throw new Error('no vector store in this test');
    });
});

afterAll(async () => {
    aiTesting.reset();
    draftTesting.reset();
    for (const id of users) {
        await prisma.captureRun.deleteMany({ where: { userId: id } });
        await prisma.captureSource.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

describe('capture is one structuring call', () => {
    test('a structured draft the user edited is persisted as-is: zero model calls, zero meter units', async () => {
        const userId = user('draft');
        const before = modelCalls;
        const created = await createWinCore({ userId, text: 'rough notes', draft: EDITED_DRAFT, source: WinSource.manual });
        if (!created.success || created.data.kind !== 'created') throw new Error('expected a created win');
        rememberWin(userId, created.data.winId);

        expect(modelCalls - before).toBe(0);
        expect(created.data.costUsd).toBe(0);
        const win = await prisma.win.findUniqueOrThrow({ where: { id: created.data.winId } });
        // The user's edit survived: no re-structuring overwrote it.
        expect(win.title).toBe(EDITED_DRAFT.title);
        const quota = await prisma.usageQuota.findMany({ where: { userId, action: 'win_draft' } });
        expect(quota.reduce((sum, row) => sum + row.used, 0)).toBe(0);
    });

    test('raw text with no draft is structured exactly once', async () => {
        const userId = user('raw');
        const before = modelCalls;
        const created = await createWinCore({ userId, text: 'cut checkout p99 from 900ms to 300ms today', source: WinSource.manual });
        if (!created.success || created.data.kind !== 'created') throw new Error('expected a created win');
        rememberWin(userId, created.data.winId);
        expect(modelCalls - before).toBe(1);
    });
});

describe('"Log it" means logged (rule 5)', () => {
    test('logWinCore with confirm writes Evidence(confirmedByUser) + ClaimLink(grounded), reversible', async () => {
        const userId = user('logit');
        const logged = await logWinCore({ userId, text: 'rough', draft: EDITED_DRAFT, source: WinSource.manual, confirm: true });
        if (!logged.success || logged.data.kind !== 'logged') throw new Error('expected logged');
        rememberWin(userId, logged.data.winId);

        expect(logged.data.confirmed).toBe(true);
        const win = await prisma.win.findUniqueOrThrow({ where: { id: logged.data.winId } });
        expect(win.status).toBe(WinStatus.confirmed);
        const links = await prisma.claimLink.findMany({ where: { userId, claimRefId: logged.data.winId } });
        expect(links).toHaveLength(1);
        expect(links[0].groundState).toBe('grounded');
        const evidence = await prisma.evidence.findUniqueOrThrow({ where: { id: links[0].evidenceId } });
        expect(evidence.confirmedByUser).toBe(true);

        const reversed = await winGraph.unconfirmWin({ userId, winId: logged.data.winId });
        // The Qdrant half may lag in this environment; the Postgres half must not.
        expect(reversed.success || reversed.code === 'qdrant_delete_failed').toBe(true);
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: logged.data.winId } })).toBe(0);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: logged.data.winId } })).status).toBe(WinStatus.draft);
    });

    test('without confirm (the degrade path) it stays a draft and says so', async () => {
        const userId = user('degrade');
        const logged = await logWinCore({ userId, text: 'cut checkout p99 today', source: WinSource.manual, confirm: false });
        if (!logged.success || logged.data.kind !== 'logged') throw new Error('expected logged');
        rememberWin(userId, logged.data.winId);
        expect(logged.data.confirmed).toBe(false);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: logged.data.winId } })).status).toBe(WinStatus.draft);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);
    });
});

describe('"Keep both" after a duplicate prompt', () => {
    test('force skips the near-duplicate check entirely', async () => {
        const userId = user('force');
        const before = embedCalls;
        const created = await createWinCore({ userId, text: 'rough', draft: EDITED_DRAFT, source: WinSource.manual, force: true });
        if (!created.success || created.data.kind !== 'created') throw new Error('expected created');
        rememberWin(userId, created.data.winId);
        expect(embedCalls - before).toBe(0);
    });

    test('without force the check runs', async () => {
        const userId = user('noforce');
        const before = embedCalls;
        const created = await createWinCore({ userId, text: 'rough', draft: EDITED_DRAFT, source: WinSource.manual });
        if (created.success && created.data.kind === 'created') rememberWin(userId, created.data.winId);
        expect(embedCalls - before).toBeGreaterThan(0);
    });
});

describe('undoing a dismissal persists', () => {
    test('dismiss then restore returns the Win to draft; a second restore is harmless', async () => {
        const userId = user('restore');
        const created = await createWinCore({ userId, text: 'rough', draft: EDITED_DRAFT, source: WinSource.github });
        if (!created.success || created.data.kind !== 'created') throw new Error('expected created');
        rememberWin(userId, created.data.winId);

        const dismissed = await dismissWinCore({ userId, winId: created.data.winId, reason: 'not_a_win' });
        expect(dismissed.success).toBe(true);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: created.data.winId } })).status).toBe(WinStatus.dismissed);

        const restored = await winGraph.restoreDismissedWin({ userId, winId: created.data.winId });
        expect(restored.success).toBe(true);
        const row = await prisma.win.findUniqueOrThrow({ where: { id: created.data.winId } });
        expect(row.status).toBe(WinStatus.draft);
        expect(row.dismissedReason).toBeNull();

        const again = await winGraph.restoreDismissedWin({ userId, winId: created.data.winId });
        expect(again.success).toBe(true);
    });

    test("another user's Win cannot be restored", async () => {
        const owner = user('restore-owner');
        const other = user('restore-other');
        const created = await createWinCore({ userId: owner, text: 'rough', draft: EDITED_DRAFT, source: WinSource.github });
        if (!created.success || created.data.kind !== 'created') throw new Error('expected created');
        rememberWin(owner, created.data.winId);
        await dismissWinCore({ userId: owner, winId: created.data.winId, reason: 'not_a_win' });

        const attempt = await winGraph.restoreDismissedWin({ userId: other, winId: created.data.winId });
        expect(attempt.success).toBe(false);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: created.data.winId } })).status).toBe(WinStatus.dismissed);
    });
});

describe('the Work Log surface is read from real rows', () => {
    async function makeSource(userId: string, overrides: Partial<{ status: CaptureSourceStatus; lastSuccessAt: Date; lastError: string }> = {}) {
        return prisma.captureSource.create({
            data: {
                userId,
                kind: CaptureSourceKind.github,
                externalAccountId: 'octo',
                consentGrantedAt: new Date(),
                consentCopyVersion: 'test',
                ...overrides,
            },
        });
    }

    test('no source → not connected, so the "Connect GitHub" first run can show', async () => {
        const surface = await loadLogSurface(user('surface-none'));
        expect(surface.sourceConnected).toBe(false);
        expect(surface.sync).toEqual({ state: 'idle', lastSyncedAt: null });
    });

    test('a connected source → connected, with its real last sync time', async () => {
        const userId = user('surface-idle');
        const at = new Date('2026-09-20T10:00:00.000Z');
        await makeSource(userId, { lastSuccessAt: at });
        const surface = await loadLogSurface(userId);
        expect(surface.sourceConnected).toBe(true);
        expect(surface.sync).toEqual({ state: 'idle', lastSyncedAt: at });
    });

    test('a running capture run → syncing', async () => {
        const userId = user('surface-running');
        const source = await makeSource(userId);
        await prisma.captureRun.create({ data: { userId, sourceId: source.id, trigger: 'initial', status: 'running' } });
        const surface = await loadLogSurface(userId);
        expect(surface.sync.state).toBe('syncing');
    });

    test('a source in error → the error is shown, not hidden', async () => {
        const userId = user('surface-error');
        await makeSource(userId, { status: CaptureSourceStatus.error, lastError: 'Bad credentials' });
        const surface = await loadLogSurface(userId);
        expect(surface.sync.state).toBe('error');
        if (surface.sync.state === 'error') expect(surface.sync.message).toContain('Bad credentials');
    });

    test('a revoked source counts as not connected', async () => {
        const userId = user('surface-revoked');
        await makeSource(userId, { status: CaptureSourceStatus.revoked });
        expect((await loadLogSurface(userId)).sourceConnected).toBe(false);
    });
});
