/**
 * The action layer (impl/00 §P-3): auth -> zod -> gate -> work -> FunnelEvent
 * -> Result. The interesting behaviour all lives in `winGraph`/`winDrafting`
 * and is tested there against the real database; what is under test here is the
 * envelope — that an unauthenticated call is a *value* and not a throw, that
 * bad input never reaches Postgres, and that the telemetry PRD 01 §11 promises
 * actually gets written.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { __testing as draftTesting } from '@/services/winDrafting';
import { cleanupTestUser, newTestUserId, rememberWin } from '@/services/winFixtures.test-utils';


const clerk = installClerkMock();

const wins = await import('@/actions/wins');

const users: string[] = [];

function signIn(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    clerk.signIn(id);
    return id;
}

/**
 * Create through the real action, but tell the fixture registry about the id —
 * teardown has to find the Win's `embed_win` job rows even in the tests that
 * delete the Win themselves.
 */
async function createWin(input: Parameters<typeof wins.createWinFromText>[0]) {
    const result = await wins.createWinFromText(input);
    if (result.success && clerk.userId) rememberWin(clerk.userId, result.data.id);
    return result;
}

const MODEL_OUTPUT = {
    title: 'Cut checkout p95 latency from 800ms to 180ms',
    narrative: 'Rewrote the pricing lookup as a batched query.',
    category: 'improved',
    occurredAtHint: 'today',
    explicitDate: null,
    skills: ['postgres'],
    collaborators: [],
    suggestedSensitivity: 'shareable',
    quantified: true,
    impact: {
        metric: 'checkout p95 latency',
        baseline: '800ms',
        result: '180ms',
        delta: null,
        scope: null,
        timeframe: null,
    },
    quantifyPrompt: null,
    confidence: 0.9,
};

const SOURCE_TEXT = 'fixed the checkout timeout thing, p95 went from 800ms to 180ms';

