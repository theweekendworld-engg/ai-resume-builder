/**
 * Telegram → Scout routing and the Telegram notifier, against the local
 * Postgres and the transport-level Telegram mock. Scout itself is replaced
 * through the channel deps seam, so no pipeline, fetch or model runs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, GenerationStatus } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { prisma } from '@/lib/prisma';
import { __testing as depsTesting, type ScoutChannelDeps } from '@/lib/channels/scoutDeps';
import { notifyTelegramScout } from '@/lib/channels/telegramScout';
import { __testing as telegramTesting } from '@/lib/telegram';
import { inertInboxDeps, view } from '@/lib/channels/testViews.test-utils';
import { processTelegramUpdate } from './telegramAgent';

const RUN = `itest-tg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const CHAT = String(Date.now()).slice(-9);
let updateId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);

let telegram: MockTelegram;
let started: Array<Record<string, unknown>> = [];

function fakeDeps(overrides: Partial<ScoutChannelDeps> = {}): ScoutChannelDeps {
    return {
        isScoutEnabled: async () => true,
        startScoutRun: async (params) => {
            started.push(params as unknown as Record<string, unknown>);
            return { success: true, data: { run: view({ status: 'queued' }), created: true } };
        },
        findOpenQuestionRun: async () => null,
        getScoutRun: async () => ({ success: true, data: view() }),
        answerScoutQuestion: async () => ({ success: true, data: view() }),
        draftScoutOutreach: async () => ({ success: false, error: 'n/a' }),
        refreshScoutRun: async () => ({ success: true, data: view() }),
        ...inertInboxDeps(),
        ...overrides,
    };
}

function textUpdate(text: string) {
    updateId += 1;
    return { update_id: updateId, message: { message_id: 1, text, chat: { id: CHAT } } };
}

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    await prisma.channelIdentity.create({ data: { userId: USER, channel: Channel.telegram, externalId: CHAT, verified: true } });
});

beforeEach(() => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    started = [];
    depsTesting.setDeps(fakeDeps());
});

afterEach(() => {
    depsTesting.reset();
});

afterAll(async () => {
    telegramTesting.reset();
    await prisma.generationSession.deleteMany({ where: { userId: USER } });
    await prisma.agentRun.deleteMany({ where: { userId: USER } });
    await prisma.channelIdentity.deleteMany({ where: { userId: USER } });
});

const RELOCATE = {
    id: 'pref.relocate', step: 'fit', prompt: 'Would you relocate?',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'case_by_case', label: 'Depends on the role' }],
    askedAt: new Date().toISOString(),
};
/** An open-ended question asked just now. */
const OPEN_LOCATION = () => ({ id: 'pref.location', step: 'fit', prompt: 'Where are you based?', askedAt: new Date().toISOString() });

