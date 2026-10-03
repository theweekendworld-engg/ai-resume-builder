/**
 * The production conversation of 2026-10-03, replayed against the local
 * Postgres with Telegram captured at the transport.
 *
 * With a resume question open, "/help what should i do now" was stored as the
 * answer about Java, "what the hell are you doing" as the answer about AWS
 * (which started the generation), and every question arrived with literal
 * MarkdownV2 backslashes ("include\.").
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, GenerationStatus } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { prisma } from '@/lib/prisma';
import { __testing as depsTesting, type ScoutChannelDeps } from '@/lib/channels/scoutDeps';
import { __testing as telegramTesting } from '@/lib/telegram';
import { inertInboxDeps, view } from '@/lib/channels/testViews.test-utils';
import { processTelegramUpdate } from './telegramAgent';

const RUN = `itest-tgq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const CHAT = String(Date.now() + 7).slice(-9);
// Unique per run: the bot ignores an update_id it has already processed.
let updateId = Date.now() * 10 + Math.floor(Math.random() * 10);
let telegram: MockTelegram;

const QUESTIONS = ['Java', 'Golang', 'AWS'].map((skill, i) => ({
    id: `q${i + 1}`,
    gap: skill,
    question: `Do you have hands-on experience with ${skill}? Share one concrete project, impact, or metric we can safely include.`,
}));

function deps(): ScoutChannelDeps {
    return {
        isScoutEnabled: async () => true,
        startScoutRun: async () => ({ success: true, data: { run: view({ status: 'queued' }), created: true } }),
        findOpenQuestionRun: async () => null,
        getScoutRun: async () => ({ success: true, data: view() }),
        answerScoutQuestion: async () => ({ success: true, data: view() }),
        draftScoutOutreach: async () => ({ success: false, error: 'n/a' }),
        refreshScoutRun: async () => ({ success: true, data: view() }),
        ...inertInboxDeps(),
    };
}

async function send(text: string) {
    updateId += 1;
    await processTelegramUpdate({ update_id: updateId, message: { message_id: updateId, text, chat: { id: CHAT, type: 'private' } } });
}

async function session() {
    return prisma.generationSession.findFirstOrThrow({ where: { userId: USER }, orderBy: { createdAt: 'desc' } });
}

const answersOf = (value: unknown) => ((value as { answers?: Record<string, unknown> } | null)?.answers ?? {});

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    await prisma.channelIdentity.create({ data: { userId: USER, channel: Channel.telegram, externalId: CHAT, verified: true } });
});

beforeEach(async () => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    depsTesting.setDeps(deps());
    await prisma.generationSession.deleteMany({ where: { userId: USER } });
    await prisma.generationSession.create({
        data: {
            userId: USER, jobDescription: 'Senior Backend Engineer', channel: Channel.telegram,
            status: GenerationStatus.awaiting_clarification,
            clarifications: { questions: QUESTIONS, answers: {} },
        },
    });
});

afterEach(() => depsTesting.reset());

afterAll(async () => {
    telegramTesting.reset();
    await prisma.generationSession.deleteMany({ where: { userId: USER } });
    await prisma.channelIdentity.deleteMany({ where: { userId: USER } });
});

describe('the 2026-10-03 conversation', () => {
    test('/help with words after it shows help and answers nothing', async () => {
        await send('/help what should i do now');
        expect(answersOf((await session()).clarifications)).toEqual({});
        expect(telegram.sent.at(-1)?.text ?? '').toMatch(/help|\/jobs|\/notes/i);
    });

    test('"no" skips the question, says so, and asks the next with its number', async () => {
        await send('no');
        const answers = answersOf((await session()).clarifications);
        expect(answers.q1).not.toBe('no');
        const reply = telegram.sent.at(-1)?.text ?? '';
        expect(reply).toContain('Skipped');
        expect(reply).toContain('Question 2 of 3');
        expect(reply).toContain('Golang');
    });

    test('frustration is not an answer and never starts the generation', async () => {
        await send('what the hell are you doing');
        const fresh = await session();
        expect(fresh.status).toBe(GenerationStatus.awaiting_clarification);
        expect(answersOf(fresh.clarifications)).toEqual({});
        expect(telegram.sent.at(-1)?.text ?? '').toContain('still waiting on one question');
    });

    test('"cancel" ends the open resume without a failure notice', async () => {
        await send('cancel');
        const fresh = await session();
        expect(fresh.status).toBe(GenerationStatus.failed);
        expect(fresh.lastNotifiedState).toBe('failed:Cancelled by you');
        expect(telegram.sent.at(-1)?.text ?? '').toContain('Cancelled');
    });

    test('no reply carries a MarkdownV2 escape, and every one is sent as HTML', async () => {
        for (const text of ['hii', '/help what should i do now', 'no', 'what the hell are you doing', '/status']) await send(text);
        expect(telegram.sent.length).toBeGreaterThan(0);
        for (const entry of telegram.sent) {
            expect(entry.text ?? '').not.toMatch(/\\[._\-!()]/);
            expect((entry.body as { parse_mode?: string }).parse_mode).toBe('HTML');
        }
    });
});