beforeAll(() => {
    aiTesting.setObjectRunner(async () => ({ object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 }));
    aiTesting.setUsageLogger(async () => {});
    // No vector round trip for the near-duplicate probe.
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterAll(() => {
    aiTesting.reset();
    draftTesting.reset();
    clerk.signOut();
});

afterEach(async () => {
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupTestUser(id);
    }
    clerk.signOut();
});

describe('auth is a value, never a throw', () => {
    test('every action returns unauthenticated when there is no session', async () => {
        clerk.signOut();
        const results = await Promise.all([
            wins.createWinFromText({ text: 'hi' }),
            wins.confirmWin('w1'),
            wins.unconfirmWin('w1'),
            wins.updateWin('w1', { title: 'x' }),
            wins.dismissWin('w1', 'noise'),
            wins.listWins({}),
            wins.bulkConfirm(['w1']),
            wins.getLogSummary(),
            wins.structureDraft('hi'),
            wins.addImpact('w1', '40% faster'),
            wins.archiveWin('w1'),
            wins.unarchiveWin('w1'),
            wins.deleteWin('w1'),
            wins.listEmployers(),
        ]);
        for (const result of results) {
            expect(result.success).toBe(false);
            if (!result.success) expect(result.code).toBe('unauthenticated');
        }
    });
});

describe('input validation happens before any write', () => {
    test('empty text is rejected', async () => {
        signIn('validation');
        const result = await createWin({ text: '' });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('invalid_input');
    });

    test('a bad dismiss reason is rejected', async () => {
        signIn('validation-reason');
        const result = await wins.dismissWin('w1', 'nonsense' as never);
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('invalid_input');
    });

    test('an over-long title patch is rejected', async () => {
        signIn('validation-title');
        const result = await wins.updateWin('w1', { title: 'x'.repeat(200) });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('invalid_input');
    });
});

describe('the capture round trip through the actions', () => {
    test('createWinFromText drafts, confirms and emits the funnel events', async () => {
        const userId = signIn('roundtrip');

        const created = await createWin({ text: SOURCE_TEXT });
        expect(created.success).toBe(true);
        if (!created.success) return;

        expect(created.data.status).toBe(WinStatus.draft);
        expect(created.data.title).toBe(MODEL_OUTPUT.title);
        expect(created.data.impact?.baseline).toBe('800ms');
        expect(created.data.groundState).toBe('unsupported');
        expect(created.data.quantifyPrompt).toBeNull();

        const confirmed = await wins.confirmWin(created.data.id);
        expect(confirmed.success && confirmed.data.groundState).toBe('grounded');

        const drafted = await prisma.funnelEvent.findFirst({ where: { userId, type: 'win_drafted' } });
        expect(drafted).not.toBeNull();
        expect((drafted?.payload as Record<string, unknown>).feature).toBe('work_log');

        const confirmedEvent = await prisma.funnelEvent.findFirst({ where: { userId, type: 'win_confirmed' } });
        expect(confirmedEvent).not.toBeNull();
        expect((confirmedEvent?.payload as Record<string, unknown>).surface).toBe('web');

        const summary = await wins.getLogSummary();
        expect(summary.success && summary.data.totalConfirmed).toBe(1);
        expect(summary.success && summary.data.withEvidence).toBe(1);
    });

    test('updateWin records one win_edited_field per changed field', async () => {
        const userId = signIn('edited');
        const created = await createWin({ text: SOURCE_TEXT });
        expect(created.success).toBe(true);
        if (!created.success) return;

        await wins.updateWin(created.data.id, { title: 'A better title', category: 'fixed' });

        const events = await prisma.funnelEvent.findMany({ where: { userId, type: 'win_edited_field' } });
        const fields = events.map((event) => (event.payload as Record<string, unknown>).field).sort();
        expect(fields).toEqual(['category', 'title']);
    });

    test('structureDraft returns an editable draft and writes NOTHING', async () => {
        const userId = signIn('structure-only');

        const result = await wins.structureDraft(SOURCE_TEXT);
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.title).toBe(MODEL_OUTPUT.title);
        expect(result.data.impact?.baseline).toBe('800ms');
        expect(result.data.occurredAt).toBeInstanceOf(Date);

        // The whole reason this is a separate action: an abandoned capture
        // leaves no row behind.
        expect(await prisma.win.count({ where: { userId } })).toBe(0);
        expect(await prisma.impactMetric.count({ where: { userId } })).toBe(0);
    });

    test('createWinFromText with a draft persists the edits and never re-runs the model', async () => {
        const userId = signIn('draft-path');

        let modelCalls = 0;
        aiTesting.setObjectRunner(async () => {
            modelCalls += 1;
            return { object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 };
        });

        const structured = await wins.structureDraft(SOURCE_TEXT);
        expect(structured.success).toBe(true);
        if (!structured.success) return;
        expect(modelCalls).toBe(1);

        // The user corrects the framing before submitting.
        const created = await createWin({
            draft: {
                ...structured.data,
                title: 'My own words about the checkout fix',
                category: 'fixed',
            },
        });
        expect(created.success).toBe(true);
        if (!created.success) return;

        // No second call — the corrections would have been overwritten.
        expect(modelCalls).toBe(1);
        expect(created.data.title).toBe('My own words about the checkout fix');
        expect(created.data.category).toBe('fixed');
        expect(created.data.impact?.baseline).toBe('800ms');
        expect(await prisma.win.count({ where: { userId } })).toBe(1);

        aiTesting.setObjectRunner(async () => ({ object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 }));
    });

    test('createWinFromText needs text or a titled draft', async () => {
        signIn('draft-empty');
        const result = await createWin({});
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('invalid_input');
    });

    test('confirmWin carries GroundChip evidence into the transaction', async () => {
        const userId = signIn('chip');
        const created = await createWin({ text: SOURCE_TEXT });
        expect(created.success).toBe(true);
        if (!created.success) return;

        const confirmed = await wins.confirmWin(created.data.id, undefined, {
            source: 'https://github.com/patronus/api/pull/482',
        });
        expect(confirmed.success).toBe(true);
        if (!confirmed.success) return;

        expect(confirmed.data.evidence).toHaveLength(2);
        expect(confirmed.data.evidence.some((entry) => entry.label === 'PR #482')).toBe(true);
        expect(await prisma.evidence.count({ where: { userId, confirmedByUser: true } })).toBe(2);
    });

    test('addImpact writes the metric from the user\'s own words', async () => {
        const userId = signIn('add-impact');
        const created = await createWin({ text: 'sped up the checkout page a lot' });
        expect(created.success).toBe(true);
        if (!created.success) return;

        aiTesting.setObjectRunner(async () => ({
            object: {
                metric: 'checkout p95 latency',
                baseline: null,
                result: '180ms',
                delta: null,
                scope: null,
                timeframe: null,
            },
            inputTokens: 10,
            outputTokens: 10,
        }));

        const result = await wins.addImpact(created.data.id, 'about 180ms now');
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.impact?.result).toBe('180ms');
        expect(result.data.quantifyPrompt).toBeNull();

        const answered = await prisma.funnelEvent.findFirst({
            where: { userId, type: 'quantify_prompt_answered' },
        });
        expect(answered).not.toBeNull();

        aiTesting.setObjectRunner(async () => ({ object: MODEL_OUTPUT, inputTokens: 10, outputTokens: 10 }));
    });

    test('addImpact with no figure in the answer changes nothing', async () => {
        const userId = signIn('add-impact-empty');
        const created = await createWin({ text: 'sped up the checkout page a lot' });
        expect(created.success).toBe(true);
        if (!created.success) return;

        const result = await wins.addImpact(created.data.id, 'quite a bit faster honestly');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('no_quantity');

        expect(await prisma.impactMetric.count({ where: { userId } })).toBe(0);
        const unchanged = await prisma.win.findUniqueOrThrow({ where: { id: created.data.id } });
        expect(unchanged.impactMetricId).toBeNull();
    });

    test('archive, unarchive and delete round-trip through the actions', async () => {
        const userId = signIn('lifecycle');
        const created = await createWin({ text: SOURCE_TEXT });
        expect(created.success).toBe(true);
        if (!created.success) return;
        await wins.confirmWin(created.data.id);

        const archived = await wins.archiveWin(created.data.id);
        expect(archived.success && archived.data.status).toBe(WinStatus.archived);

        const hidden = await wins.listWins({});
        expect(hidden.success && hidden.data.total).toBe(0);

        const restored = await wins.unarchiveWin(created.data.id);
        expect(restored.success && restored.data.status).toBe(WinStatus.confirmed);

        const deleted = await wins.deleteWin(created.data.id);
        expect(deleted.success).toBe(true);
        expect(await prisma.win.count({ where: { userId } })).toBe(0);
    });

    test('listEmployers feeds the filter bar', async () => {
        const userId = signIn('employers');
        await prisma.userExperience.create({
            data: { userId, company: 'Acme', role: 'Staff Engineer', startDate: '2025-01', endDate: '', current: true },
        });

        const result = await wins.listEmployers();
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({ name: 'Acme', role: 'Staff Engineer', current: true });
    });

    test('a win belonging to someone else is not found, not leaked', async () => {
        const owner = signIn('owner');
        const created = await createWin({ text: SOURCE_TEXT });
        expect(created.success).toBe(true);
        if (!created.success) return;

        signIn('intruder');
        const stolen = await wins.confirmWin(created.data.id);
        expect(stolen.success).toBe(false);
        if (!stolen.success) expect(stolen.code).toBe('not_found');

        clerk.signIn(owner);
        const stillDraft = await prisma.win.findUniqueOrThrow({ where: { id: created.data.id } });
        expect(stillDraft.status).toBe(WinStatus.draft);
    });
});
