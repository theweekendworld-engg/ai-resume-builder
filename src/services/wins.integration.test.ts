/**
 * The Clerk-free Work Log path the chat bots use, against the local Postgres.
 *
 * What this proves that the action tests do not: a note that arrives through
 * a bot becomes a real Win with `source = chat`, confirming it from chat writes
 * the SAME evidence pair the Work Log writes (CLAUDE.md rule 5), un-confirming
 * reverses it, and the capture section never makes a second draft for one run.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EvidenceKind, GroundState, WinSource, WinStatus } from '@prisma/client';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { prisma } from '@/lib/prisma';
import { fakeContext } from '@/lib/scout/ingest/testContext.test-utils';
import { __testing as captureTesting, captureSection, captureSourceRef } from '@/lib/scout/sections/capture';
import type { IngestData } from '@/lib/scout/types';
import { __testing as draftTesting } from '@/services/winDrafting';
import { cleanupTestUser, newTestUserId, rememberWin } from '@/services/winFixtures.test-utils';
import { unconfirmWin } from '@/services/winGraph';
import { confirmWinForUser, createWinDraftForUser, dismissWinForUser } from '@/services/wins';

const MODEL_OUTPUT = {
    title: 'Shipped the retry queue, p99 from 900ms to 300ms',
    narrative: 'Moved webhook retries onto a durable queue.',
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

const NOTE = 'shipped the retry queue today, p99 down from 900ms to 300ms';

const users: string[] = [];
function user(label: string): string {
    const id = newTestUserId(`winsvc-${label}`);
    users.push(id);
    return id;
}

beforeAll(() => {
    aiTesting.setObjectRunner(async () => ({ object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 }));
    aiTesting.setUsageLogger(async () => {});
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterAll(async () => {
    aiTesting.reset();
    draftTesting.reset();
    captureTesting.setCreator(null);
    for (const id of users) await cleanupTestUser(id);
});

function ingest(text: string): IngestData {
    return {
        sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: null, author: null, authorUrl: null,
        companyName: null, location: null, postedAt: null, applicantsText: null, text, truncated: false,
    };
}

describe('createWinDraftForUser', () => {
    test('a chat note becomes a DRAFT Win with source chat, never a confirmed one', async () => {
        const userId = user('draft');
        const result = await createWinDraftForUser({ userId, text: NOTE, source: WinSource.chat, sourceRef: 'scout:run_a' });
        expect(result.success).toBe(true);
        if (!result.success) return;
        rememberWin(userId, result.data.winId);

        expect(result.data.status).toBe('draft');
        expect(result.data.title).toBe(MODEL_OUTPUT.title);
        const stored = await prisma.win.findUniqueOrThrow({ where: { id: result.data.winId } });
        expect(stored.source).toBe(WinSource.chat);
        expect(stored.sourceRef).toBe('scout:run_a');
        expect(stored.status).toBe(WinStatus.draft);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
    });

    test('empty text is refused before any model call', async () => {
        const result = await createWinDraftForUser({ userId: user('empty'), text: '   ', source: WinSource.chat });
        expect(result.success).toBe(false);
    });
});

describe('RULE 5 from chat — confirm writes the evidence pair; un-confirm reverses it', () => {
    test('confirmWinForUser writes Evidence(confirmedByUser) + ClaimLink(grounded), exactly like the Work Log', async () => {
        const userId = user('confirm');
        const draft = await createWinDraftForUser({ userId, text: NOTE, source: WinSource.chat, sourceRef: 'scout:run_b' });
        if (!draft.success) throw new Error(draft.error);
        rememberWin(userId, draft.data.winId);

        const confirmed = await confirmWinForUser(userId, draft.data.winId);
        expect(confirmed.success).toBe(true);

        const evidence = await prisma.evidence.findMany({ where: { userId } });
        expect(evidence).toHaveLength(1);
        expect(evidence[0].confirmedByUser).toBe(true);
        expect(evidence[0].kind).toBe(EvidenceKind.metric_confirmed);
        const links = await prisma.claimLink.findMany({ where: { userId } });
        expect(links).toHaveLength(1);
        expect(links[0].claimRefId).toBe(draft.data.winId);
        expect(links[0].groundState).toBe(GroundState.grounded);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: draft.data.winId } })).status).toBe(WinStatus.confirmed);

        const reversed = await unconfirmWin({ userId, winId: draft.data.winId });
        expect(reversed.success).toBe(true);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);
    });

    // A Confirm button tapped twice (or tapped in Telegram after confirming in
    // the Work Log) must be a success and must not duplicate the evidence.
    test('confirming twice succeeds and writes the evidence once', async () => {
        const userId = user('confirm-twice');
        const draft = await createWinDraftForUser({ userId, text: NOTE, source: WinSource.chat, sourceRef: 'scout:run_twice' });
        if (!draft.success) throw new Error(draft.error);
        rememberWin(userId, draft.data.winId);

        const first = await confirmWinForUser(userId, draft.data.winId);
        const second = await confirmWinForUser(userId, draft.data.winId);
        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);
    });

    test("another user's Win cannot be confirmed", async () => {
        const owner = user('owner');
        const draft = await createWinDraftForUser({ userId: owner, text: NOTE, source: WinSource.chat });
        if (!draft.success) throw new Error(draft.error);
        rememberWin(owner, draft.data.winId);
        const result = await confirmWinForUser(user('intruder'), draft.data.winId);
        expect(result.success).toBe(false);
        expect(await prisma.evidence.count({ where: { userId: owner } })).toBe(0);
    });

    test('dismissWinForUser dismisses without writing evidence', async () => {
        const userId = user('dismiss');
        const draft = await createWinDraftForUser({ userId, text: NOTE, source: WinSource.chat });
        if (!draft.success) throw new Error(draft.error);
        rememberWin(userId, draft.data.winId);
        expect((await dismissWinForUser(userId, draft.data.winId)).success).toBe(true);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: draft.data.winId } })).status).toBe(WinStatus.dismissed);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
    });
});

describe('capture section', () => {
    test('a retried step returns the draft it already made, never a second one', async () => {
        const userId = user('capture');
        const runId = `run_capture_${Date.now()}`;
        const sections = { ingest: { status: 'ok' as const, data: ingest(NOTE), sources: [], finishedAt: new Date().toISOString() } };

        const first = await captureSection(fakeContext({ userId, runId, input: { source: 'telegram', text: NOTE }, sections }).ctx);
        const second = await captureSection(fakeContext({ userId, runId, input: { source: 'telegram', text: NOTE }, sections }).ctx);
        expect(first.status).toBe('ok');
        expect(second.status).toBe('ok');
        if (first.status !== 'ok' || second.status !== 'ok') return;
        rememberWin(userId, first.data.winId);

        expect(second.data.winId).toBe(first.data.winId);
        const wins = await prisma.win.findMany({ where: { userId, sourceRef: captureSourceRef(runId) } });
        expect(wins).toHaveLength(1);
        expect(wins[0].source).toBe(WinSource.chat);
        expect(wins[0].status).toBe(WinStatus.draft);
    });

    test('a dashboard note is filed as manual, not chat', async () => {
        const userId = user('manual');
        const runId = `run_manual_${Date.now()}`;
        const sections = { ingest: { status: 'ok' as const, data: ingest(NOTE), sources: [], finishedAt: new Date().toISOString() } };
        const outcome = await captureSection(fakeContext({ userId, runId, input: { source: 'dashboard', text: NOTE }, sections }).ctx);
        if (outcome.status !== 'ok') throw new Error('expected ok');
        rememberWin(userId, outcome.data.winId);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: outcome.data.winId } })).source).toBe(WinSource.manual);
    });

    test('a plan limit is an unavailable answer; a model outage fails the step', async () => {
        const sections = { ingest: { status: 'ok' as const, data: ingest(NOTE), sources: [], finishedAt: new Date().toISOString() } };
        captureTesting.setCreator(async () => ({ success: false, error: 'You have used this month’s drafts', code: 'entitlement_required' }));
        const limited = await captureSection(fakeContext({ userId: user('limit'), runId: 'run_limit', sections }).ctx);
        expect(limited.status).toBe('unavailable');

        captureTesting.setCreator(async () => ({ success: false, error: 'Could not structure that just now', code: 'ai_unavailable' }));
        await expect(captureSection(fakeContext({ userId: user('outage'), runId: 'run_outage', sections }).ctx)).rejects.toThrow('Could not structure');
        captureTesting.setCreator(null);
    });
});