describe('routing', () => {
    test('a shared link starts Scout with the progress message id', async () => {
        await processTelegramUpdate(textUpdate('https://www.linkedin.com/jobs/view/4455902670'));
        expect(started).toHaveLength(1);
        const firstSend = telegram.sent[0];
        expect(firstSend.text).toContain('Reading the link');
        expect(started[0]).toMatchObject({
            userId: USER,
            channel: 'telegram',
            channelRef: { chatId: CHAT, messageId: firstSend.body.__message_id },
            input: { url: 'https://www.linkedin.com/jobs/view/4455902670', text: null, source: 'telegram' },
        });
    });

    test('/scout <link> works, and /scout alone shows usage', async () => {
        await processTelegramUpdate(textUpdate('/scout https://www.linkedin.com/posts/someone_hiring-activity-1'));
        expect(started).toHaveLength(1);
        await processTelegramUpdate(textUpdate('/scout'));
        expect(started).toHaveLength(1);
        expect(telegram.sent.at(-1)?.text).toContain('Usage: /scout');
    });

    test('a long pasted post (no link) starts Scout as text', async () => {
        const post = `We are hiring backend engineers in Bengaluru. ${'Details about the role and team. '.repeat(10)}`;
        await processTelegramUpdate(textUpdate(post));
        expect(started).toHaveLength(1);
        expect((started[0].input as { text: string }).text).toContain('We are hiring');
    });

    // Audit 2026-09-27: an open /generate clarification swallowed EVERY later
    // message, a job link sent days later included. Now a link goes to Scout,
    // and the open question is mentioned so it is not forgotten.
    test('a job link during an open resume clarification goes to Scout, and the question is mentioned', async () => {
        const session = await prisma.generationSession.create({
            data: {
                userId: USER, jobDescription: 'jd', channel: Channel.telegram, status: GenerationStatus.awaiting_clarification,
                clarifications: { questions: [{ id: 'q1', question: 'Have you used Kafka?', gap: 'Kafka' }], answers: {} },
            },
        });
        try {
            await processTelegramUpdate(textUpdate('https://www.linkedin.com/jobs/view/4455902670'));
            expect(started).toHaveLength(1);
            expect(telegram.sent.at(-1)?.text).toContain('Have you used Kafka?');
        } finally {
            await prisma.generationSession.delete({ where: { id: session.id } });
        }
    });

    test('a short, recent reply still answers the open resume clarification', async () => {
        const session = await prisma.generationSession.create({
            data: { userId: USER, jobDescription: 'jd', channel: Channel.telegram, status: GenerationStatus.awaiting_clarification, clarifications: {} },
        });
        try {
            await processTelegramUpdate(textUpdate('yes, 2 years of Kafka at Plivo'));
            expect(started).toHaveLength(0);
            // The clarification branch answered (this empty payload is invalid, so it errors),
            // proving the message went there and not to Scout.
            expect(telegram.sent.at(-1)?.text).toContain('Clarification state is invalid');
        } finally {
            await prisma.generationSession.delete({ where: { id: session.id } });
        }
    });

    test('"skip" skips the clarification instead of being stored as the answer', async () => {
        const session = await prisma.generationSession.create({
            data: {
                userId: USER, jobDescription: 'jd', channel: Channel.telegram, status: GenerationStatus.awaiting_clarification,
                clarifications: { questions: [{ id: 'q1', question: 'Have you used Kafka?', gap: 'Kafka' }], answers: {} },
            },
        });
        try {
            await processTelegramUpdate(textUpdate('skip'));
            expect(started).toHaveLength(0);
            const fresh = await prisma.generationSession.findUniqueOrThrow({ where: { id: session.id } });
            const answers = (fresh.clarifications as { answers?: Record<string, string> } | null)?.answers ?? {};
            expect(answers.q1).not.toBe('skip');
        } finally {
            await prisma.generationSession.delete({ where: { id: session.id } });
        }
    });

    test('a short reply answers an open Scout question', async () => {
        const answers: string[] = [];
        depsTesting.setDeps(fakeDeps({
            findOpenQuestionRun: async () => view({ status: 'awaiting_input', pendingQuestion: OPEN_LOCATION() }),
            answerScoutQuestion: async (_u, _r, value) => {
                answers.push(value);
                return { success: true, data: view() };
            },
        }));
        await processTelegramUpdate(textUpdate('Bengaluru'));
        expect(answers).toEqual(['Bengaluru']);
    });

    test('chatter ("hello") with no open question gets the short help, not a run', async () => {
        await processTelegramUpdate(textUpdate('hello'));
        expect(started).toHaveLength(0);
        expect(telegram.sent.at(-1)?.text).toContain('what you worked on');
    });

    test('a short note about your work is recorded as a Scout run', async () => {
        await processTelegramUpdate(textUpdate('shipped retry queue, p99 down 40%'));
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({ input: { url: null, text: 'shipped retry queue, p99 down 40%', source: 'telegram' } });
        expect(telegram.sent[0].text).toContain('Recording that');
    });

    // Production, 2026-09-26: a work note sent while "Would you relocate?"
    // was open was recorded as the answer, and the note was lost.
    test('a note while an option question is open starts a new run, and the question stays open', async () => {
        const answers: string[] = [];
        depsTesting.setDeps(fakeDeps({
            findOpenQuestionRun: async () => view({ status: 'awaiting_input', pendingQuestion: RELOCATE }),
            answerScoutQuestion: async (_u, _r, value) => {
                answers.push(value);
                return { success: true, data: view() };
            },
        }));
        await processTelegramUpdate(textUpdate('Cut webhook latency by moving Scout runs onto the workflow runtime'));
        expect(answers).toEqual([]);
        expect(started).toHaveLength(1);
    });

    test('"yeah" answers the open option question with its canonical value', async () => {
        const answers: string[] = [];
        depsTesting.setDeps(fakeDeps({
            findOpenQuestionRun: async () => view({ status: 'awaiting_input', pendingQuestion: RELOCATE }),
            answerScoutQuestion: async (_u, _r, value) => {
                answers.push(value);
                return { success: true, data: view() };
            },
        }));
        await processTelegramUpdate(textUpdate('yeah'));
        expect(answers).toEqual(['yes']);
        expect(started).toHaveLength(0);
    });

    test('an open resume clarification keeps precedence over a note too', async () => {
        const session = await prisma.generationSession.create({
            data: { userId: USER, jobDescription: 'jd', channel: Channel.telegram, status: GenerationStatus.awaiting_clarification, clarifications: {} },
        });
        try {
            await processTelegramUpdate(textUpdate('shipped retry queue, p99 down 40%'));
            expect(started).toHaveLength(0);
            expect(telegram.sent.at(-1)?.text).toContain('Clarification state is invalid');
        } finally {
            await prisma.generationSession.delete({ where: { id: session.id } });
        }
    });

    test('/jobs lists top fits; an empty inbox explains what to send', async () => {
        await processTelegramUpdate(textUpdate('/jobs'));
        expect(telegram.sent.at(-1)?.text).toContain('No jobs to review yet');

        depsTesting.setDeps(fakeDeps({
            topFits: async () => [{
                workspaceId: 'w1', runId: 'cmue6z09b000965hljys7gv7l', company: 'Nightfall AI', role: 'Backend Engineer',
                location: 'Bengaluru, Karnataka, India', workMode: null, fitScore: 72, verdict: 'possible', status: 'analyzed',
                column: 'to_review', sourceUrl: null, compHint: null, topStrength: null, topConcern: null, createdAt: '', updatedAt: '',
            }],
        }));
        await processTelegramUpdate(textUpdate('/jobs'));
        const text = telegram.sent.at(-1)?.text ?? '';
        expect(text).toContain('Backend Engineer @ Nightfall AI');
        expect(text).toContain('72 · Bengaluru');
        expect(text).toContain('/scout/cmue6z09b000965hljys7gv7l');
    });

    test('/help works before the account is linked', async () => {
        updateId += 1;
        await processTelegramUpdate({ update_id: updateId, message: { message_id: 1, text: '/help', chat: { id: '999000111' } } });
        expect(telegram.sent.at(-1)?.text).toContain('/jobs');
    });

    test('a status tap moves the job and offers the next step', async () => {
        const moves: string[] = [];
        depsTesting.setDeps(fakeDeps({
            setJobStatus: async (_u, ref, action) => {
                moves.push(`${(ref as { runId: string }).runId}:${action}`);
                return { success: true, data: {
                    workspaceId: 'w1', runId: 'cmue6z09b000965hljys7gv7l', company: 'Nightfall AI', role: 'Backend Engineer',
                    location: null, workMode: null, fitScore: 72, verdict: 'possible', status: 'applied', column: 'applied',
                    sourceUrl: null, compHint: null, topStrength: null, topConcern: null, createdAt: '', updatedAt: '',
                } };
            },
        }));
        updateId += 1;
        await processTelegramUpdate({ update_id: updateId, callback_query: { id: 'cb2', data: 'sc:s:cmue6z09b000965hljys7gv7l:a', message: { message_id: 7, chat: { id: CHAT } } } });
        expect(moves).toEqual(['cmue6z09b000965hljys7gv7l:applied']);
        const last = telegram.sent.at(-1)!;
        expect(last.text).toContain('Marked Applied · Nightfall AI Backend Engineer');
        const keyboard = last.replyMarkup as { inline_keyboard: { callback_data?: string }[][] };
        expect(keyboard.inline_keyboard.flat().map((button) => button.callback_data)).toEqual([
            'sc:s:cmue6z09b000965hljys7gv7l:i', 'sc:s:cmue6z09b000965hljys7gv7l:o', 'sc:s:cmue6z09b000965hljys7gv7l:r',
        ]);
    });

    test('confirming a note removes only its buttons, and a second tap is harmless', async () => {
        const WIN = 'cmwin0000000000000000000a';
        const OTHER = 'cmwin0000000000000000000b';
        let confirms = 0;
        depsTesting.setDeps(fakeDeps({
            confirmWinForUser: async () => {
                confirms += 1;
                return { success: true, data: { winId: WIN, title: 'Shipped the retry queue' } };
            },
        }));
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirm', callback_data: `sc:c:${WIN}` }, { text: '✏️ Edit', url: 'https://x.test/log' }, { text: '🗑 Dismiss', callback_data: `sc:x:${WIN}` }],
                [{ text: '✅ Other', callback_data: `sc:c:${OTHER}` }],
            ],
        };
        const tap = async () => {
            updateId += 1;
            await processTelegramUpdate({ update_id: updateId, callback_query: { id: `cb-${updateId}`, data: `sc:c:${WIN}`, message: { message_id: 42, chat: { id: CHAT }, reply_markup: keyboard } } });
        };
        await tap();
        expect(telegram.sent.at(-1)?.text).toContain('Added to your Work Log ✓');
        const edit = telegram.callsTo('editMessageReplyMarkup')[0];
        expect(edit?.body.message_id).toBe(42);
        expect((edit?.body.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard).toEqual([
            [{ text: '✏️ Edit', url: 'https://x.test/log' }],
            [{ text: '✅ Other', callback_data: `sc:c:${OTHER}` }],
        ]);

        // A stale copy of the button (another device, a slow client) taps again.
        depsTesting.setDeps(fakeDeps({ confirmWinForUser: async () => ({ success: false, error: 'Win is already confirmed', code: 'invalid_state' }) }));
        await tap();
        expect(telegram.sent.at(-1)?.text).toContain('Already in your Work Log ✓');
        expect(confirms).toBe(1);
    });

    test('scout off: links fall through to the old behaviour', async () => {
        depsTesting.setDeps(fakeDeps({ isScoutEnabled: async () => false }));
        await processTelegramUpdate(textUpdate('https://www.linkedin.com/jobs/view/4455902670'));
        expect(started).toHaveLength(0);
        expect(telegram.sent.at(-1)?.text).toContain('Unsupported input');
    });

    test('a start failure replaces the progress message with the reason', async () => {
        depsTesting.setDeps(fakeDeps({
            startScoutRun: async () => ({ success: false, error: 'You have used your free analyses', code: 'entitlement_required' }),
        }));
        await processTelegramUpdate(textUpdate('https://www.linkedin.com/jobs/view/4455902670'));
        const edit = telegram.edits.at(-1);
        expect(edit?.text).toContain('You have used your free analyses');
        expect(edit?.text).toContain('/settings/plan');
    });

    test('a reused, finished run sends the stored answer', async () => {
        depsTesting.setDeps(fakeDeps({
            startScoutRun: async () => ({ success: true, data: { run: view({ status: 'succeeded' }), created: false } }),
        }));
        await processTelegramUpdate(textUpdate('https://www.linkedin.com/jobs/view/4455902670'));
        expect(telegram.edits.at(-1)?.text).toContain('shared this one before');
        expect(telegram.sent.at(-1)?.text).toContain('Software Dev Engineer II at Amazon');
    });

    test('an sc: button tap from a linked chat runs the action', async () => {
        let refreshed = false;
        depsTesting.setDeps(fakeDeps({ refreshScoutRun: async () => { refreshed = true; return { success: true, data: view() }; } }));
        updateId += 1;
        await processTelegramUpdate({ update_id: updateId, callback_query: { id: 'cb1', data: 'sc:r:cmue6z09b000965hljys7gv7l', message: { chat: { id: CHAT } } } });
        expect(refreshed).toBe(true);
        expect(telegram.sent.at(-1)?.text).toContain('Re-running');
    });
});

