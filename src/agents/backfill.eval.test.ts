/**
 * THE BACKFILL LAUNCH GATE (PRD 07 §8, §9).
 *
 * Sixteen scripted interviews run end to end against the real database, with
 * both model calls replaced by an adversarial script. Two assertions in here
 * are hard gates rather than tests — if either goes red the feature does not
 * ship, because the failure is not a bug in the code, it is the product making
 * something up on a resume:
 *
 *   GATE 1 — no question shown to a user leads a number.
 *   GATE 2 — no `ImpactMetric` row contains a figure the user did not state.
 *
 * Both are asserted over whole conversations, against what was actually
 * persisted, not against the model's proposal. That distinction is the point:
 * roughly half the scripted models in the corpus misbehave and never correct
 * themselves, so a green run means the *system* held the line, not that the
 * script happened to be well-behaved.
 *
 * Only the two model calls and the near-duplicate embedding are faked. Postgres
 * is real.
 */

import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { InterviewStatus, WinSensitivity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { extractQuantities, flattenQuantities, isQuantitySupported } from '@/lib/ai/guard';
import { __testing as aiTesting, type ObjectRunner } from '@/lib/ai/structured';
import { __testing as draftTesting } from '@/services/winDrafting';
import { cleanupTestUser, makeExperience, newTestUserId } from '@/services/winFixtures.test-utils';
import {
    BACKFILL_EXTRACT_SYSTEM,
    HARD_CAP_QUESTIONS,
    MIN_QUESTIONS,
    TARGET_QUESTIONS,
    allowedQuantitySource,
    checkQuestion,
    runBackfillTurn,
    startBackfill,
    type BackfillNotice,
} from '@/agents/backfillAgent';
import { getSessionTool, type TranscriptTurn } from '@/agents/tools/backfill';
import {
    EVAL_TRANSCRIPTS,
    type EvalTranscript,
} from '@/agents/backfill.eval-corpus.test-utils';

// ─────────────────────────────────────────────────────────────── clerk seam
//
// `createWinFromText` resolves its user from Clerk. Everything else in the
// agent takes an explicit userId, which is why only this one hop needs faking.

let currentUserId: string | null = null;
mock.module('@clerk/nextjs/server', () => ({
    auth: async () => ({ userId: currentUserId }),
}));

// ─────────────────────────────────────────────────────────── the scripted model

const RETRY_MARKER = 'Your previous attempt broke these rules';
const GUARD_MARKER = 'Your previous response contained quantities';

let script: EvalTranscript | null = null;
let questionCursor = 0;

/** The answer the extraction prompt is about, read back out of the prompt. */
function answerFromPrompt(prompt: string): string {
    const match = /"""\n([\s\S]*?)\n"""/.exec(prompt);
    return match ? match[1].trim() : '';
}

const scriptedRunner: ObjectRunner = async ({ system, prompt }) => {
    if (!script) throw new Error('eval: no transcript loaded');
    const usage = { inputTokens: 100, outputTokens: 60 };

    if (system === BACKFILL_EXTRACT_SYSTEM) {
        const answer = answerFromPrompt(prompt);
        const scripted = script.answers.find((entry) => entry.answer.trim() === answer);
        if (!scripted) return { object: emptyExtraction(), ...usage };
        const isGuardRetry = prompt.includes(GUARD_MARKER);
        return {
            object: isGuardRetry ? (scripted.extractionRetry ?? scripted.extraction) : scripted.extraction,
            ...usage,
        };
    }

    // Conversational turn. A rejected attempt comes back with the violations
    // named; the script decides whether this model is one that learns.
    const isRetry = prompt.includes(RETRY_MARKER);
    const scripted = script.questions[Math.min(questionCursor, script.questions.length - 1)];
    if (isRetry) {
        return { object: scripted.retry ?? scripted, ...usage };
    }
    questionCursor += 1;
    return {
        object: { acknowledgement: scripted.acknowledgement, question: scripted.question },
        ...usage,
    };
};

function emptyExtraction() {
    return {
        wins: [],
        metricForPreviousWin: null,
        saidDontRemember: false,
        vague: true,
        coveredTopics: [],
    };
}

// ───────────────────────────────────────────────────────────────── harness

const users: string[] = [];
const sessions: string[] = [];

beforeAll(() => {
    aiTesting.setObjectRunner(scriptedRunner);
    aiTesting.setUsageLogger(async () => {});
    // No vector store round trip for the near-duplicate probe; a throw means
    // "not a duplicate", which is the behaviour we want in an eval.
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterAll(async () => {
    aiTesting.reset();
    draftTesting.reset();
    if (sessions.length > 0) {
        await prisma.interviewSession.deleteMany({ where: { id: { in: sessions } } });
    }
    for (const userId of users) await cleanupTestUser(userId);
});

afterEach(() => {
    script = null;
    questionCursor = 0;
});

type RunOutcome = {
    userId: string;
    sessionId: string;
    transcript: TranscriptTurn[];
    notices: BackfillNotice[];
    questionsAsked: number;
    capturedIds: string[];
    /** True when the agent wound the interview down on its own. */
    woundDown: boolean;
};

/** Drive one scripted interview to completion (or to the answers running out). */
async function runTranscript(entry: EvalTranscript): Promise<RunOutcome> {
    script = entry;
    questionCursor = 0;

    const userId = newTestUserId(`eval-${entry.id}`);
    users.push(userId);
    currentUserId = userId;

    const experience = await makeExperience({
        userId,
        company: entry.company,
        role: entry.role,
        startDate: entry.startDate,
        endDate: entry.endDate,
    });

    const opened = await startBackfill({
        userId,
        subjectType: 'employer',
        subjectId: experience.id,
        subjectLabel: entry.company,
    });
    if (!opened.success) throw new Error(`eval: could not open ${entry.id}: ${opened.error}`);
    sessions.push(opened.data.sessionId);

    const notices: BackfillNotice[] = [];
    let woundDown = false;

    for (const scripted of entry.answers) {
        const turn = await runBackfillTurn({
            userId,
            sessionId: opened.data.sessionId,
            answer: scripted.answer,
        });
        if (!turn.success) throw new Error(`eval: turn failed in ${entry.id}: ${turn.error}`);
        notices.push(...turn.data.notices);
        if (turn.data.done) {
            woundDown = true;
            break;
        }
    }

    const session = await getSessionTool({ userId, sessionId: opened.data.sessionId });
    if (!session.success) throw new Error('eval: session vanished');

    return {
        userId,
        sessionId: opened.data.sessionId,
        transcript: session.data.transcript,
        notices,
        questionsAsked: session.data.questionCount,
        capturedIds: session.data.captured.map((win) => win.winId),
        woundDown,
    };
}

// ═══════════════════════════════════════════════════════════ the two gates

describe('backfill eval corpus', () => {
    test('the corpus is large enough to mean something', () => {
        expect(EVAL_TRANSCRIPTS.length).toBeGreaterThanOrEqual(15);
        // Every entry documents what it is for; an eval nobody can read is an
        // eval nobody maintains.
        for (const entry of EVAL_TRANSCRIPTS) expect(entry.proves.length).toBeGreaterThan(10);
    });
});

describe('GATE 1 — no question leads a number', () => {
    for (const entry of EVAL_TRANSCRIPTS) {
        test(`${entry.id}: ${entry.proves}`, async () => {
            const outcome = await runTranscript(entry);

            // Judged incrementally: a question may only echo figures the user
            // had already said WHEN IT WAS ASKED. A later answer cannot
            // retroactively justify an earlier question.
            const seen: TranscriptTurn[] = [];
            const offenders: { question: string; violations: unknown[] }[] = [];

            for (const turn of outcome.transcript) {
                if (turn.role === 'agent') {
                    const violations = checkQuestion(turn.content, {
                        sourceText: allowedQuantitySource({
                            transcript: seen,
                            subjectLabel: entry.company,
                        }),
                    });
                    if (violations.length > 0) {
                        offenders.push({ question: turn.content, violations });
                    }
                }
                seen.push(turn);
            }

            expect(offenders).toEqual([]);
            expect(outcome.transcript.some((turn) => turn.role === 'agent')).toBe(true);
        });
    }
});

describe('GATE 2 — no ImpactMetric contains a figure the user did not state', () => {
    for (const entry of EVAL_TRANSCRIPTS) {
        test(`${entry.id}`, async () => {
            const outcome = await runTranscript(entry);

            const spoken = outcome.transcript
                .filter((turn) => turn.role === 'user')
                .map((turn) => turn.content)
                .join('\n');
            const supported = flattenQuantities(extractQuantities(spoken, 'lenient'));

            const metrics = await prisma.impactMetric.findMany({
                where: { userId: outcome.userId },
            });

            const fabrications: { field: string; raw: string; statement: string }[] = [];
            for (const metric of metrics) {
                const fields: [string, string | null][] = [
                    ['metric', metric.metric],
                    ['baseline', metric.baseline],
                    ['result', metric.result],
                    ['delta', metric.delta],
                    ['scope', metric.scope],
                    ['timeframe', metric.timeframe],
                ];
                for (const [name, value] of fields) {
                    if (!value) continue;
                    for (const quantity of extractQuantities(value, 'strict')) {
                        if (quantity.kind === 'year' || quantity.kind === 'date') continue;
                        if (isQuantitySupported(quantity, supported)) continue;
                        fabrications.push({
                            field: name,
                            raw: quantity.raw,
                            statement: metric.statement,
                        });
                    }
                }
            }

            expect(fabrications).toEqual([]);
        });
    }
});

// ═══════════════════════════════════════════════════ the behaviours behind them

describe('specific failures the corpus is built to catch', () => {
    test('a fabricated metric produces a Win with no metric at all, not a corrected one', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'fabricated-metric')!;
        const outcome = await runTranscript(entry);

        const wins = await prisma.win.findMany({ where: { userId: outcome.userId } });
        expect(wins.length).toBeGreaterThan(0);

        // The honest end state is no figure, never a half-populated metric.
        const metrics = await prisma.impactMetric.findMany({ where: { userId: outcome.userId } });
        expect(metrics).toEqual([]);
        expect(wins.every((win) => win.impactMetricId === null)).toBe(true);
    });

    test('a derived percentage is dropped while the two real figures survive', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'derived-percentage')!;
        const outcome = await runTranscript(entry);

        const metric = await prisma.impactMetric.findFirst({ where: { userId: outcome.userId } });
        expect(metric).not.toBeNull();
        expect(metric?.baseline).toBe('40 minutes');
        expect(metric?.result).toBe('12 minutes');
        // -70% is arithmetic the user never did out loud.
        expect(metric?.delta ?? '').not.toContain('70');
    });

    test('an incorrigible model falls back to a scripted question rather than shipping a bad one', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'leading-number-incorrigible')!;
        const outcome = await runTranscript(entry);

        const questions = outcome.transcript
            .filter((turn) => turn.role === 'agent')
            .map((turn) => turn.content);

        expect(questions.length).toBeGreaterThan(0);
        for (const question of questions) {
            expect(question).not.toContain('Would you say');
            expect(question).not.toContain('roughly');
            expect(question).not.toContain('ballpark');
        }
    });

    test('flattery never reaches the transcript', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'flattery')!;
        const outcome = await runTranscript(entry);

        const agentText = outcome.transcript
            .filter((turn) => turn.role === 'agent')
            .map((turn) => turn.content)
            .join(' ');
        expect(agentText).not.toMatch(/impressive|amazing|wow/i);
        expect(agentText).not.toContain('!');
    });

    test('confidential work is flagged and the protection is named inline', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'confidential')!;
        const outcome = await runTranscript(entry);

        const wins = await prisma.win.findMany({ where: { userId: outcome.userId } });
        expect(wins.some((win) => win.sensitivity === WinSensitivity.confidential)).toBe(true);
        // Setting the flag silently protects the data and loses the conversation.
        expect(outcome.notices.some((notice) => notice.kind === 'sensitivity')).toBe(true);
    });

    test('internal-only work says what it means for the resume', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'internal-only')!;
        const outcome = await runTranscript(entry);

        const wins = await prisma.win.findMany({ where: { userId: outcome.userId } });
        expect(wins.some((win) => win.sensitivity !== WinSensitivity.shareable)).toBe(true);
        const notice = outcome.notices.find((entry_) => entry_.kind === 'sensitivity');
        expect(notice?.message).toContain("won't go on a resume");
    });

    test('a paragraph dump becomes several drafts, not one', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'paragraph-dump')!;
        const outcome = await runTranscript(entry);

        const wins = await prisma.win.findMany({ where: { userId: outcome.userId } });
        expect(wins.length).toBeGreaterThanOrEqual(3);
    });

    test('"I don\'t remember" advances without a re-ask', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'dont-remember')!;
        const outcome = await runTranscript(entry);

        const questions = outcome.transcript
            .filter((turn) => turn.role === 'agent')
            .map((turn) => turn.content);
        expect(new Set(questions).size).toBe(questions.length);

        const topics = outcome.transcript
            .filter((turn) => turn.role === 'agent' && turn.topic)
            .map((turn) => turn.topic as string);
        expect(new Set(topics).size).toBe(topics.length);
    });

    test('a later figure updates the metric rather than stacking a second one', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'metric-supersedes')!;
        const outcome = await runTranscript(entry);

        const metrics = await prisma.impactMetric.findMany({ where: { userId: outcome.userId } });
        expect(metrics.length).toBe(1);
        expect(metrics[0]?.result).toBe('5 days');
    });

    test('the interview winds down before the hard cap however long the user talks', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'long-session-winds-down')!;
        const outcome = await runTranscript(entry);

        expect(outcome.woundDown).toBe(true);
        expect(outcome.questionsAsked).toBeLessThanOrEqual(HARD_CAP_QUESTIONS);
        expect(outcome.questionsAsked).toBeGreaterThanOrEqual(MIN_QUESTIONS);
        expect(outcome.questionsAsked).toBeLessThanOrEqual(TARGET_QUESTIONS);
    });
});

