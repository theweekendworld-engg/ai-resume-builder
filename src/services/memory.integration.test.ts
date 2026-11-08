/**
 * Long-term memory against the local Postgres (docs/impl/08-memory.md).
 *
 * What is proven: one active row per (user, key), held by the database
 * itself, not only by the service; a new answer supersedes the old and keeps
 * the chain; the same line said again only touches the row; forgetting is a
 * soft delete; usage orders the index without moving `updatedAt`; and every
 * artifact path reads shareable lines only, filtered in the query.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MEMORY_INDEX_MAX_CHARS } from '@/lib/memory/format';
import { loadShareableEvidence } from '@/lib/scout/outreach';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';
import {
    editMemory,
    forgetMemory,
    listMemories,
    markMemoriesUsed,
    memoryIndex,
    recall,
    recallForSkills,
    remember,
    shareableMemoryWhere,
} from './memory';

const users: string[] = [];
function user(): string {
    const id = newTestUserId('memory');
    users.push(id);
    return id;
}

afterAll(async () => {
    for (const id of users) await cleanupTestUser(id);
});

describe('one active memory per topic', () => {
    test('a new answer supersedes the old one and keeps the chain', async () => {
        const userId = user();
        const first = await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Used Claude for a demo', source: 'clarification_answer' });
        const second = await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Plivo voice agent on Claude Sonnet', source: 'clarification_answer' });
        expect(first && second).toBeTruthy();

        const rows = await prisma.userMemory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ id: first!.id, status: 'superseded', supersededById: second!.id });
        expect(rows[1]).toMatchObject({ id: second!.id, status: 'active', text: 'Plivo voice agent on Claude Sonnet' });
    });

    test('an alias key is the same topic: k8s supersedes kubernetes', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:kubernetes', text: 'Ran EKS clusters', source: 'clarification_answer' });
        const saved = await remember(userId, { key: 'skill:k8s', text: 'Ran EKS clusters for 40 services', source: 'clarification_answer' });
        expect(saved?.key).toBe('skill:kubernetes');
        expect(await prisma.userMemory.count({ where: { userId, status: 'active' } })).toBe(1);
    });

    test('the same line said again only touches the row', async () => {
        const userId = user();
        const first = await remember(userId, { key: 'skill:mcp', text: 'MCP server for internal tools', source: 'clarification_answer' });
        const again = await remember(userId, { key: 'skill:mcp', text: 'mcp server for internal tools.', source: 'clarification_answer' });
        expect(again?.id).toBe(first?.id);
        expect(await prisma.userMemory.count({ where: { userId } })).toBe(1);
    });

    test('the database refuses a second active row, whatever the code does', async () => {
        const userId = user();
        await prisma.userMemory.create({ data: { userId, key: 'skill:rust', text: 'a', source: 'chat' } });
        let code: string | null = null;
        try {
            await prisma.userMemory.create({ data: { userId, key: 'skill:rust', text: 'b', source: 'chat' } });
        } catch (error: unknown) {
            code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'other';
        }
        expect(code).toBe('P2002');
        // History may repeat: a superseded row on the same key is fine.
        await prisma.userMemory.create({ data: { userId, key: 'skill:rust', text: 'c', source: 'chat', status: 'superseded' } });
    });

    test('the database refuses a source or status outside the vocabulary', async () => {
        const userId = user();
        const refused = async (data: Prisma.UserMemoryUncheckedCreateInput) => {
            try {
                await prisma.userMemory.create({ data });
                return false;
            } catch {
                return true;
            }
        };
        expect(await refused({ userId, key: 'skill:x', text: 'a', source: 'model_guess' })).toBe(true);
        expect(await refused({ userId, key: 'skill:y', text: 'a', source: 'chat', sensitivity: 'secret' })).toBe(true);
        expect(await refused({ userId, key: 'skill:z', text: 'a', source: 'chat', status: 'archived' })).toBe(true);
    });

    test('two writers racing on one topic leave exactly one active row', async () => {
        const userId = user();
        await Promise.all([
            remember(userId, { key: 'skill:go', text: 'Go services at Razorpay', source: 'clarification_answer' }),
            remember(userId, { key: 'skill:go', text: 'Go CLI tools', source: 'clarification_answer' }),
            remember(userId, { key: 'skill:go', text: 'Go workers on Kafka', source: 'clarification_answer' }),
        ]);
        expect(await prisma.userMemory.count({ where: { userId, key: 'skill:go', status: 'active' } })).toBe(1);
    });

    test('empty text or a non-topic key is not remembered', async () => {
        const userId = user();
        expect(await remember(userId, { key: 'skill:go', text: '   ', source: 'chat' })).toBeNull();
        expect(await remember(userId, { key: 'claude', text: 'x', source: 'chat' })).toBeNull();
        expect(await prisma.userMemory.count({ where: { userId } })).toBe(0);
    });
});

describe('edit and forget', () => {
    test('editing the text is a user_edit row superseding the old; history stays', async () => {
        const userId = user();
        const saved = await remember(userId, { key: 'skill:claude', text: 'Claude demo', source: 'clarification_answer' });
        const edited = await editMemory(userId, saved!.id, { text: 'Claude Sonnet voice agent at Plivo' });
        expect(edited.success).toBe(true);
        if (!edited.success) return;
        expect(edited.data.source).toBe('user_edit');
        expect(edited.data.id).not.toBe(saved!.id);
        const old = await prisma.userMemory.findUnique({ where: { id: saved!.id } });
        expect(old).toMatchObject({ status: 'superseded', supersededById: edited.data.id });
    });

    test('making a memory private is metadata: same row', async () => {
        const userId = user();
        const saved = await remember(userId, { key: 'fact:visa', text: 'H-1B until 2027', source: 'chat' });
        const edited = await editMemory(userId, saved!.id, { sensitivity: 'private' });
        expect(edited.success && edited.data.id).toBe(saved!.id);
        expect(edited.success && edited.data.sensitivity).toBe('private');
        // A refreshed answer keeps the private choice.
        const refreshed = await remember(userId, { key: 'fact:visa', text: 'H-1B, transfer ok', source: 'chat' });
        expect(refreshed?.sensitivity).toBe('private');
    });

    test('forget is a soft delete; the topic is unknown again', async () => {
        const userId = user();
        const saved = await remember(userId, { key: 'skill:terraform', text: 'Terraform for AWS', source: 'clarification_answer' });
        const forgotten = await forgetMemory(userId, saved!.id);
        expect(forgotten.success).toBe(true);
        expect((await prisma.userMemory.findUnique({ where: { id: saved!.id } }))?.status).toBe('deleted');
        expect(await listMemories(userId)).toHaveLength(0);
        expect((await recallForSkills(userId, ['Terraform'])).size).toBe(0);
        // Forgetting twice, or another user's memory, is not_found.
        expect(await forgetMemory(userId, saved!.id)).toMatchObject({ success: false, code: 'not_found' });
    });

    test('another user cannot edit or forget it', async () => {
        const owner = user();
        const other = user();
        const saved = await remember(owner, { key: 'skill:go', text: 'Go', source: 'chat' });
        expect(await editMemory(other, saved!.id, { text: 'hacked' })).toMatchObject({ success: false, code: 'not_found' });
        expect(await forgetMemory(other, saved!.id)).toMatchObject({ success: false, code: 'not_found' });
        expect((await listMemories(owner))[0].text).toBe('Go');
    });
});

describe('recall and the index', () => {
    test('by key, by query (aliases included), and per skill', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Voice agent on Claude Sonnet at Plivo', source: 'clarification_answer' });
        await remember(userId, { key: 'skill:python', label: 'Python', text: 'FastAPI services; built an MCP server', source: 'clarification_answer' });
        await remember(userId, { key: 'pref:work_mode', label: 'Work mode', text: 'remote', source: 'scout_answer' });

        expect((await recall(userId, { keys: ['skill:claude'] })).map((m) => m.key)).toEqual(['skill:claude']);
        expect((await recall(userId, { query: 'Anthropic' })).map((m) => m.key)).toEqual(['skill:claude']);
        expect((await recall(userId, { query: 'MCP' })).map((m) => m.key)).toEqual(['skill:python']);

        const bySkill = await recallForSkills(userId, ['Anthropic', 'MCP', 'Terraform', 'Remote']);
        expect(bySkill.get('Anthropic')?.key).toBe('skill:claude');
        expect(bySkill.get('MCP')?.key).toBe('skill:python');
        expect(bySkill.has('Terraform')).toBe(false);
        // A preference is never the answer to a requirement.
        expect(bySkill.has('Remote')).toBe(false);
    });

    test('most used first; counting a use does not move updatedAt', async () => {
        const userId = user();
        const a = await remember(userId, { key: 'skill:a', label: 'A', text: 'first', source: 'chat' });
        const b = await remember(userId, { key: 'skill:b', label: 'B', text: 'second', source: 'chat' });
        const before = await prisma.userMemory.findUnique({ where: { id: b!.id }, select: { updatedAt: true } });
        await markMemoriesUsed(userId, [b!.id, b!.id]);
        const after = await prisma.userMemory.findUnique({ where: { id: b!.id }, select: { updatedAt: true, useCount: true, lastUsedAt: true } });
        expect(after?.useCount).toBe(1);
        expect(after?.lastUsedAt).not.toBeNull();
        expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());

        const index = await memoryIndex(userId);
        expect(index.split('\n')).toEqual(['- B: second', '- A: first']);
        void a;
    });

    test('the index stays within its budget', async () => {
        const userId = user();
        for (let i = 0; i < 40; i += 1) {
            await remember(userId, { key: `skill:s${i}`, label: `Skill ${i}`, text: `Used skill number ${i} across several production services for years`, source: 'chat' });
        }
        const index = await memoryIndex(userId);
        expect(index.length).toBeGreaterThan(0);
        expect(index.length).toBeLessThanOrEqual(MEMORY_INDEX_MAX_CHARS);
    });
});

describe('sensitivity is a query concern (rule 3)', () => {
    test('the shareable filter is in the where-clause', () => {
        expect(shareableMemoryWhere('u1')).toEqual({ userId: 'u1', status: 'active', sensitivity: 'shareable' });
    });

    test('a private memory never reaches the shareable index or outreach evidence', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Voice agent on Claude at Plivo', source: 'clarification_answer' });
        await remember(userId, { key: 'pref:min_comp', label: 'Minimum pay', text: '₹60 LPA floor', source: 'scout_answer', sensitivity: 'private' });

        const shareable = await memoryIndex(userId, { shareableOnly: true });
        expect(shareable).toContain('Voice agent on Claude');
        expect(shareable).not.toContain('LPA');
        // The user's own chat index has both.
        expect(await memoryIndex(userId)).toContain('LPA');

        const evidence = (await loadShareableEvidence(userId)).map((line) => line.text).join('\n');
        expect(evidence).toContain('Claude: Voice agent on Claude at Plivo');
        expect(evidence).not.toContain('LPA');
    });
});
