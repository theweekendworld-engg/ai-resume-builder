/**
 * J3 — the backfill loop (docs/impl/04 §4, PRD 07).
 *
 * Interview → answers → drafts captured *at capture time* → confirm → the
 * record extends backwards. This is the lever that moves the first real payoff
 * from month six to week one, so the properties it has to hold are unusually
 * blunt:
 *
 *   1. **A dropped browser loses nothing.** Every Win is a row before the turn
 *      returns, not when the session ends. The journey proves it by walking
 *      away mid-conversation and coming back.
 *   2. **Nothing is ever auto-confirmed.** Draft in, draft out, until a human
 *      presses the button (CLAUDE.md rule 5).
 *   3. **Zero `ImpactMetric` figures the user did not state.** Not a rounded
 *      one, not a derived one, and — the part that is easy to get wrong — not a
 *      partial row either. A metric-shaped hole with a `⚡ quantified` chip on
 *      it is the exact lie this feature exists to prevent.
 *   4. **Recovered work is dated to when it happened.** A 2023 Win stamped
 *      today sorts above this week's real work and corrupts the log's premise.
 *   5. **Confidential stays inside.** Sensitivity is set *and* no vector is
 *      ever written (ADR-8).
 *
 * The model is scripted rather than synthesized: this journey is about what the
 * pipeline does with a *misbehaving* model, and a default drafter that happens
 * to be well-behaved would prove nothing about the guard.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { GroundState, InterviewStatus, WinSensitivity, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';
import {
    assertGrounded,
    assertHasVector,
    assertNoDeadJobs,
    assertNoFabricatedNumbers,
    assertNoVector,
    assertPurged,
    defineJourney,
    drainJobs,
    purge,
} from './harness';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

// `defineJourney` registers the Clerk module mock, so it must run before the
// modules under test bind `auth()`. Hence the top-level dynamic imports below.
const journey = defineJourney({
    name: 'backfill-loop',
    boundaries: ['openai', 'qdrant'],
});

const backfill = await import('@/actions/backfill');
const agent = await import('@/agents/backfillAgent');

// ───────────────────────────────────────────────────────────── the subject

/**
 * Acme, 2023. The period matters: `backfillOccurredAt` dates every recovered
 * Win to the middle of it, and asserting that is how we know the log has not
 * been back-filled with today's timestamps.
 */
const EMPLOYER = 'Acme';
const PERIOD_START = new Date(Date.UTC(2023, 0, 1));
const PERIOD_END = new Date(Date.UTC(2023, 11, 31, 23, 59, 59, 999));

let experienceId = '';
let sessionId = '';

// ───────────────────────────────────────────────────────── the model script
//
// Two boundaries, one scripted each. `resetMocks()` clears the script after
// every test, so it is re-installed in `beforeEach` rather than once.

const TURN_MARKER = 'You are helping a working professional reconstruct accomplishments';
const EXTRACT_MARKER = 'You read one answer from a conversation about';

/**
 * One clean question per rung of the ladder. Every one is single-clause,
 * numeral-free and compliment-free, because `checkQuestion` runs for real on
 * whatever the model returns and a violation would be silently swapped for the
 * scripted fallback — which would make the assertions below test the fallback
 * rather than the pipeline.
 */
const QUESTION_BY_TOPIC: Record<string, string> = {
    anchor: `What are you most known for from your time at ${EMPLOYER}?`,
    quantify: 'Do you know how much that moved?',
    scope: 'Was that just your own team, or wider?',
    rarity: 'Whose work changed because of something you did there?',
    evidence: 'Is there a doc or dashboard you could point at for that?',
    sweep: 'Anything from that period you would be annoyed to leave off your resume?',
};

function topicOf(prompt: string): string {
    return /TOPIC FOR YOUR QUESTION: (\w+)/.exec(prompt)?.[1] ?? 'sweep';
}

type ExtractedWin = {
    title: string;
    narrative: string;
    category: string;
    skills: string[];
    collaborators: string[];
    suggestedSensitivity: string;
    quantified: boolean;
    impact: {
        metric: string;
        baseline: string | null;
        result: string | null;
        delta: string | null;
        scope: string | null;
        timeframe: string | null;
    } | null;
    excerpt: string;
};

