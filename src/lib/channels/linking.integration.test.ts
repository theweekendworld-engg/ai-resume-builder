/**
 * Linking, unlinking and conflicts against the local Postgres, with the
 * Telegram transport and Clerk mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { __testing as telegramTesting } from '@/lib/telegram';
import { consumeChannelLinkToken, unlinkChannelForSession } from '@/actions/channelIdentity';
import { processTelegramUpdate } from '@/services/telegramAgent';

const RUN = `itest-link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const OWNER = `${RUN}-owner`;
const OTHER = `${RUN}-other`;
const CHAT = `9${String(Date.now()).slice(-8)}`;
// A random high range: update ids are deduped in a table that persists across
// runs, and the other Telegram test file derives its ids from the clock.
let updateId = 1_500_000_000 + Math.floor(Math.random() * 400_000_000);
let telegram: MockTelegram;
const clerk = installClerkMock();

function update(body: Record<string, unknown>) {
    updateId += 1;
    return { update_id: updateId, ...body };
}

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    await prisma.userProfile.createMany({
        data: [
            { userId: OWNER, fullName: 'Owner Person', email: 'owner@example.com' },
            { userId: OTHER, fullName: 'Second Account', email: 'second@example.com' },
        ],
    });
});

beforeEach(async () => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    await prisma.channelIdentity.deleteMany({ where: { OR: [{ userId: { in: [OWNER, OTHER] } }, { externalId: CHAT }] } });
});

afterAll(async () => {
    telegramTesting.reset();
    clerk.signOut();
    await prisma.channelIdentity.deleteMany({ where: { OR: [{ userId: { in: [OWNER, OTHER] } }, { externalId: CHAT }] } });
    await prisma.channelLinkToken.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
});

async function tokenFor(userId: string): Promise<string> {
    const token = `${RUN.replace(/[^a-z0-9]/g, '')}${Math.floor(Math.random() * 1e9)}`.slice(0, 40);
    await prisma.channelLinkToken.create({ data: { userId, channel: Channel.telegram, token, expiresAt: new Date(Date.now() + 60_000) } });
    return token;
}

describe('conflicts are explicit', () => {
    test('consuming a token for a chat owned by another account returns the conflict code and owner', async () => {
        await prisma.channelIdentity.create({ data: { userId: OTHER, channel: Channel.telegram, externalId: CHAT, verified: true } });
        const result = await consumeChannelLinkToken({ channel: Channel.telegram, token: await tokenFor(OWNER), externalId: CHAT });
        expect(result).toMatchObject({ success: false, code: 'linked_to_other', otherUserId: OTHER });
    });

    test('the bot names the other account (masked) instead of "already linked"', async () => {
        await prisma.channelIdentity.create({ data: { userId: OTHER, channel: Channel.telegram, externalId: CHAT, verified: true } });
        const token = await tokenFor(OWNER);
        await processTelegramUpdate(update({ message: { message_id: 1, text: `/start link_${token}`, chat: { id: CHAT } } }));
        const reply = telegram.sent.at(-1)?.text ?? '';
        expect(reply).toContain('another Patronus account');
        expect(reply).toContain('s•••@example.com');
        expect(reply).toContain('/unlink');
        expect(reply).not.toContain('already linked. Use /generate');
    });

    test('a successful link says which account and what the bot does', async () => {
        const token = await tokenFor(OWNER);
        await processTelegramUpdate(update({ message: { message_id: 1, text: `/start link_${token}`, chat: { id: CHAT } } }));
        const reply = telegram.sent.at(-1)?.text ?? '';
        expect(reply).toContain('Owner Person');
        expect(reply).toContain('job or post link');
    });

    test('a bare /start from an unlinked chat explains the one-tap link', async () => {
        await processTelegramUpdate(update({ message: { message_id: 1, text: '/start', chat: { id: CHAT } } }));
        expect(telegram.sent.at(-1)?.text ?? '').toContain('Link Telegram');
    });
});

describe('unlink', () => {
    test('/unlink asks first; "Unlink this chat" removes only this chat', async () => {
        await prisma.channelIdentity.create({ data: { userId: OWNER, channel: Channel.telegram, externalId: CHAT, verified: true } });
        await processTelegramUpdate(update({ message: { message_id: 1, text: '/unlink', chat: { id: CHAT } } }));
        const ask = telegram.sent.at(-1);
        expect(ask?.text ?? '').toContain('Unlink this chat from Patronus?');
        expect(JSON.stringify(ask?.body ?? {})).toContain('ul:yes');
        expect(await prisma.channelIdentity.count({ where: { externalId: CHAT } })).toBe(1);

        await processTelegramUpdate(update({ callback_query: { id: 'cb1', data: 'ul:yes', message: { message_id: 2, chat: { id: CHAT } } } }));
        expect(await prisma.channelIdentity.count({ where: { externalId: CHAT } })).toBe(0);
        expect(telegram.sent.at(-1)?.text ?? '').toContain('Unlinked');
    });

    test('"Keep it" changes nothing', async () => {
        await prisma.channelIdentity.create({ data: { userId: OWNER, channel: Channel.telegram, externalId: CHAT, verified: true } });
        await processTelegramUpdate(update({ callback_query: { id: 'cb2', data: 'ul:no', message: { message_id: 3, chat: { id: CHAT } } } }));
        expect(await prisma.channelIdentity.count({ where: { externalId: CHAT } })).toBe(1);
    });

    test('dashboard unlink is session-scoped: it never touches a chat owned by someone else', async () => {
        await prisma.channelIdentity.create({ data: { userId: OTHER, channel: Channel.telegram, externalId: CHAT, verified: true } });
        clerk.signIn(OWNER);
        const result = await unlinkChannelForSession(Channel.telegram);
        expect(result).toEqual({ success: true, removed: 0 });
        expect(await prisma.channelIdentity.count({ where: { userId: OTHER } })).toBe(1);

        clerk.signIn(OTHER);
        expect(await unlinkChannelForSession(Channel.telegram)).toEqual({ success: true, removed: 1 });
    });

    test('signed out, the dashboard unlink refuses', async () => {
        clerk.signOut();
        expect(await unlinkChannelForSession(Channel.telegram)).toEqual({ success: false, error: 'Not authenticated' });
    });
});
