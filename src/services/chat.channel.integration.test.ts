/**
 * Telegram that remembers (docs/impl/07-telegram-apply.md §2), against the
 * local Postgres. Model output is scripted by which prompt it is; the focus,
 * the thread, the versioned drafts and the routing are real.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Channel } from '@prisma/client';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { FOCUS_TTL_MS, getFocus, setFocus } from '@/lib/chat/focus';
import { emptyDecision } from '@/lib/chat/router';
import type { RouteDecision } from '@/lib/chat/types';
import { prisma } from '@/lib/prisma';
import { installMocks, uninstallMocks } from '@/__mocks__';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';
import { routeChannelText } from './chat';

const users: string[] = [];
function user(label: string): string {
    const id = newTestUserId(`chatch-${label}`);
    users.push(id);
    return id;
}

/** What each kind of model call answers. */
let inTaskChoice: 'revise' | 'done' | 'other' | Error = 'revise';
let route: Partial<RouteDecision> = {};
const revision = { subject: 'Application: Forward Deployed AI Engineer', body: 'Hi Chris,\n\nShorter now. B.Tech from IIT Delhi.\n\nThanks,\nJai' };
const prompts: { kind: string; prompt: string }[] = [];

beforeAll(() => {
    installMocks({ only: ['openai'] });
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setBudgetGuard(async () => undefined);
    aiTesting.setObjectRunner(async ({ prompt }) => {
        if (prompt.includes("The user's new message")) {
            prompts.push({ kind: 'in_task', prompt });
            if (inTaskChoice instanceof Error) throw inTaskChoice;
            return { object: { choice: inTaskChoice }, inputTokens: 1, outputTokens: 1 };
        }
        if (prompt.includes('New message from the user')) {
            prompts.push({ kind: 'route', prompt });
            return { object: { ...emptyDecision('answer', 'Sure.'), ...route }, inputTokens: 1, outputTokens: 1 };
        }
        prompts.push({ kind: 'revise', prompt });
        return { object: revision, inputTokens: 1, outputTokens: 1 };
    });
});

afterEach(() => {
    inTaskChoice = 'revise';
    route = {};
    prompts.length = 0;
});

afterAll(async () => {
    aiTesting.reset();
    uninstallMocks();
    for (const id of users) {
        await prisma.messageDraft.deleteMany({ where: { userId: id } });
        await prisma.chatConversation.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

async function draftInFocus(userId: string) {
    const draft = await prisma.messageDraft.create({
        data: {
            userId, version: 1, format: 'email', target: 'poster', toEmail: 'jobs@iserveworld.com',
            subject: 'Application: Forward Deployed AI Engineer',
            body: 'Hi Chris,\n\nI would like to apply for the Forward Deployed AI Engineer role. My resume is attached.\n\nThanks,\nJai',
        },
    });
    await setFocus(userId, Channel.telegram, { kind: 'draft', draftId: draft.id, runId: null, workspaceId: null });
    return draft;
}

describe('a follow-up while a draft is in focus', () => {
    test('"add IIT Delhi" edits that draft: a new version, the focus moves to it, buttons come back', async () => {
        const userId = user('revise');
        const v1 = await draftInFocus(userId);

        const routed = await routeChannelText(userId, 'add that I went to IIT Delhi', 'telegram');
        expect(routed?.kind).toBe('rich');
        // The general router never saw it: one narrow choice, then the edit.
        expect(prompts.map((p) => p.kind)).toEqual(['in_task', 'revise']);
        expect(prompts[0].prompt).toContain('I would like to apply');

        const versions = await prisma.messageDraft.findMany({ where: { userId }, orderBy: { version: 'asc' } });
        expect(versions.map((v) => v.version)).toEqual([1, 2]);
        expect(versions[1]).toMatchObject({ parentId: v1.id, instruction: 'add that I went to IIT Delhi', toEmail: 'jobs@iserveworld.com' });

        const focus = await getFocus(userId, Channel.telegram);
        expect(focus).toMatchObject({ kind: 'draft', draftId: versions[1].id });

        if (routed?.kind === 'rich') {
            const labels = routed.message.actions.map((a) => a.label);
            expect(labels.join(' ')).toMatch(/Gmail/);
        }
    });

    test('a bare "shorter" is decided in code, with no routing call', async () => {
        const userId = user('shorter');
        await draftInFocus(userId);
        await routeChannelText(userId, 'shorter', 'telegram');
        expect(prompts.map((p) => p.kind)).toEqual(['revise']);
    });

    test('"done" clears the focus, so the next message is a new request', async () => {
        const userId = user('done');
        await draftInFocus(userId);
        const routed = await routeChannelText(userId, 'sent it, thanks', 'telegram');
        expect(routed).toMatchObject({ kind: 'reply' });
        expect(await getFocus(userId, Channel.telegram)).toBeNull();
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(1);
    });

    test('something else goes to the general router and the draft is untouched', async () => {
        const userId = user('other');
        await draftInFocus(userId);
        inTaskChoice = 'other';
        route = { action: 'answer', reply: 'Practice the system design round.' };
        const routed = await routeChannelText(userId, 'how do I prep for the onsite?', 'telegram');
        expect(routed).toEqual({ kind: 'reply', text: 'Practice the system design round.' });
        expect(prompts.map((p) => p.kind)).toEqual(['in_task', 'route']);
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(1);
    });

    test('an in-task model failure never eats the message: the general router takes it', async () => {
        const userId = user('fail');
        await draftInFocus(userId);
        inTaskChoice = new Error('model down');
        route = { action: 'answer', reply: 'Here to help.' };
        const routed = await routeChannelText(userId, 'what next?', 'telegram');
        expect(routed).toEqual({ kind: 'reply', text: 'Here to help.' });
    });

    test('an expired focus is ignored', async () => {
        const userId = user('expired');
        await draftInFocus(userId);
        await prisma.chatConversation.update({
            where: { userId_channel: { userId, channel: Channel.telegram } },
            data: { focusAt: new Date(Date.now() - FOCUS_TTL_MS - 1_000) },
        });
        route = { action: 'answer', reply: 'Okay.' };
        await routeChannelText(userId, 'make it warmer', 'telegram');
        expect(prompts.map((p) => p.kind)).toEqual(['route']);
    });
});

describe('Telegram memory', () => {
    test('turns are stored, and the router sees the earlier ones', async () => {
        const userId = user('memory');
        route = { action: 'answer', reply: 'Kafka is a good fit for that.' };
        await routeChannelText(userId, 'should I learn Kafka for the Acme role?', 'telegram');
        route = { action: 'answer', reply: 'Start with the docs.' };
        await routeChannelText(userId, 'where do I start with it?', 'telegram');

        const second = prompts.filter((p) => p.kind === 'route')[1].prompt;
        expect(second).toContain('Conversation so far');
        expect(second).toContain('should I learn Kafka for the Acme role?');
        expect(second).toContain('Kafka is a good fit for that.');

        const conversation = await prisma.chatConversation.findUniqueOrThrow({
            where: { userId_channel: { userId, channel: Channel.telegram } },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
        });
        expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });
});