type Extraction = {
    wins: ExtractedWin[];
    metricForPreviousWin: ExtractedWin['impact'];
    saidDontRemember: boolean;
    vague: boolean;
    coveredTopics: string[];
};

const NOTHING: Extraction = {
    wins: [],
    metricForPreviousWin: null,
    saidDontRemember: false,
    vague: true,
    coveredTopics: [],
};

/** What the extractor will return for the next answer. Set per test. */
let nextExtraction: Extraction = NOTHING;

function win(patch: Partial<ExtractedWin> & { title: string; excerpt: string }): ExtractedWin {
    return {
        narrative: '',
        category: 'shipped',
        skills: [],
        collaborators: [],
        suggestedSensitivity: 'shareable',
        quantified: false,
        impact: null,
        ...patch,
    };
}

beforeEach(() => {
    journey.m.openai
        .onObject(TURN_MARKER, ({ prompt }) => ({
            object: {
                // Empty on the opening turn: there is nothing to acknowledge yet.
                acknowledgement: prompt.includes('THEIR LATEST ANSWER') ? 'Noted.' : '',
                question: QUESTION_BY_TOPIC[topicOf(prompt)],
            },
        }))
        .onObject(EXTRACT_MARKER, () => ({ object: nextExtraction }));
});

// ─────────────────────────────────────────────────────────────── the flag
//
// Flipped on for exactly this run's user, never globally: the database is
// shared with real development data and a row left `enabled` would switch an
// unfinished surface on for a human.

let flagRestore: (() => Promise<void>) | null = null;

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
    const existing = await prisma.featureFlag.findUnique({ where: { key: 'backfill' } });
    const before = Array.isArray(existing?.allowUserIds) ? (existing.allowUserIds as string[]) : [];

    await prisma.featureFlag.upsert({
        where: { key: 'backfill' },
        create: {
            key: 'backfill',
            enabled: false,
            description: 'Career OS: backfill',
            allowUserIds: [journey.userId],
        },
        update: { allowUserIds: [...before, journey.userId] },
    });
    invalidateFlagCache();

    flagRestore = async () => {
        if (existing) {
            await prisma.featureFlag.update({
                where: { key: 'backfill' },
                data: { allowUserIds: before },
            });
        } else {
            await prisma.featureFlag.deleteMany({ where: { key: 'backfill' } });
        }
        invalidateFlagCache();
    };
});

afterAll(async () => {
    await restoreFlags(__flagSnapshot);
    await flagRestore?.();
});

// ─────────────────────────────────────────────────────────────── helpers

async function winsOnRecord() {
    return prisma.win.findMany({
        where: { userId: journey.userId },
        orderBy: { createdAt: 'asc' },
    });
}

async function session() {
    const row = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!row) throw new Error('interview session vanished');
    return row;
}

function askedTopics(row: { askedTopics: unknown }): string[] {
    return Array.isArray(row.askedTopics) ? (row.askedTopics as string[]) : [];
}

/** The topic key on the last agent turn — i.e. what the pending question is about. */
function pendingTopicKey(row: { transcript: unknown }): string | null {
    const turns = Array.isArray(row.transcript) ? (row.transcript as Record<string, unknown>[]) : [];
    const last = [...turns].reverse().find((turn) => turn.role === 'agent');
    return typeof last?.topic === 'string' ? last.topic : null;
}

async function usedContextInterviews(): Promise<number> {
    const rows = await prisma.usageQuota.findMany({
        where: { userId: journey.userId, action: 'context_interview' },
        select: { used: true },
    });
    return rows.reduce((total, row) => total + row.used, 0);
}

// ═══════════════════════════════════════════════════════ 1. opening the interview