describe('notifier', () => {
    async function makeRun(result: Record<string, unknown>, status: 'running' | 'succeeded' = 'running') {
        return prisma.agentRun.create({
            data: {
                userId: USER,
                agent: 'scout',
                inputKey: `${RUN}-${Math.random()}`,
                input: { url: 'https://www.linkedin.com/jobs/view/1', source: 'telegram' },
                kind: 'job_posting',
                status,
                channel: 'telegram',
                channelRef: { chatId: CHAT, messageId: 555 },
                result: result as object,
            },
        });
    }

    const okSection = (data: unknown) => ({ status: 'ok', data, sources: [], finishedAt: '2026-09-23T00:00:00.000Z' });

    test('progress edits in place, and only when the checklist changed', async () => {
        const run = await makeRun({ ingest: okSection({}) });
        await notifyTelegramScout(run, 'progress');
        expect(telegram.edits).toHaveLength(1);
        expect(telegram.edits[0].messageId).toBe(555);
        expect(telegram.edits[0].body.parse_mode).toBe('HTML');

        const again = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
        await notifyTelegramScout(again, 'progress');
        expect(telegram.edits).toHaveLength(1); // unchanged → no edit
    });

    test('finished sends the final answer exactly once, with buttons', async () => {
        const run = await makeRun({ ingest: okSection({}) }, 'succeeded');
        await notifyTelegramScout(run, 'finished');
        const finals = telegram.sent.filter((entry) => entry.replyMarkup);
        expect(finals).toHaveLength(1);
        const keyboard = finals[0].replyMarkup as { inline_keyboard: { text: string; callback_data?: string }[][] };
        expect(keyboard.inline_keyboard.flat().some((button) => button.callback_data?.startsWith('sc:d:'))).toBe(true);

        const replay = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
        await notifyTelegramScout(replay, 'finished');
        expect(telegram.sent.filter((entry) => entry.replyMarkup)).toHaveLength(1);
    });

    test('"message is not modified" counts as done, not as a failure to retry', async () => {
        telegram.setOutcome('editMessageText', { kind: 'api_error', description: 'Bad Request: message is not modified' });
        const run = await makeRun({ ingest: okSection({}) });
        await notifyTelegramScout(run, 'progress');
        const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
        expect((saved.channelRef as { progressHash?: string }).progressHash).toBeTruthy();
    });
});

