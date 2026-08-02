/**
 * The notification settings actions (design/02 §J2) and the token-authenticated
 * undo, against a live Postgres.
 *
 * The point of interest is the boundary: `getNotificationSettings` and
 * `updateNotificationSettings` require a session, `undoFromDigestLink` must
 * work entirely without one. Both halves are asserted here, because getting
 * that inverted in either direction is the kind of bug that ships.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Channel, WinStatus } from '@prisma/client';

let currentUserId: string | null = null;

// `mock.module` is process-global in Bun, so the stub has to carry every named
// export another test file in the same run might import — otherwise those files
// fail to link and their tests silently stop being collected.
mock.module('@clerk/nextjs/server', () => ({
    auth: async () => ({ userId: currentUserId }),
    currentUser: async () => ({ emailAddresses: [{ emailAddress: 'test@example.com' }] }),
    clerkClient: async () => ({ users: { getUser: async () => ({ id: currentUserId }) } }),
}));

// `revalidatePath` needs a request-scoped store that only exists inside a real
// Next render. Stubbed, not removed: the action should keep calling it.
mock.module('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { prisma } = await import('@/lib/prisma');
const { cleanupTestUser, makeWin, newTestUserId } = await import('@/services/winFixtures.test-utils');
const { createDigestRoot, mintWinToken, applyDigestAction, resolveWinToken } = await import('@/lib/winTokens');
const { getNotificationSettings, updateNotificationSettings, undoFromDigestLink } = await import('./digest');

const users: string[] = [];

function newUser(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    currentUserId = id;
    return id;
}

afterEach(async () => {
    currentUserId = null;
    if (users.length > 0) {
        await prisma.weeklyDigest.deleteMany({ where: { userId: { in: users } } });
        await prisma.emailPreference.deleteMany({ where: { userId: { in: users } } });
        await prisma.channelIdentity.deleteMany({ where: { userId: { in: users } } });
    }
    for (const userId of users) await cleanupTestUser(userId);
    users.length = 0;
});

describe('getNotificationSettings', () => {
    test('creates the preference row on first read, with the Friday 16:00 default', async () => {
        newUser('settings-read');

        const result = await getNotificationSettings();
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.digestDay).toBe(5);
        expect(result.data.digestHour).toBe(16);
        expect(result.data.digestChannel).toBe('email');
        expect(result.data.weeklyDigest).toBe(true);
        expect(result.data.telegramLinked).toBe(false);
        // The preview line is the only way a user can check the timezone guess.
        expect(result.data.nextDigestLabel).toMatch(/^Friday, .+ at 4:00 PM$/);
    });

    test('refuses without a session', async () => {
        currentUserId = null;
        const result = await getNotificationSettings();
        expect(result.success).toBe(false);
        expect(!result.success && result.code).toBe('unauthenticated');
    });

    test('reports a verified Telegram link', async () => {
        const userId = newUser('settings-tg');
        await prisma.channelIdentity.create({
            data: { userId, channel: Channel.telegram, externalId: `chat-${userId}`, verified: true },
        });
        const result = await getNotificationSettings();
        expect(result.success && result.data.telegramLinked).toBe(true);
    });
});

describe('updateNotificationSettings', () => {
    test('moves the slot and the preview line follows', async () => {
        newUser('settings-move');

        const result = await updateNotificationSettings({
            digestDay: 2,
            digestHour: 9,
            timezone: 'Asia/Kolkata',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.digestDay).toBe(2);
        expect(result.data.nextDigestLabel).toMatch(/^Tuesday, .+ at 9:00 AM$/);
        expect(result.data.timezone).toBe('Asia/Kolkata');
    });

    test('rejects an unknown timezone rather than silently defaulting to UTC', async () => {
        newUser('settings-badtz');
        const result = await updateNotificationSettings({ timezone: 'Mars/Olympus_Mons' });
        expect(result.success).toBe(false);
        expect(!result.success && result.code).toBe('invalid_input');
    });

    test('rejects an out-of-range day or hour', async () => {
        newUser('settings-range');
        expect((await updateNotificationSettings({ digestDay: 0 })).success).toBe(false);
        expect((await updateNotificationSettings({ digestDay: 8 })).success).toBe(false);
        expect((await updateNotificationSettings({ digestHour: 24 })).success).toBe(false);
        expect((await updateNotificationSettings({ digestHour: -1 })).success).toBe(false);
    });

    test('unsubscribing from everything leaves the per-category flags intact', async () => {
        newUser('settings-unsub');
        await updateNotificationSettings({ unsubscribedAll: true });

        const after = await getNotificationSettings();
        expect(after.success && after.data.unsubscribedAll).toBe(true);
        // Never destructive: resubscribing must restore what they had, so the
        // category booleans are not cleared on the way out.
        expect(after.success && after.data.weeklyDigest).toBe(true);

        await updateNotificationSettings({ unsubscribedAll: false });
        const restored = await getNotificationSettings();
        expect(restored.success && restored.data.unsubscribedAll).toBe(false);
        expect(restored.success && restored.data.weeklyDigest).toBe(true);
    });

    test('cannot be called without a session', async () => {
        currentUserId = null;
        const result = await updateNotificationSettings({ digestHour: 9 });
        expect(!result.success && result.code).toBe('unauthenticated');
    });
});

describe('undoFromDigestLink', () => {
    test('works with no session at all', async () => {
        const userId = newUser('undo-action');
        const win = await makeWin({ userId });
        const digest = await prisma.weeklyDigest.create({
            data: {
                userId,
                weekStart: new Date('2026-07-27T00:00:00.000Z'),
                channel: Channel.email,
                token: createDigestRoot(),
                winIds: [win.id],
            },
        });
        const token = mintWinToken({ root: digest.token, winId: win.id, action: 'confirm' })!;

        const resolved = await resolveWinToken(token);
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        // The undo happens from the landing page, where there is no Clerk user.
        currentUserId = null;
        expect(await undoFromDigestLink(token)).toEqual({ status: 'undone' });

        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.draft);
    });

    test('an invalid token is a polite dead end, not a stack trace', async () => {
        const result = await undoFromDigestLink('not-a-real-token');
        expect(result.status).toBe('error');
    });

    test('there is nothing to undo before the action', async () => {
        const userId = newUser('undo-none');
        const win = await makeWin({ userId });
        const digest = await prisma.weeklyDigest.create({
            data: {
                userId,
                weekStart: new Date('2026-07-27T00:00:00.000Z'),
                channel: Channel.email,
                token: createDigestRoot(),
                winIds: [win.id],
            },
        });
        const token = mintWinToken({ root: digest.token, winId: win.id, action: 'confirm' })!;

        currentUserId = null;
        expect(await undoFromDigestLink(token)).toEqual({ status: 'nothing_to_undo' });
    });
});