test('the interview opens on the anchor question and has captured nothing yet', async () => {
    const experiences = await import('@/actions/experiences');
    const created = (await experiences.createUserExperience({
        company: EMPLOYER,
        role: 'Staff Engineer',
        startDate: '2023-01',
        endDate: '2023-12',
        description: 'Payments platform.',
        highlights: ['Worked on payments.'],
    })) as { success: boolean; experienceId?: string };

    expect(created.success).toBe(true);
    experienceId = created.experienceId ?? '';
    expect(experienceId).not.toBe('');

    const opened = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: experienceId,
        subjectLabel: EMPLOYER,
        entryPoint: 'thin_log_period',
    });

    expect(opened).toMatchObject({ success: true });
    if (!opened.success) return;

    sessionId = opened.data.sessionId;
    expect(opened.data.resumed).toBe(false);
    expect(opened.data.turn.question).toBe(QUESTION_BY_TOPIC.anchor);
    expect(opened.data.turn.topic).toBe('anchor');
    expect(opened.data.turn.captured).toEqual([]);
    expect(opened.data.turn.done).toBe(false);

    // Nothing exists yet, and the session is the metered unit.
    expect(await prisma.win.count({ where: { userId: journey.userId } })).toBe(0);
    expect(await usedContextInterviews()).toBe(1);

    const started = await prisma.funnelEvent.count({
        where: { userId: journey.userId, type: 'backfill_started' },
    });
    expect(started).toBe(1);
});

// ══════════════════════════════════ 2. THE property: drafts land at capture time

test('an answer becomes draft rows before the session ends, not when it ends', async () => {
    nextExtraction = {
        ...NOTHING,
        vague: false,
        wins: [
            win({
                title: 'Led the payments migration off the legacy processor',
                narrative: 'Owned the migration end to end.',
                category: 'led',
                excerpt: 'I led the payments migration off the legacy processor',
            }),
            win({
                title: 'Mentored the junior engineers on the team',
                narrative: 'Paired with them through the migration.',
                category: 'grew',
                excerpt: 'I mentored the junior engineers on the team through it',
            }),
        ],
    };

    const answer =
        'I led the payments migration off the legacy processor and I mentored the junior engineers on the team through it.';
    const turn = await backfill.answerBackfill({ sessionId, answer });

    expect(turn).toMatchObject({ success: true });
    if (!turn.success) return;
    expect(turn.data.captured.length).toBe(2);

    // The session is still open. Everything below is therefore true *during* the
    // conversation, which is the whole claim.
    const row = await session();
    expect(row.status).toBe(InterviewStatus.active);
    expect(row.completedAt).toBeNull();

    const rows = await winsOnRecord();
    expect(rows.length).toBe(2);
    for (const record of rows) {
        expect(record.status).toBe(WinStatus.draft);
        expect(record.source).toBe('backfill');
        expect(record.sourceRef).toBe(`backfill:${sessionId}`);
        // Dated to the employer's period, not to today.
        expect(record.occurredAt.getTime()).toBeGreaterThanOrEqual(PERIOD_START.getTime());
        expect(record.occurredAt.getTime()).toBeLessThanOrEqual(PERIOD_END.getTime());
        expect(record.employerId).toBe(experienceId);
    }

    // Their own words are the evidence — and it is a claim, not a fact, until
    // they confirm it (CLAUDE.md rule 5, "fail closed on truth").
    const evidence = await prisma.evidence.findMany({ where: { userId: journey.userId } });
    expect(evidence.length).toBe(2);
    for (const item of evidence) {
        expect(item.kind).toBe('interview_assertion');
        expect(item.confirmedByUser).toBe(false);
        expect(answer).toContain(item.excerpt);
    }

    const links = await prisma.claimLink.findMany({ where: { userId: journey.userId } });
    expect(links.length).toBe(2);
    expect(links.every((link) => link.groundState === GroundState.needs_confirmation)).toBe(true);

    // A draft is not externally visible, at any stage.
    await drainJobs();
    for (const record of rows) await assertNoVector(record.id);
});

// ══════════════════════════════ 3. the dropped browser — the single most important hop

