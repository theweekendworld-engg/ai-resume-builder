/**
 * Job-watch alert buttons through the real Telegram update path
 * (`processTelegramUpdate`), with the Bot API mocked at the transport and
 * Scout's start replaced at its seam. The database is real.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, JobMatchStatus } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { __testing as depsTesting } from '@/lib/channels/scoutDeps';
import { inertInboxDeps, view } from '@/lib/channels/testViews.test-utils';
import { restoreFlags, setFlagForTest, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';
import { prisma } from '@/lib/prisma';
import { __testing as telegramTesting } from '@/lib/telegram';
import { alertKeyboard, encodeWatchAction } from '@/lib/watch/alert';
import { processTelegramUpdate } from '@/services/telegramAgent';

const RUN = `itest-tgwatch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const OTHER = `${RUN}-other`;
const CHAT = String(Date.now()).slice(-9);
const OTHER_CHAT = String(Number(CHAT) + 1);
let updateId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
let telegram: MockTelegram;
let flags: FlagSnapshot;
let started: Array<Record<string, unknown>> = [];
let sourceId = '';
let matchId = '';

function tap(data: string, chat = CHAT) {
    updateId += 1;
    const keyboard = alertKeyboard([{ matchId } as never]);
    return {
        update_id: updateId,
        callback_query: { id: `cb-${updateId}`, data, message: { message_id: 77, chat: { id: chat, type: 'private' }, reply_markup: { inline_keyboard: keyboard } } },
    };
}

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    flags = await snapshotFlags();
    await setFlagForTest('job_watch', { enabled: true, allowUserIds: [USER, OTHER] });
    await setFlagForTest('scout', { enabled: true, allowUserIds: [USER, OTHER] });
    await prisma.channelIdentity.create({ data: { userId: USER, channel: Channel.telegram, externalId: CHAT, verified: true } });
    await prisma.channelIdentity.create({ data: { userId: OTHER, channel: Channel.telegram, externalId: OTHER_CHAT, verified: true } });
    sourceId = (await prisma.jobSource.create({ data: { provider: 'greenhouse', boardToken: RUN, companyName: 'Acme Pay' }, select: { id: true } })).id;
});

beforeEach(async () => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    started = [];
    depsTesting.setDeps({
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
    });
    await prisma.jobMatch.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    await prisma.jobPosting.deleteMany({ where: { sourceId } });
    const posting = await prisma.jobPosting.create({
        data: { sourceId, externalId: `${RUN}-1`, title: 'Senior Backend Engineer', absoluteUrl: `https://boards.greenhouse.io/${RUN}/jobs/1`, contentHash: 'x', description: 'Go.' },
        select: { id: true },
    });
    matchId = (await prisma.jobMatch.create({
        data: { userId: USER, postingId: posting.id, origin: 'watchlist', score: 91, verdict: 'strong', matchedVia: 'model', qualifies: true, fit: {}, status: JobMatchStatus.alerted },
        select: { id: true },
    })).id;
});

afterEach(() => depsTesting.reset());

afterAll(async () => {
    telegramTesting.reset();
    await prisma.jobMatch.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    await prisma.jobPosting.deleteMany({ where: { sourceId } });
    await prisma.jobSource.deleteMany({ where: { id: sourceId } });
    await prisma.channelIdentity.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.funnelEvent.deleteMany({ where: { userId: USER } });
    await restoreFlags(flags);
});

describe('job-watch buttons', () => {
    test('Track puts it on the job board and takes Track and Not-for-me off the message', async () => {
        await processTelegramUpdate(tap(encodeWatchAction('track', matchId)));
        expect(await prisma.applicationWorkspace.count({ where: { userId: USER } })).toBe(1);
        expect((await prisma.jobMatch.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(JobMatchStatus.tracked);
        expect(telegram.sent.at(-1)?.text).toContain('Tracked: Senior Backend Engineer at Acme Pay');
        const markup = telegram.callsTo('editMessageReplyMarkup').at(-1);
        expect(JSON.stringify(markup?.body)).toContain('Outreach');
        expect(JSON.stringify(markup?.body)).not.toContain('Track');
    });

    test('Not for me dismisses it', async () => {
        await processTelegramUpdate(tap(encodeWatchAction('pass', matchId)));
        expect((await prisma.jobMatch.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(JobMatchStatus.dismissed);
        expect(telegram.sent.at(-1)?.text).toContain('Passed on');
    });

    test('Outreach starts Scout on the posting, from this chat', async () => {
        await processTelegramUpdate(tap(encodeWatchAction('outreach', matchId)));
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({ userId: USER, channel: 'telegram', input: { url: `https://boards.greenhouse.io/${RUN}/jobs/1`, source: 'telegram' } });
    });

    test("a tap from another account's chat touches nothing", async () => {
        await processTelegramUpdate(tap(encodeWatchAction('track', matchId), OTHER_CHAT));
        await processTelegramUpdate(tap(encodeWatchAction('pass', matchId), OTHER_CHAT));
        expect((await prisma.jobMatch.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(JobMatchStatus.alerted);
        expect(await prisma.applicationWorkspace.count({ where: { userId: OTHER } })).toBe(0);
        expect(telegram.sent.at(-1)?.text).toContain('no longer in your watch');
    });
});
