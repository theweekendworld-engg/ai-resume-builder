/**
 * The backfill action envelope (impl/00 §P-3).
 *
 * The conversation is tested in `backfill.eval.test.ts` and the data contract
 * in `agents/tools/backfill.test.ts`. What is under test here is the envelope,
 * and specifically the four things that go wrong at this layer:
 *
 *   - an unauthenticated call is a *value*, never a throw
 *   - a flagged-off surface is invisible, including to a direct action call,
 *     because a server action is a public endpoint
 *   - a resumed session is not metered a second time (PRD 07 §6 gives the free
 *     tier exactly one, so double-metering ends the demo at question two)
 *   - the telemetry PRD 07 §7 promises is actually written, with the question
 *     index that makes the abandon histogram usable
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { __testing as draftTesting } from '@/services/winDrafting';
import { invalidateFlagCache } from '@/lib/flags';
import {
    cleanupTestUser,
    makeExperience,
    newTestUserId,
} from '@/services/winFixtures.test-utils';
import { BACKFILL_ENTRY_POINTS, BACKFILL_EXTRACT_SYSTEM } from '@/agents/backfillAgent';

const clerk = installClerkMock();

const backfill = await import('@/actions/backfill');

// ───────────────────────────────────────────────────────────────── harness

const users: string[] = [];
const sessionIds: string[] = [];
const allowed: string[] = [];
let flagExisted = false;
let originalAllowList: string[] = [];
/**
 * The flag's own state, saved and restored.
 *
 * The allow-list was already preserved; `enabled` and `rolloutPercent` were
 * not, and the gating tests silently assumed both were off in whatever
 * database they happened to run against. Turning `backfill` on for real
 * development made "a flagged-off user cannot reach the action" fail — the
 * user was not flagged off any more, and the test had no way to say so.
 *
 * A test that asserts about a gate has to own the gate.
 */
let originalEnabled = false;
let originalRollout = 0;

/**
 * Flip the flag on for exactly the test users, never globally. The local
 * database is shared with real development data and a row left `enabled: true`
 * would switch an unfinished surface on for a human.
 */
async function allowUser(userId: string): Promise<void> {
    allowed.push(userId);
    await prisma.featureFlag.upsert({
        where: { key: 'backfill' },
        create: {
            key: 'backfill',
            enabled: false,
            description: 'Career OS: backfill',
            allowUserIds: allowed,
        },
        update: { allowUserIds: allowed },
    });
    invalidateFlagCache();
}

async function signIn(label: string, { allow = true } = {}): Promise<string> {
    const id = newTestUserId(`backfill-action-${label}`);
    users.push(id);
    clerk.signIn(id);
    if (allow) await allowUser(id);
    return id;
}

const OPENING = {
    acknowledgement: '',
    question: 'What are you most known for from your time at Acme?',
};

const EXTRACTION = {
    wins: [
        {
            title: 'Led the payments migration',
            narrative: '',
            category: 'led',
            skills: [],
            collaborators: [],
            suggestedSensitivity: 'shareable',
            quantified: false,
            impact: null,
            excerpt: 'I led the payments migration',
        },
    ],
    metricForPreviousWin: null,
    saidDontRemember: false,
    vague: false,
    coveredTopics: [],
};

beforeAll(async () => {
    const existing = await prisma.featureFlag.findUnique({ where: { key: 'backfill' } });
    flagExisted = existing !== null;
    originalAllowList = Array.isArray(existing?.allowUserIds)
        ? (existing.allowUserIds as string[])
        : [];
    originalEnabled = existing?.enabled ?? false;
    originalRollout = existing?.rolloutPercent ?? 0;
    allowed.push(...originalAllowList);

    // Off for everyone except the allow-list, for the duration. That is the
    // condition every assertion in this file is about.
    if (flagExisted) {
        await prisma.featureFlag.update({
            where: { key: 'backfill' },
            data: { enabled: false, rolloutPercent: 0 },
        });
        invalidateFlagCache();
    }

    aiTesting.setObjectRunner(async ({ system }) => ({
        object: system === BACKFILL_EXTRACT_SYSTEM ? EXTRACTION : OPENING,
        inputTokens: 50,
        outputTokens: 30,
    }));
    aiTesting.setUsageLogger(async () => {});
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterAll(async () => {
    aiTesting.reset();
    draftTesting.reset();
    if (sessionIds.length > 0) {
        await prisma.interviewSession.deleteMany({ where: { id: { in: sessionIds } } });
    }
    for (const userId of users) await cleanupTestUser(userId);

    if (flagExisted) {
        await prisma.featureFlag.update({
            where: { key: 'backfill' },
            data: {
                allowUserIds: originalAllowList,
                enabled: originalEnabled,
                rolloutPercent: originalRollout,
            },
        });
    } else {
        await prisma.featureFlag.deleteMany({ where: { key: 'backfill' } });
    }
    invalidateFlagCache();
});

afterEach(() => {
    clerk.signOut();
});

async function start(userId: string, label = 'Acme') {
    const experience = await makeExperience({ userId, company: label, startDate: '2023-01', endDate: '2025-01' });
    const result = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: experience.id,
        subjectLabel: label,
        entryPoint: 'log_menu',
    });
    if (result.success) sessionIds.push(result.data.sessionId);
    return { result, experienceId: experience.id };
}