test('walking away mid-conversation loses nothing and the session resumes', async () => {
    // No pause, no complete, no goodbye: the tab is simply gone. The only thing
    // that can save these Wins is that they were already written.
    const before = await winsOnRecord();
    const beforeRow = await session();
    const pending = pendingTopicKey(beforeRow);
    expect(pending).not.toBeNull();

    const reopened = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: experienceId,
        subjectLabel: EMPLOYER,
        entryPoint: 'log_menu',
    });

    expect(reopened).toMatchObject({ success: true });
    if (!reopened.success) return;

    expect(reopened.data.sessionId).toBe(sessionId);
    expect(reopened.data.resumed).toBe(true);
    // Picks the pending question back up rather than asking a fresh one.
    expect(reopened.data.turn.question).toBe(QUESTION_BY_TOPIC.quantify);
    expect(reopened.data.turn.captured.map((card) => card.winId).sort()).toEqual(
        before.map((record) => record.id).sort(),
    );

    const afterRow = await session();
    expect(afterRow.questionCount).toBe(beforeRow.questionCount);
    expect(pendingTopicKey(afterRow)).toBe(pending);

    // Every draft survived, and re-entering did not charge a second session.
    const after = await winsOnRecord();
    expect(after.map((record) => record.id).sort()).toEqual(before.map((record) => record.id).sort());
    expect(after.every((record) => record.status === WinStatus.draft)).toBe(true);
    expect(await usedContextInterviews()).toBe(1);

    const resumed = await prisma.funnelEvent.count({
        where: { userId: journey.userId, type: 'backfill_resumed' },
    });
    expect(resumed).toBe(1);
    expect(
        await prisma.funnelEvent.count({
            where: { userId: journey.userId, type: 'backfill_started' },
        }),
    ).toBe(1);
});

test('a deliberate pause is resumable on the same terms', async () => {
    const paused = await backfill.pauseBackfillSession(sessionId);
    expect(paused).toMatchObject({ success: true });
    expect((await session()).status).toBe(InterviewStatus.paused);

    const abandoned = await prisma.funnelEvent.findFirst({
        where: { userId: journey.userId, type: 'backfill_abandoned' },
    });
    expect((abandoned?.payload as Record<string, unknown>)?.capturedSoFar).toBe(2);

    const reopened = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: experienceId,
        subjectLabel: EMPLOYER,
        entryPoint: 'log_menu',
    });
    expect(reopened).toMatchObject({ success: true });
    if (!reopened.success) return;

    expect(reopened.data.sessionId).toBe(sessionId);
    expect((await session()).status).toBe(InterviewStatus.active);
    expect(reopened.data.turn.question).toBe(QUESTION_BY_TOPIC.quantify);
    expect(await winsOnRecord()).toHaveLength(2);
});

// ═══════════════════════════ 4. no figure the user did not state — the hard gate

test('an invented metric writes no ImpactMetric row at all, not a partial one', async () => {
    // The answer contains no figure of any kind. The model returns four.
    const answer = 'We cut down the support load a lot after the migration.';
    nextExtraction = {
        ...NOTHING,
        vague: false,
        wins: [
            win({
                title: 'Cut the weekly support load',
                narrative: 'Fewer tickets reached the on-call rota after the migration.',
                category: 'improved',
                quantified: true,
                impact: {
                    metric: 'weekly support tickets',
                    baseline: '400 a week',
                    result: '120 a week',
                    delta: '-70%',
                    scope: 'the whole support rota',
                    timeframe: 'one quarter',
                },
                excerpt: answer,
            }),
        ],
    };

    const turn = await backfill.answerBackfill({ sessionId, answer });
    expect(turn).toMatchObject({ success: true });
    if (!turn.success) return;

    const rows = await winsOnRecord();
    expect(rows.length).toBe(3);
    const captured = rows[2];
    expect(captured.title).toBe('Cut the weekly support load');

    // Not a metric with blanks in it. No metric.
    expect(await prisma.impactMetric.count({ where: { userId: journey.userId } })).toBe(0);
    expect(captured.impactMetricId).toBeNull();

    // And the rail must not claim a number it does not have.
    const card = turn.data.captured.find((entry) => entry.winId === captured.id);
    expect(card?.quantified).toBe(false);
    expect(card?.metricLabel).toBeNull();

    assertNoFabricatedNumbers(`${captured.title} ${captured.narrative}`, answer);
});

