/**
 * Settings → Memory actions (docs/impl/08-memory.md §6): Clerk auth, zod,
 * discriminated `Result`. Against the local Postgres with Clerk mocked.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { remember } from '@/services/memory';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';

const clerk = installClerkMock();
const actions = await import('@/actions/memory');

const users: string[] = [];
function user(): string {
    const id = newTestUserId('memact');
    users.push(id);
    return id;
}

afterEach(() => clerk.signOut());
afterAll(async () => {
    for (const id of users) await cleanupTestUser(id);
});

async function seed(userId: string) {
    return (await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Voice agent on Claude at Plivo', source: 'clarification_answer' }))!;
}

describe('signed out', () => {
    test('every action refuses, and touches nothing', async () => {
        const owner = user();
        const memory = await seed(owner);
        expect(await actions.listMyMemories()).toMatchObject({ success: false, code: 'unauthenticated' });
        expect(await actions.updateMemory({ id: memory.id, text: 'x' })).toMatchObject({ success: false, code: 'unauthenticated' });
        expect(await actions.deleteMemory({ id: memory.id })).toMatchObject({ success: false, code: 'unauthenticated' });
        expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe('active');
    });
});

describe('input is validated', () => {
    test('missing id, empty text, unknown sensitivity, nothing to change', async () => {
        const userId = clerk.signIn(user());
        const memory = await seed(userId);
        for (const input of [
            {},
            { id: '' },
            { id: memory.id, text: '   ' },
            { id: memory.id, sensitivity: 'public' },
            { id: memory.id },
            { id: memory.id, text: 'x'.repeat(5_000) },
        ]) {
            expect(await actions.updateMemory(input)).toMatchObject({ success: false, code: 'invalid_input' });
        }
        expect(await actions.deleteMemory({})).toMatchObject({ success: false, code: 'invalid_input' });
        expect(await actions.deleteMemory(null)).toMatchObject({ success: false, code: 'invalid_input' });
    });
});

describe('a signed-in user', () => {
    test('lists only their own active memories', async () => {
        const mine = clerk.signIn(user());
        const other = user();
        await seed(mine);
        await seed(other);
        const listed = await actions.listMyMemories();
        expect(listed.success).toBe(true);
        if (!listed.success) return;
        expect(listed.data).toHaveLength(1);
        expect(listed.data[0]).toMatchObject({ key: 'skill:claude', text: 'Voice agent on Claude at Plivo' });
    });

    test('edits the text: a user_edit row replaces the old, and the old is kept as history', async () => {
        const userId = clerk.signIn(user());
        const memory = await seed(userId);
        const edited = await actions.updateMemory({ id: memory.id, text: '  Claude Sonnet voice agent at Plivo  ' });
        expect(edited.success).toBe(true);
        if (!edited.success) return;
        expect(edited.data).toMatchObject({ text: 'Claude Sonnet voice agent at Plivo', source: 'user_edit', key: 'skill:claude' });
        expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe('superseded');
        expect(await prisma.funnelEvent.count({ where: { userId, type: 'memory_edited' } })).toBe(1);
    });

    test('makes a memory private, in place', async () => {
        const userId = clerk.signIn(user());
        const memory = await seed(userId);
        const edited = await actions.updateMemory({ id: memory.id, sensitivity: 'private' });
        expect(edited).toMatchObject({ success: true, data: { id: memory.id, sensitivity: 'private' } });
    });

    test('deletes (soft) their own memory', async () => {
        const userId = clerk.signIn(user());
        const memory = await seed(userId);
        expect(await actions.deleteMemory({ id: memory.id })).toEqual({ success: true, data: { id: memory.id } });
        expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe('deleted');
        const listed = await actions.listMyMemories();
        expect(listed.success && listed.data).toEqual([]);
    });

    test('cannot edit or delete someone else\'s memory', async () => {
        const owner = user();
        const memory = await seed(owner);
        clerk.signIn(user());
        expect(await actions.updateMemory({ id: memory.id, text: 'mine now' })).toMatchObject({ success: false, code: 'not_found' });
        expect(await actions.deleteMemory({ id: memory.id })).toMatchObject({ success: false, code: 'not_found' });
        expect(await prisma.userMemory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ status: 'active', text: 'Voice agent on Claude at Plivo' });
    });
});
