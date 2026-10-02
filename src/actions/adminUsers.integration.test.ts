/**
 * Admin user search and flag allow-lists, against the local Postgres.
 * Clerk is the mock, which has no user list: so search takes its fallback
 * (profiles), which is the path that must work when Clerk is down.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

const clerk = installClerkMock();
const { searchAdminUsers, setFeatureFlagAllowList } = await import('./admin');

const RUN = `itest-admin-${Date.now()}`;
const ADMIN = `${RUN}-admin`;
const TARGET = `${RUN}-target`;
let originalAdmins: string | undefined;
let flags: FlagSnapshot = [];

beforeAll(async () => {
    originalAdmins = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = ADMIN;
    flags = await snapshotFlags();
    await prisma.userProfile.create({ data: { userId: TARGET, fullName: 'Zeddicus QA Person', email: `${RUN}@example.com` } });
});

afterAll(async () => {
    process.env.ADMIN_USER_IDS = originalAdmins;
    await restoreFlags(flags);
    await prisma.userProfile.deleteMany({ where: { userId: TARGET } });
    clerk.signOut();
});

describe('admin users', () => {
    test('a non-admin cannot list users or edit an allow-list', async () => {
        clerk.signIn(TARGET);
        await expect(searchAdminUsers({ q: 'Zeddicus' })).rejects.toThrow(/Admin/);
        await expect(setFeatureFlagAllowList({ key: 'chat', self: true, op: 'add' })).rejects.toThrow(/Admin/);
    });

    test('search finds a user by name, and by email', async () => {
        clerk.signIn(ADMIN);
        const byName = await searchAdminUsers({ q: 'zeddicus qa' });
        expect(byName.rows.map((r) => r.userId)).toContain(TARGET);
        const byEmail = await searchAdminUsers({ q: RUN });
        expect(byEmail.rows[0]?.name).toBe('Zeddicus QA Person');
        expect(byEmail.rows[0]?.plan).toBeTruthy();
    });

    test('giving a user chat puts them on the allow-list, and removing takes them off', async () => {
        clerk.signIn(ADMIN);
        const added = await setFeatureFlagAllowList({ key: 'chat', entry: TARGET, op: 'add' });
        expect(added.success && added.allowUserIds.includes(TARGET)).toBe(true);
        const seen = await searchAdminUsers({ q: RUN });
        expect(seen.rows[0]?.allowedFlags).toContain('chat');

        const removed = await setFeatureFlagAllowList({ key: 'chat', entry: TARGET, op: 'remove' });
        expect(removed.success && !removed.allowUserIds.includes(TARGET)).toBe(true);
    });

    test('"Add me" adds the signed-in admin, not an id from the input', async () => {
        clerk.signIn(ADMIN);
        const added = await setFeatureFlagAllowList({ key: 'chat', self: true, entry: TARGET, op: 'add' });
        expect(added.success && added.allowUserIds.includes(ADMIN)).toBe(true);
        expect(added.success && added.allowUserIds.includes(TARGET)).toBe(false);
        await setFeatureFlagAllowList({ key: 'chat', entry: ADMIN, op: 'remove' });
    });

    test('a malformed id is refused', async () => {
        clerk.signIn(ADMIN);
        const bad = await setFeatureFlagAllowList({ key: 'chat', entry: 'drop table; --', op: 'add' });
        expect(bad.success).toBe(false);
    });
});