// ═══════════════════════════════════════════════════ capture-time persistence

describe('a dropped session loses nothing', () => {
    test('the Win exists as a draft after the answer, not after the session', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'clean-two-year-employer')!;
        script = entry;
        questionCursor = 0;

        const userId = newTestUserId('eval-persistence');
        users.push(userId);
        currentUserId = userId;

        const experience = await makeExperience({
            userId,
            company: entry.company,
            role: entry.role,
            startDate: entry.startDate,
            endDate: entry.endDate,
        });

        const opened = await startBackfill({
            userId,
            subjectType: 'employer',
            subjectId: experience.id,
            subjectLabel: entry.company,
        });
        expect(opened.success).toBe(true);
        if (!opened.success) return;
        sessions.push(opened.data.sessionId);

        // One answer, then stop dead — the browser has been killed.
        const turn = await runBackfillTurn({
            userId,
            sessionId: opened.data.sessionId,
            answer: entry.answers[0].answer,
        });
        expect(turn.success).toBe(true);

        const wins = await prisma.win.findMany({ where: { userId } });
        expect(wins.length).toBe(2);
        // Never auto-confirmed — the closing screen is a review step (rule 5).
        expect(wins.every((win) => win.status === 'draft')).toBe(true);
        expect(wins.every((win) => win.source === 'backfill')).toBe(true);

        // Their own words are the evidence, and it is unconfirmed until they say so.
        const evidence = await prisma.evidence.findMany({ where: { userId } });
        expect(evidence.length).toBe(2);
        expect(evidence.every((row) => row.kind === 'interview_assertion')).toBe(true);
        expect(evidence.every((row) => row.confirmedByUser === false)).toBe(true);

        const links = await prisma.claimLink.findMany({ where: { userId } });
        expect(links.length).toBe(2);
        expect(links.every((link) => link.groundState === 'needs_confirmation')).toBe(true);

        // And the session is still resumable, holding the same cards.
        const session = await getSessionTool({ userId, sessionId: opened.data.sessionId });
        expect(session.success).toBe(true);
        if (session.success) {
            expect(session.data.status).toBe(InterviewStatus.active);
            expect(session.data.captured.length).toBe(2);
        }
    });

    test('a recovered win is dated inside the employer period, not today', async () => {
        const entry = EVAL_TRANSCRIPTS.find((item) => item.id === 'clean-two-year-employer')!;
        script = entry;
        questionCursor = 0;

        const userId = newTestUserId('eval-dating');
        users.push(userId);
        currentUserId = userId;

        const experience = await makeExperience({
            userId,
            company: entry.company,
            role: entry.role,
            startDate: '2023-01',
            endDate: '2025-01',
        });
        const opened = await startBackfill({
            userId,
            subjectType: 'employer',
            subjectId: experience.id,
            subjectLabel: entry.company,
        });
        if (!opened.success) throw new Error(opened.error);
        sessions.push(opened.data.sessionId);

        await runBackfillTurn({
            userId,
            sessionId: opened.data.sessionId,
            answer: entry.answers[0].answer,
        });

        const wins = await prisma.win.findMany({ where: { userId } });
        expect(wins.length).toBeGreaterThan(0);
        for (const win of wins) {
            expect(win.occurredAt.getUTCFullYear()).toBeGreaterThanOrEqual(2023);
            expect(win.occurredAt.getUTCFullYear()).toBeLessThanOrEqual(2025);
            expect(win.employerId).toBe(experience.id);
        }
    });
});
