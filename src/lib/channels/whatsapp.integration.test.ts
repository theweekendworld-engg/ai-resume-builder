/**
 * WhatsApp webhook + inbound handling against the local Postgres: dedupe is a
 * DB constraint, and link-token consumption writes a real ChannelIdentity.
 * Scout itself is replaced through the channel deps seam.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Channel } from '@prisma/client';
import { inboundWebhook, installWhatsAppMock, signWhatsAppBody, uninstallWhatsAppMock, type MockWhatsApp } from '@/__mocks__/whatsapp';
import { prisma } from '@/lib/prisma';
import { __testing as depsTesting, type ScoutChannelDeps } from './scoutDeps';
import { processWhatsAppMessage } from './whatsappAgent';
import { handleWhatsAppHandshake, handleWhatsAppWebhookPost } from './whatsappWebhook';
import type { WhatsAppInbound } from '@/lib/whatsapp';
import { inertInboxDeps, view } from './testViews.test-utils';

const RUN = `itest-wa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const WA_ID = `91${String(Date.now()).slice(-10)}`;
const SECRET = 'secret-for-webhook-tests';

let mock: MockWhatsApp;
const started: unknown[] = [];

function fakeDeps(overrides: Partial<ScoutChannelDeps> = {}): ScoutChannelDeps {
    return {
        isScoutEnabled: async () => true,
        startScoutRun: async (params) => {
            started.push(params);
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

beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'PNID';
    process.env.WHATSAPP_APP_SECRET = SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    mock = installWhatsAppMock();
    depsTesting.setDeps(fakeDeps());
    started.length = 0;
});

afterEach(() => {
    for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) delete process.env[key];
    uninstallWhatsAppMock();
    depsTesting.reset();
});

afterAll(async () => {
    await prisma.channelMessageReceipt.deleteMany({ where: { externalId: { startsWith: RUN } } });
    await prisma.channelIdentity.deleteMany({ where: { userId: USER } });
    await prisma.channelLinkToken.deleteMany({ where: { userId: USER } });
});

function inbound(overrides: Partial<WhatsAppInbound> = {}): WhatsAppInbound {
    return { id: `${RUN}-${Math.random()}`, from: WA_ID, text: null, replyId: null, replyTitle: null, profileName: null, ...overrides };
}

describe('webhook', () => {
    test('handshake answers the challenge', () => {
        const ok = handleWhatsAppHandshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'c1' }));
        expect(ok).toMatchObject({ status: 200, body: 'c1' });
        expect(handleWhatsAppHandshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'c1' })).status).toBe(403);
    });

    test('a bad signature is rejected and nothing is scheduled', async () => {
        const raw = JSON.stringify(inboundWebhook({ id: `${RUN}-bad`, from: WA_ID, text: 'hi' }));
        const scheduled: unknown[] = [];
        const result = await handleWhatsAppWebhookPost({ rawBody: raw, signature: signWhatsAppBody(raw, 'wrong'), schedule: (w) => scheduled.push(w), process: async () => undefined });
        expect(result.status).toBe(401);
        expect(scheduled).toHaveLength(0);
    });

    test('a redelivered message is processed once', async () => {
        const raw = JSON.stringify(inboundWebhook({ id: `${RUN}-dup`, from: WA_ID, text: 'https://www.linkedin.com/jobs/view/4455902670' }));
        const processed: string[] = [];
        const post = () => handleWhatsAppWebhookPost({
            rawBody: raw,
            signature: signWhatsAppBody(raw, SECRET),
            schedule: (work) => { void work(); },
            process: async (message) => { processed.push(message.id); },
        });
        const [first, second] = [await post(), await post()];
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(processed).toEqual([`${RUN}-dup`]);
    });

    test('unconfigured refuses', async () => {
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        const result = await handleWhatsAppWebhookPost({ rawBody: '{}', signature: null, schedule: () => undefined, process: async () => undefined });
        expect(result.status).toBe(404);
    });
});

describe('inbound', () => {
    test('an unlinked number is told how to link', async () => {
        await processWhatsAppMessage(inbound({ text: 'https://www.linkedin.com/jobs/view/1234567' }));
        expect(mock.texts.at(-1)).toContain('not linked');
        expect(started).toHaveLength(0);
    });

    test('"link <token>" consumes the dashboard token and links the wa_id', async () => {
        const token = 'ab'.repeat(16);
        await prisma.channelLinkToken.create({ data: { userId: USER, channel: Channel.whatsapp, token, expiresAt: new Date(Date.now() + 60_000) } });
        await processWhatsAppMessage(inbound({ text: `link ${token}` }));
        expect(mock.texts.at(-1)).toContain('Linked to');
        expect(mock.texts.at(-1)).toContain('Send me');
        const identity = await prisma.channelIdentity.findUnique({ where: { channel_externalId: { channel: Channel.whatsapp, externalId: WA_ID } } });
        expect(identity).toMatchObject({ userId: USER, verified: true });
        const consumed = await prisma.channelLinkToken.findFirst({ where: { token } });
        expect(consumed?.consumedAt).not.toBeNull();
    });

    test('a link starts Scout on the whatsapp channel with the sender as channelRef', async () => {
        await processWhatsAppMessage(inbound({ text: 'thoughts? https://www.linkedin.com/jobs/view/4455902670' }));
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({
            userId: USER,
            channel: 'whatsapp',
            channelRef: { to: WA_ID },
            input: { url: 'https://www.linkedin.com/jobs/view/4455902670', source: 'whatsapp' },
        });
        expect(mock.texts.at(-1)).toContain('On it');
    });

    test('a short reply answers the open question', async () => {
        const answers: string[] = [];
        depsTesting.setDeps(fakeDeps({
            findOpenQuestionRun: async () => view({
                status: 'awaiting_input',
                pendingQuestion: { id: 'pref.location', step: 'fit', prompt: 'Where are you based?', askedAt: new Date().toISOString() },
            }),
            answerScoutQuestion: async (_u, _r, value) => {
                answers.push(value);
                return { success: true, data: view() };
            },
        }));
        await processWhatsAppMessage(inbound({ text: 'Bengaluru' }));
        expect(answers).toEqual(['Bengaluru']);
        expect(started).toHaveLength(0);
    });

    test('a work note while an option question is open is new input, not the answer', async () => {
        const answers: string[] = [];
        depsTesting.setDeps(fakeDeps({
            findOpenQuestionRun: async () => view({
                status: 'awaiting_input',
                pendingQuestion: { id: 'pref.relocate', step: 'fit', prompt: 'Relocate?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
            }),
            answerScoutQuestion: async (_u, _r, value) => {
                answers.push(value);
                return { success: true, data: view() };
            },
        }));
        await processWhatsAppMessage(inbound({ text: 'Shipped the retry queue today, deliveries now back off instead of dropping' }));
        expect(answers).toEqual([]);
        expect(started).toHaveLength(1);
    });

    test('a button reply runs the Scout action', async () => {
        let refreshed = false;
        depsTesting.setDeps(fakeDeps({ refreshScoutRun: async () => { refreshed = true; return { success: true, data: view() }; } }));
        await processWhatsAppMessage(inbound({ replyId: 'sc:r:cmue6z09b000965hljys7gv7l', replyTitle: 'Refresh' }));
        expect(refreshed).toBe(true);
    });

    test('a note is recorded; chatter gets help instead', async () => {
        await processWhatsAppMessage(inbound({ text: 'shipped retry queue, p99 down 40%' }));
        expect(started).toHaveLength(1);
        expect(mock.texts.at(-1)).toContain('Recording that');
        await processWhatsAppMessage(inbound({ text: 'thanks' }));
        expect(started).toHaveLength(1);
        expect(mock.texts.at(-1)).toContain('what you worked on');
        expect(mock.texts.at(-1)).not.toContain('/help');
    });

    test('bare "jobs" is a command on WhatsApp; its empty state explains what to send', async () => {
        await processWhatsAppMessage(inbound({ text: 'jobs' }));
        expect(started).toHaveLength(0);
        expect(mock.texts.at(-1)).toContain('No jobs to review yet');
    });

    test('"notes" with drafts sends Confirm choices as a list once past three', async () => {
        depsTesting.setDeps(fakeDeps({
            listChatNotes: async () => Array.from({ length: 4 }, (_, i) => ({
                winId: `cmwin00000000000000000${i}a`, title: `Draft ${i}`, status: 'draft' as const, source: 'chat', createdAt: '',
            })),
        }));
        await processWhatsAppMessage(inbound({ text: 'notes' }));
        const last = mock.interactive.at(-1) as { type: string; action: { sections: { rows: { id: string }[] }[] } };
        expect(last.type).toBe('list');
        expect(last.action.sections[0].rows.map((row) => row.id)).toEqual([0, 1, 2, 3].map((i) => `sc:c:cmwin00000000000000000${i}a`));
    });

    test('an Applied tap offers the next steps as three reply buttons', async () => {
        depsTesting.setDeps(fakeDeps({
            setJobStatus: async () => ({ success: true, data: {
                workspaceId: 'w', runId: 'cmue6z09b000965hljys7gv7l', company: 'Apple', role: 'CMS Engineer', location: null,
                workMode: null, fitScore: 26, verdict: 'not_a_fit', status: 'applied', column: 'applied', sourceUrl: null,
                compHint: null, topStrength: null, topConcern: null, createdAt: '', updatedAt: '',
            } }),
        }));
        await processWhatsAppMessage(inbound({ replyId: 'sc:s:cmue6z09b000965hljys7gv7l:a', replyTitle: 'Applied' }));
        expect(mock.texts.some((text) => text.includes('Marked Applied · Apple CMS Engineer'))).toBe(true);
        const last = mock.interactive.at(-1) as { type: string; action: { buttons: unknown[] } };
        expect(last.type).toBe('button');
        expect(last.action.buttons).toHaveLength(3);
    });

    test('scout off: says so, starts nothing', async () => {
        depsTesting.setDeps(fakeDeps({ isScoutEnabled: async () => false }));
        await processWhatsAppMessage(inbound({ text: 'https://www.linkedin.com/jobs/view/4455902670' }));
        expect(started).toHaveLength(0);
        expect(mock.texts.at(-1)).toContain('not available');
    });
});
