/**
 * The Telegram agent's promise once the webhook has said 200: every update
 * runs at most once, and a failure is never silent. Files sent to the bot
 * continue as pasted text. Against the local Postgres, with Telegram mocked at
 * the transport and Scout replaced through the channel deps seam.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, GenerationStatus } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { __testing as depsTesting, type ScoutChannelDeps } from '@/lib/channels/scoutDeps';
import { escapeTelegramHtml } from '@/lib/channels/format';
import { TELEGRAM_FILE_TEXT_MAX } from '@/lib/channels/telegramFiles';
import { minimalPdf, serveTelegramFile } from '@/lib/channels/telegramFiles.test-utils';
import { inertInboxDeps, view } from '@/lib/channels/testViews.test-utils';
import { resetAlertThrottle } from '@/lib/opsAlert';
import { prisma } from '@/lib/prisma';
import { __testing as telegramTesting } from '@/lib/telegram';
import { processTelegramUpdate, TELEGRAM_FAILURE_TEXT, type TelegramUpdatePayload } from './telegramAgent';

const RUN = `itest-tgr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const ADMIN = `${RUN}-admin`;
const CHAT = String(Date.now() + 11).slice(-9);
const ADMIN_CHAT = String(Date.now() + 13).slice(-9);
const UNLINKED_CHAT = String(Date.now() + 17).slice(-9);
// Unique per run: the bot ignores an update_id it has already processed.
let updateId = Date.now() * 10 + 3;
const usedUpdateIds: string[] = [];

let telegram: MockTelegram;
let started: Array<{ input: { url: string | null; text: string | null; goal?: string } }> = [];
const previousAdmins = process.env.ADMIN_USER_IDS;

function fakeDeps(overrides: Partial<ScoutChannelDeps> = {}): ScoutChannelDeps {
    return {
        isScoutEnabled: async () => true,
        startScoutRun: async (params) => {
            started.push(params as unknown as (typeof started)[number]);
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

function messageUpdate(message: Record<string, unknown>, chatId = CHAT): TelegramUpdatePayload {
    updateId += 1;
    usedUpdateIds.push(String(updateId));
    return { update_id: updateId, message: { message_id: updateId, chat: { id: chatId, type: 'private' }, ...message } } as TelegramUpdatePayload;
}

const toUser = () => telegram.toChat(CHAT).filter((m) => m.method === 'sendMessage').map((m) => m.text ?? '');
const toAdmin = () => telegram.toChat(ADMIN_CHAT).filter((m) => m.method === 'sendMessage').map((m) => m.text ?? '');
const FAILURE = escapeTelegramHtml(TELEGRAM_FAILURE_TEXT);

const JD_LINES = [
    'Forward Deployed AI Engineer at Example Labs, Bengaluru.',
    'You will ship LLM features with customers, own evaluation harnesses,',
    'and work across Python, TypeScript and Postgres. Five years of experience.',
    'Send resumes to jobs@example.com with the role in the subject line.',
];

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    process.env.ADMIN_USER_IDS = ADMIN;
    await prisma.channelIdentity.createMany({
        data: [
            { userId: USER, channel: Channel.telegram, externalId: CHAT, verified: true },
            { userId: ADMIN, channel: Channel.telegram, externalId: ADMIN_CHAT, verified: true },
        ],
    });
});

beforeEach(() => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    started = [];
    depsTesting.setDeps(fakeDeps());
    resetAlertThrottle();
});

afterEach(() => depsTesting.reset());

afterAll(async () => {
    telegramTesting.reset();
    if (previousAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = previousAdmins;
    await prisma.telegramUpdateReceipt.deleteMany({ where: { updateId: { in: usedUpdateIds } } });
    await prisma.generationSession.deleteMany({ where: { userId: USER } });
    await prisma.channelIdentity.deleteMany({ where: { userId: { in: [USER, ADMIN] } } });
    await prisma.rateLimitHit.deleteMany({ where: { key: { contains: USER } } });
});

describe('a failure is never silent', () => {
    test('the user is told in plain words, and the operators get the error', async () => {
        depsTesting.setDeps(fakeDeps({ isScoutEnabled: async () => { throw new Error('relation "FeatureFlag" does not exist'); } }));
        const outcome = await processTelegramUpdate(messageUpdate({ text: 'https://www.linkedin.com/jobs/view/4455902670' }));

        expect(outcome).toBe('failed');
        expect(toUser()).toEqual([FAILURE]);
        const alert = toAdmin().join('\n');
        expect(alert).toContain('Telegram update failed');
        expect(alert).toContain('relation "FeatureFlag" does not exist');
        // What the user sent never reaches the operators.
        expect(alert).not.toContain('linkedin.com');
    });

    test('a failed update delivered again is not run again', async () => {
        depsTesting.setDeps(fakeDeps({ isScoutEnabled: async () => { throw new Error('boom'); } }));
        const update = messageUpdate({ text: 'https://www.linkedin.com/jobs/view/4455902671' });
        expect(await processTelegramUpdate(update)).toBe('failed');
        expect(await processTelegramUpdate(update)).toBe('duplicate');
        expect(toUser()).toEqual([FAILURE]);
    });

    test('a resume request that fails for an internal reason gets plain copy, not the reason', async () => {
        // An empty clarification payload: the service answers "Clarification
        // state is invalid for this session", which used to be sent verbatim.
        const session = await prisma.generationSession.create({
            data: { userId: USER, jobDescription: 'jd', channel: Channel.telegram, status: GenerationStatus.awaiting_clarification, clarifications: {} },
        });
        try {
            expect(await processTelegramUpdate(messageUpdate({ text: 'yes, 2 years of Kafka at Plivo' }))).toBe('handled');
            const reply = toUser().at(-1) ?? '';
            expect(reply).toContain('Something went wrong on our side with that resume');
            expect(reply).toContain('/status');
            expect(reply).not.toMatch(/Clarification state|Request failed/);
            expect(toAdmin().join('\n')).toContain('Clarification state is invalid');
        } finally {
            await prisma.generationSession.delete({ where: { id: session.id } });
        }
    });
});

describe('at most once per update_id', () => {
    test('a redelivered update is a no-op', async () => {
        const update = messageUpdate({ text: 'https://www.linkedin.com/jobs/view/4455902672' });
        expect(await processTelegramUpdate(update)).toBe('handled');
        expect(await processTelegramUpdate(update)).toBe('duplicate');
        expect(started).toHaveLength(1);
    });

    test('two deliveries racing each other run once', async () => {
        const update = messageUpdate({ text: 'https://www.linkedin.com/jobs/view/4455902673' });
        const outcomes = await Promise.all([processTelegramUpdate(update), processTelegramUpdate(update)]);
        expect(outcomes.sort()).toEqual(['duplicate', 'handled']);
        expect(started).toHaveLength(1);
    });
});

describe('files', () => {
    test('a PDF job description continues as pasted text; its caption is the note, not part of the post', async () => {
        const bytes = minimalPdf(JD_LINES);
        const urls = serveTelegramFile({ bytes }, telegram.fetch);
        const outcome = await processTelegramUpdate(messageUpdate({
            caption: 'Is this one worth it?',
            document: { file_id: 'pdf-1', file_name: 'jd.pdf', mime_type: 'application/pdf', file_size: bytes.length },
        }));

        expect(outcome).toBe('handled');
        expect(urls).toHaveLength(2);
        expect(started).toHaveLength(1);
        // Line breaks kept, the same as a text file (see pdfParser.joinTextItems).
        // The caption is the user's note (src/lib/scout/goal.ts): it decides
        // the goal ("worth it?" is evaluate) and is not analysed as the post.
        expect(started[0].input.text).toBe(JD_LINES.join('\n'));
        expect(started[0].input.goal).toBeUndefined();
        expect(toUser()[0]).toContain('Reading the post');
    });

    test('a PDF captioned "apply for me" starts the run with the apply goal', async () => {
        const bytes = minimalPdf(JD_LINES);
        serveTelegramFile({ bytes }, telegram.fetch);
        await processTelegramUpdate(messageUpdate({
            caption: 'apply for me',
            document: { file_id: 'pdf-apply', file_name: 'jd.pdf', mime_type: 'application/pdf', file_size: bytes.length },
        }));
        expect(started).toHaveLength(1);
        expect(started[0].input.text).toBe(JD_LINES.join('\n'));
        expect(started[0].input.goal).toBe('apply');
        expect(toUser()[0]).toContain('tailor your resume and draft the application');
    });

    test('a long text file is capped, and the user is told so', async () => {
        const body = `${JD_LINES.join('\n')}\n${'Responsibilities include building agents. '.repeat(700)}`;
        serveTelegramFile({ bytes: new TextEncoder().encode(body) }, telegram.fetch);
        await processTelegramUpdate(messageUpdate({ document: { file_id: 'txt-1', file_name: 'jd.txt', mime_type: 'text/plain' } }));

        expect(toUser()[0]).toBe(`That file is long, so I read the first ${TELEGRAM_FILE_TEXT_MAX.toLocaleString('en-US')} characters.`);
        expect(started).toHaveLength(1);
        expect(started[0].input.text?.length).toBeLessThanOrEqual(TELEGRAM_FILE_TEXT_MAX);
        expect(started[0].input.text).toStartWith(JD_LINES[0]);
    });

    test('a photo gets one sentence about what can be read, and nothing starts', async () => {
        const outcome = await processTelegramUpdate(messageUpdate({ caption: 'this job', photo: [{ file_id: 'p1', width: 90, height: 90 }] }));
        expect(outcome).toBe('handled');
        expect(started).toHaveLength(0);
        expect(toUser()).toEqual([escapeTelegramHtml('I can read PDFs and text files (.txt or .md), but not photos or other files yet. Paste the text here instead, or send it as a PDF.')]);
    });

    test('a file from a chat that is not linked is never downloaded', async () => {
        const urls = serveTelegramFile({ bytes: minimalPdf(JD_LINES) }, telegram.fetch);
        await processTelegramUpdate(messageUpdate({ document: { file_id: 'pdf-2', file_name: 'jd.pdf', mime_type: 'application/pdf' } }, UNLINKED_CHAT));
        expect(urls).toHaveLength(0);
        expect(telegram.toChat(UNLINKED_CHAT).at(-1)?.text).toContain('not linked to Patronus');
    });

    test('a download that fails is our failure: plain words to the user, an alert to the operators', async () => {
        serveTelegramFile({ throwOn: 'getFile' }, telegram.fetch);
        const outcome = await processTelegramUpdate(messageUpdate({ document: { file_id: 'pdf-3', file_name: 'jd.pdf', mime_type: 'application/pdf' } }));
        expect(outcome).toBe('failed');
        expect(toUser()).toEqual([FAILURE]);
        const alert = toAdmin().join('\n');
        expect(alert).toContain('TelegramFileError');
        expect(alert).toContain('file application/pdf');
    });
});