test('a figure derived from two real figures is dropped; both real figures survive', async () => {
    // 800ms and 180ms are the user's. 77% is arithmetic the model did — which is
    // a fabricated number even though every input to it was real.
    const answer = 'Checkout latency went from 800ms to 180ms after the caching work.';
    nextExtraction = {
        ...NOTHING,
        vague: false,
        wins: [
            win({
                title: 'Cut checkout latency',
                narrative: 'Checkout latency went from 800ms to 180ms.',
                category: 'improved',
                quantified: true,
                impact: {
                    metric: 'checkout latency',
                    baseline: '800ms',
                    result: '180ms',
                    delta: '77%',
                    scope: null,
                    timeframe: null,
                },
                excerpt: answer,
            }),
        ],
    };

    const turn = await backfill.answerBackfill({ sessionId, answer });
    expect(turn).toMatchObject({ success: true });
    if (!turn.success) return;

    const rows = await winsOnRecord();
    expect(rows.length).toBe(4);
    const quantified = rows[3];
    expect(quantified.title).toBe('Cut checkout latency');

    const metrics = await prisma.impactMetric.findMany({ where: { userId: journey.userId } });
    expect(metrics.length).toBe(1);
    const metric = metrics[0];

    expect(metric.subjectId).toBe(quantified.id);
    expect(quantified.impactMetricId).toBe(metric.id);
    // The two the user actually said.
    expect(metric.baseline).toBe('800ms');
    expect(metric.result).toBe('180ms');
    // The one they did not.
    expect(metric.delta ?? '').not.toContain('77');
    expect(metric.delta ?? '').toBe('');

    assertNoFabricatedNumbers(
        [metric.metric, metric.baseline, metric.result, metric.delta, metric.scope, metric.timeframe]
            .filter(Boolean)
            .join(' '),
        answer,
    );
});

// ══════════════════════════════════════════ 5. "I don't remember" is a real answer

test('"I don\'t remember" advances the interview and its topic is never re-asked', async () => {
    const before = await session();
    const skipped = pendingTopicKey(before);
    expect(skipped).not.toBeNull();
    expect(skipped?.startsWith('quantify:')).toBe(true);
    const alreadyAsked = new Set(askedTopics(before));

    nextExtraction = NOTHING;
    const turn = await backfill.answerBackfill({ sessionId, dontRemember: true });
    expect(turn).toMatchObject({ success: true });
    if (!turn.success) return;

    // Nothing captured, nothing invented, and the conversation moved on.
    expect(await winsOnRecord()).toHaveLength(4);
    expect(turn.data.question).not.toBeNull();

    const after = await session();
    expect(askedTopics(after)).toContain(skipped as string);
    // The abandoned thread is closed for good, and whatever comes next is a
    // question this session has never asked.
    const nowPending = pendingTopicKey(after);
    expect(nowPending).not.toBe(skipped);
    expect(alreadyAsked.has(nowPending as string)).toBe(false);

    const answered = await prisma.funnelEvent.findFirst({
        where: { userId: journey.userId, type: 'backfill_question_answered' },
        orderBy: { occurredAt: 'desc' },
    });
    expect((answered?.payload as Record<string, unknown>)?.saidDontRemember).toBe(true);

    // The record of what was asked never contains a duplicate — which is the
    // mechanism, not a side effect: `askedTopics` is what a resumed session
    // consults, so a repeat here is a repeat after every resume.
    const keys = askedTopics(after);
    expect(new Set(keys).size).toBe(keys.length);
});

// ══════════════════════════════════════════ 6. confidential never leaves the record

test('confidential work is marked inline and never gets a vector', async () => {
    const answer = 'I ran the incident response for the unreleased payments product before launch.';
    nextExtraction = {
        ...NOTHING,
        vague: false,
        wins: [
            win({
                title: 'Ran the incident response before launch',
                narrative: 'Coordinated the response ahead of the launch.',
                category: 'led',
                // The model proposes shareable. The keyword detector overrules it.
                suggestedSensitivity: 'shareable',
                excerpt: answer,
            }),
        ],
    };

    const turn = await backfill.answerBackfill({ sessionId, answer });
    expect(turn).toMatchObject({ success: true });
    if (!turn.success) return;

    // Naming the protection out loud is half the feature (PRD 07 §8).
    expect(turn.data.notices.some((notice) => notice.kind === 'sensitivity')).toBe(true);

    const rows = await winsOnRecord();
    expect(rows.length).toBe(5);
    const confidential = rows[4];
    expect(confidential.sensitivity).toBe(WinSensitivity.confidential);
    expect(agent.detectSensitivity(answer)?.sensitivity).toBe(WinSensitivity.confidential);

    await drainJobs();
    await assertNoVector(confidential.id);
});