// ═══════════════════════════════════════════════════════════════ the envelope

describe('auth and flag gating', () => {
    test('an unauthenticated call returns a value, it does not throw', async () => {
        clerk.signOut();
        const result = await backfill.startBackfillSession({
            subjectType: 'employer',
            subjectLabel: 'Acme',
            entryPoint: 'log_menu',
        });
        expect(result).toMatchObject({ success: false, code: 'unauthenticated' });
    });

    test('a flagged-off user cannot reach the action directly', async () => {
        // The page checks the flag too, but a server action is a public endpoint.
        await signIn('flagoff', { allow: false });
        const result = await backfill.startBackfillSession({
            subjectType: 'employer',
            subjectLabel: 'Acme',
            entryPoint: 'log_menu',
        });
        expect(result).toMatchObject({ success: false, code: 'not_available' });
    });

    test('every read path is gated, not just the writes', async () => {
        await signIn('flagoff-read', { allow: false });
        expect(await backfill.getBackfillEntryData()).toMatchObject({ code: 'not_available' });
        expect(await backfill.getBackfillSession('whatever')).toMatchObject({ code: 'not_available' });
        expect(await backfill.exportBackfillTranscript('whatever')).toMatchObject({
            code: 'not_available',
        });
    });

    test('bad input never reaches Postgres', async () => {
        await signIn('badinput');
        const result = await backfill.startBackfillSession({
            subjectType: 'employer',
            subjectLabel: '',
            entryPoint: 'log_menu',
        });
        expect(result).toMatchObject({ success: false, code: 'invalid_input' });
    });

    test('an entry point that is not one of the six is rejected', async () => {
        await signIn('entrypoint');
        const result = await backfill.startBackfillSession({
            subjectType: 'employer',
            subjectLabel: 'Acme',
            // The retarget's whole point: there is no onboarding entry point.
            entryPoint: 'onboarding' as never,
        });
        expect(result).toMatchObject({ success: false, code: 'invalid_input' });
    });
});

// ═══════════════════════════════════════════════════════════════ metering