describe('429 handling', () => {
    test('a short retry_after is waited out once, then succeeds', async () => {
        let calls = 0;
        const waits: number[] = [];
        telegramTesting.setSleep(async (ms) => { waits.push(ms); });
        telegramTesting.setFetch(async () => {
            calls += 1;
            if (calls === 1) {
                return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } }), { status: 429 });
            }
            return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
        });
        const { sendTelegramMessageDetailed } = await import('@/lib/telegram');
        const result = await sendTelegramMessageDetailed({ chatId: CHAT, text: 'x' });
        expect(result).toMatchObject({ ok: true, messageId: 9 });
        expect(waits).toEqual([2000]);
        telegramTesting.setSleep(null);
    });

    test('a long retry_after is not waited out', async () => {
        telegramTesting.setSleep(async () => { throw new Error('should not sleep'); });
        telegramTesting.setFetch(async () => new Response(JSON.stringify({ ok: false, parameters: { retry_after: 30 } }), { status: 429 }));
        const { sendTelegramMessageDetailed } = await import('@/lib/telegram');
        const result = await sendTelegramMessageDetailed({ chatId: CHAT, text: 'x' });
        expect(result).toMatchObject({ ok: false, retryAfter: 30 });
        telegramTesting.setSleep(null);
    });
});

