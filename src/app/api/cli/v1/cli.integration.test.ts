/**
 * The CLI API: a personal key acts as its owner and nobody else, a revoked
 * key stops working at once, and a chat turn runs the real chat service.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { invalidateFlagCache } from '@/lib/flags';
import { restoreFlags, setFlagForTest, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';
import { emptyDecision } from '@/lib/chat/router';
import { createApiKey, resolveApiKey } from '@/lib/apiKeys';
import { GET as me } from './me/route';
import { POST as chat } from './chat/route';
import { POST as confirm } from './confirm/route';
import { WinCategory, WinSource, WinStatus } from '@prisma/client';

const USER = `itest-cli-${Date.now()}`;
let flags: FlagSnapshot = [];
let key = '';

const req = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    new NextRequest(`http://localhost${path}`, {
        method: init.method ?? 'GET',
        headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });

beforeAll(async () => {
    flags = await snapshotFlags();
    await setFlagForTest('chat', { enabled: false, allowUserIds: [USER, `${USER}-other`] });
    invalidateFlagCache();
    await prisma.userProfile.create({ data: { userId: USER, fullName: 'CLI Tester', email: `${USER}@example.com` } });
    key = (await createApiKey(USER, 'test')).key;
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setObjectRunner(async () => ({ object: { ...emptyDecision('answer', 'Start with the posting.') }, inputTokens: 1, outputTokens: 1 }));
});

afterAll(async () => {
    aiTesting.reset();
    await restoreFlags(flags);
    invalidateFlagCache();
    await prisma.chatConversation.deleteMany({ where: { userId: USER } });
    await prisma.claimLink.deleteMany({ where: { userId: USER } });
    await prisma.evidence.deleteMany({ where: { userId: USER } });
    await prisma.win.deleteMany({ where: { userId: USER } });
    await prisma.apiKey.deleteMany({ where: { userId: USER } });
    await prisma.userProfile.deleteMany({ where: { userId: USER } });
});

describe('CLI API', () => {
    test('only the hash is stored, and the key resolves to its owner', async () => {
        const row = await prisma.apiKey.findFirstOrThrow({ where: { userId: USER } });
        expect(row.hash).not.toContain(key);
        expect(row.prefix).toBe(key.slice(0, 12));
        expect((await resolveApiKey(`Bearer ${key}`))?.userId).toBe(USER);
        expect(await resolveApiKey('Bearer pat_not-a-real-key-at-all-xxxxxxxx')).toBeNull();
        expect(await resolveApiKey(null)).toBeNull();
    });

    test('/me answers for the key owner; no key is a 401', async () => {
        const ok = await me(req('/api/cli/v1/me', { token: key }));
        expect(ok.status).toBe(200);
        expect((await ok.json()).name).toBe('CLI Tester');
        expect((await me(req('/api/cli/v1/me'))).status).toBe(401);
    });

    test('a chat turn runs the chat service and joins the web thread', async () => {
        const res = await chat(req('/api/cli/v1/chat', { method: 'POST', token: key, body: { text: 'how do I prepare?' } }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.action).toBe('answer');
        expect(body.text).toContain('Start with the posting.');
        expect(await prisma.chatMessage.count({ where: { userId: USER } })).toBe(2);
    });

    test('confirm writes the evidence for the owner, and only the owner', async () => {
        const win = await prisma.win.create({
            data: { userId: USER, title: 'Shipped it', narrative: 'n', occurredAt: new Date(), category: WinCategory.shipped, source: WinSource.chat, status: WinStatus.draft },
        });
        const other = await createApiKey(`${USER}-other`, 'x');
        const stranger = await confirm(req('/api/cli/v1/confirm', { method: 'POST', token: other.key, body: { winId: win.id } }));
        expect(stranger.status).not.toBe(200);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: win.id } })).status).toBe(WinStatus.draft);

        const res = await confirm(req('/api/cli/v1/confirm', { method: 'POST', token: key, body: { winId: win.id } }));
        expect(res.status).toBe(200);
        expect((await prisma.win.findUniqueOrThrow({ where: { id: win.id } })).status).toBe(WinStatus.confirmed);
        expect(await prisma.claimLink.count({ where: { userId: USER, claimRefId: win.id, groundState: 'grounded' } })).toBe(1);
        await prisma.apiKey.deleteMany({ where: { userId: `${USER}-other` } });
    });

    test('a revoked key stops working at once', async () => {
        await prisma.apiKey.updateMany({ where: { userId: USER }, data: { revokedAt: new Date() } });
        expect((await me(req('/api/cli/v1/me', { token: key }))).status).toBe(401);
    });
});