describe('the session is the metered unit', () => {
    test('resuming does not count as a second session', async () => {
        const userId = await signIn('resume');
        const first = await start(userId);
        expect(first.result.success).toBe(true);
        if (!first.result.success) return;
        expect(first.result.data.resumed).toBe(false);

        const second = await backfill.startBackfillSession({
            subjectType: 'employer',
            subjectId: first.experienceId,
            subjectLabel: 'Acme',
            entryPoint: 'log_menu',
        });
        expect(second.success).toBe(true);
        if (!second.success) return;

        expect(second.data.sessionId).toBe(first.result.data.sessionId);
        expect(second.data.resumed).toBe(true);

        const started = await prisma.funnelEvent.count({
            where: { userId, type: 'backfill_started' },
        });
        const resumed = await prisma.funnelEvent.count({
            where: { userId, type: 'backfill_resumed' },
        });
        expect(started).toBe(1);
        expect(resumed).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════ the turn

describe('answering', () => {
    test('captures a draft and records the question index', async () => {
        const userId = await signIn('answer');
        const opened = await start(userId);
        expect(opened.result.success).toBe(true);
        if (!opened.result.success) return;

        const turn = await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            answer: 'I led the payments migration off the legacy processor.',
        });

        expect(turn.success).toBe(true);
        if (!turn.success) return;
        expect(turn.data.captured.length).toBe(1);
        expect(turn.data.progress.questionNumber).toBeGreaterThan(1);

        const wins = await prisma.win.findMany({ where: { userId } });
        expect(wins.length).toBe(1);
        expect(wins[0].status).toBe('draft');

        // PRD 07 §7: the index is what makes the abandon histogram usable.
        const answered = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'backfill_question_answered' },
        });
        expect(answered).not.toBeNull();
        expect((answered?.payload as Record<string, unknown>)?.index).toBe(1);

        const captured = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'backfill_win_captured' },
        });
        expect((captured?.payload as Record<string, unknown>)?.quantified).toBe(false);
    });

    test('"I don\'t remember" is a real answer, not an empty one', async () => {
        const userId = await signIn('dontremember');
        const opened = await start(userId);
        if (!opened.result.success) return;

        const turn = await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            dontRemember: true,
        });
        expect(turn.success).toBe(true);

        const event = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'backfill_question_answered' },
        });
        expect((event?.payload as Record<string, unknown>)?.saidDontRemember).toBe(true);
        // Nothing to extract, so nothing is written and no model call is spent.
        expect(await prisma.win.count({ where: { userId } })).toBe(0);
    });

    test('an empty answer is refused before any work happens', async () => {
        const userId = await signIn('empty');
        const opened = await start(userId);
        if (!opened.result.success) return;

        const turn = await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            answer: '   ',
        });
        expect(turn).toMatchObject({ success: false, code: 'invalid_input' });
    });

    test('another user cannot answer your interview', async () => {
        const owner = await signIn('owner');
        const opened = await start(owner);
        if (!opened.result.success) return;

        await signIn('intruder');
        const turn = await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            answer: 'let me in',
        });
        expect(turn.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════ pause & close

describe('leaving and finishing', () => {
    test('pausing records where they left off', async () => {
        const userId = await signIn('pause');
        const opened = await start(userId);
        if (!opened.result.success) return;

        const paused = await backfill.pauseBackfillSession(opened.result.data.sessionId);
        expect(paused.success).toBe(true);

        const row = await prisma.interviewSession.findUnique({
            where: { id: opened.result.data.sessionId },
        });
        expect(row?.status).toBe('paused');

        const event = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'backfill_abandoned' },
        });
        expect((event?.payload as Record<string, unknown>)?.atQuestion).toBe(1);
    });

    test('a paused session rehydrates with its question still on screen', async () => {
        const userId = await signIn('rehydrate');
        const opened = await start(userId);
        if (!opened.result.success) return;
        await backfill.pauseBackfillSession(opened.result.data.sessionId);

        const view = await backfill.getBackfillSession(opened.result.data.sessionId);
        expect(view.success).toBe(true);
        if (!view.success) return;
        expect(view.data.turn.question).toBe(OPENING.question);
        expect(view.data.transcript.length).toBe(1);
    });

    test('the closing screen states counted numbers', async () => {
        const userId = await signIn('closing');
        const opened = await start(userId);
        if (!opened.result.success) return;

        await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            answer: 'I led the payments migration off the legacy processor.',
        });

        const closing = await backfill.completeBackfillSession(opened.result.data.sessionId);
        expect(closing.success).toBe(true);
        if (!closing.success) return;

        expect(closing.data.summary.winsCaptured).toBe(1);
        expect(closing.data.lines[0]).toContain('1 win from Acme');

        const event = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'backfill_completed' },
        });
        expect((event?.payload as Record<string, unknown>)?.winsCaptured).toBe(1);
    });

    test('confirm-all is a user act, and it is the thing that grounds the wins', async () => {
        const userId = await signIn('confirm');
        const opened = await start(userId);
        if (!opened.result.success) return;

        await backfill.answerBackfill({
            sessionId: opened.result.data.sessionId,
            answer: 'I led the payments migration off the legacy processor.',
        });

        // Before: still a draft, still ungrounded (CLAUDE.md rule 5).
        const before = await prisma.win.findFirst({ where: { userId } });
        expect(before?.status).toBe('draft');

        const result = await backfill.confirmAllFromSession(opened.result.data.sessionId);
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.confirmed).toBe(1);

        const after = await prisma.win.findFirst({ where: { userId } });
        expect(after?.status).toBe('confirmed');
        const grounded = await prisma.claimLink.findMany({
            where: { userId, groundState: 'grounded' },
        });
        expect(grounded.length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════ entry screen

describe('the entry screen', () => {
    test('offers employers, and points at a live session when there is one', async () => {
        const userId = await signIn('entry');
        const opened = await start(userId, 'Acme');
        if (!opened.result.success) return;

        const data = await backfill.getBackfillEntryData();
        expect(data.success).toBe(true);
        if (!data.success) return;

        const subject = data.data.subjects.find((entry) => entry.subjectId === opened.experienceId);
        expect(subject?.label).toBe('Acme');
        expect(subject?.resumeSessionId).toBe(opened.result.data.sessionId);
    });

    test('the six entry points do not include onboarding', () => {
        // PRD 07 §1: the retarget exists because a 20-question interview before
        // the first resume is a tax at the worst possible moment.
        expect(BACKFILL_ENTRY_POINTS).not.toContain('onboarding' as never);
        expect(BACKFILL_ENTRY_POINTS.length).toBe(6);
    });
});