describe('chat routing for free text (docs/prd/10-chat.md §4)', () => {
    test('a question the router answers is replied to, and no run starts', async () => {
        depsTesting.setDeps(fakeDeps({ routeChannelText: async () => ({ kind: 'reply', text: 'Here is your pipeline.\n\n1. SDE II at Razorpay · applied' }) }));
        await processTelegramUpdate(textUpdate('show me my job pipeline please'));
        expect(started).toHaveLength(0);
        expect(telegram.sent.at(-1)?.text).toContain('SDE II at Razorpay');
    });

    test('company research goes through Scout with the intent, so the notifier reports it', async () => {
        depsTesting.setDeps(fakeDeps({ routeChannelText: async () => ({ kind: 'scout', company: 'Jack & Jill' }) }));
        await processTelegramUpdate(textUpdate('tell me about the startup Jack & Jill'));
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({
            channel: 'telegram',
            input: { text: 'Research the company: Jack & Jill', intent: 'company_research', company: 'Jack & Jill', source: 'telegram' },
        });
        expect(telegram.sent[0].text).toContain('Looking into Jack & Jill');
    });

    test('a routing failure (null) falls back to recording the note, never losing it', async () => {
        depsTesting.setDeps(fakeDeps({ routeChannelText: async () => null }));
        await processTelegramUpdate(textUpdate('shipped the retry queue today, p99 down to 300ms'));
        expect(started).toHaveLength(1);
        expect((started[0].input as { text: string }).text).toContain('retry queue');
    });
});