// ══════════════════════════════════════════════ 7. nothing was confirmed for them

test('nothing in the session was auto-confirmed', async () => {
    const rows = await winsOnRecord();
    expect(rows.length).toBe(5);
    expect(rows.every((record) => record.status === WinStatus.draft)).toBe(true);
    expect(rows.every((record) => record.confirmedAt === null)).toBe(true);

    const evidence = await prisma.evidence.findMany({ where: { userId: journey.userId } });
    expect(evidence.length).toBe(5);
    expect(evidence.every((item) => item.confirmedByUser === false)).toBe(true);

    const links = await prisma.claimLink.findMany({ where: { userId: journey.userId } });
    expect(links.length).toBe(5);
    expect(links.every((link) => link.groundState === GroundState.needs_confirmation)).toBe(true);
});

// ═══════════════════════════════════ 8. the closing screen, and the record extends

test('the closing screen counts rows, and confirming is what grounds them', async () => {
    const closing = await backfill.completeBackfillSession(sessionId);
    expect(closing).toMatchObject({ success: true });
    if (!closing.success) return;

    const rows = await winsOnRecord();
    expect(closing.data.summary.winsCaptured).toBe(rows.length);
    expect(closing.data.summary.quantifiedCount).toBe(
        rows.filter((record) => record.impactMetricId !== null).length,
    );
    expect(closing.data.summary.confidentialCount).toBe(1);
    expect(closing.data.summary.subjectLabel).toBe(EMPLOYER);
    expect(closing.data.lines[0]).toContain(`${rows.length} wins from ${EMPLOYER}`);
    // Every figure on the payoff screen is counted, never estimated.
    assertNoFabricatedNumbers(
        closing.data.lines.join(' '),
        `${rows.length} ${closing.data.summary.quantifiedCount} ${closing.data.summary.crossTeamCount} ${closing.data.summary.priorHighlightCount}`,
    );
    expect((await session()).status).toBe(InterviewStatus.completed);

    // Still drafts: winding down is not confirming.
    expect((await winsOnRecord()).every((record) => record.status === WinStatus.draft)).toBe(true);

    const confirmed = await backfill.confirmAllFromSession(sessionId);
    expect(confirmed).toMatchObject({ success: true });
    if (!confirmed.success) return;
    expect(confirmed.data.confirmed).toBe(rows.length);
    expect(confirmed.data.failed).toBe(0);

    const after = await winsOnRecord();
    expect(after.every((record) => record.status === WinStatus.confirmed)).toBe(true);
    for (const record of after) await assertGrounded(record.id);

    // The record now extends backwards: 2023, not today.
    for (const record of after) {
        expect(record.occurredAt.getTime()).toBeGreaterThanOrEqual(PERIOD_START.getTime());
        expect(record.occurredAt.getTime()).toBeLessThanOrEqual(PERIOD_END.getTime());
    }

    await drainJobs();
    for (const record of after) {
        if (record.sensitivity === WinSensitivity.shareable) await assertHasVector(record.id);
        else await assertNoVector(record.id);
    }

    // Re-confirming is a no-op, not a second Evidence/ClaimLink pair.
    const linksBefore = await prisma.claimLink.count({ where: { userId: journey.userId } });
    await backfill.confirmAllFromSession(sessionId);
    expect(await prisma.claimLink.count({ where: { userId: journey.userId } })).toBe(linksBefore);
});

// ═══════════════════════════════════════════════════════════════ 9. teardown

test('the journey leaves no dead jobs and nothing behind', async () => {
    await assertNoDeadJobs(journey.runId);
    await purge(journey.runId);
    expect(await assertPurged(journey.runId)).toEqual({});
});
