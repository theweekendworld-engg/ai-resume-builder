/**
 * Chat, end to end against the local Postgres (docs/prd/10-chat.md §3 "Done
 * when"). The router's model output is scripted; everything after it (the
 * services, the rows, the rule-5 transaction) is real.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GroundState, WinSource, WinStatus } from '@prisma/client';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { emptyDecision } from '@/lib/chat/router';
import type { RouteDecision } from '@/lib/chat/types';
import { prisma } from '@/lib/prisma';
import { installMocks, uninstallMocks } from '@/__mocks__';
import { __testing as draftTesting } from '@/services/winDrafting';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';
import { confirmWinForUser } from '@/services/wins';
import { listThread, routeChannelText, sendChatMessage } from './chat';

const STRUCTURED_WIN = {
    title: 'Moved order events onto Kafka',
    narrative: 'Replaced the polling job with a Kafka consumer for order events.',
    category: 'shipped',
    occurredAtHint: 'this_week',
    explicitDate: null,
    skills: ['kafka'],
    collaborators: [],
    suggestedSensitivity: 'shareable',
    quantified: false,
    impact: null,
    quantifyPrompt: null,
    confidence: 0.9,
};

let nextRoute: Partial<RouteDecision> | Error = {};

const users: string[] = [];
const sources: string[] = [];
function user(label: string): string {
    const id = newTestUserId(`chat-${label}`);
    users.push(id);
    return id;
}

beforeAll(() => {
    installMocks({ only: ['openai'] });
    aiTesting.setUsageLogger(async () => {});
    // Routing calls get the scripted decision; the Win structuring call gets a draft.
    aiTesting.setObjectRunner(async ({ prompt }) => {
        if (prompt.includes('New message from the user')) {
            if (nextRoute instanceof Error) throw nextRoute;
            return { object: { ...emptyDecision('answer', ''), ...nextRoute }, inputTokens: 1, outputTokens: 1 };
        }
        return { object: STRUCTURED_WIN, inputTokens: 1, outputTokens: 1 };
    });
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterEach(() => {
    nextRoute = {};
});

afterAll(async () => {
    aiTesting.reset();
    draftTesting.reset();
    uninstallMocks();
    for (const id of users) {
        await prisma.chatConversation.deleteMany({ where: { userId: id } });
        await prisma.applicationWorkspace.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
    for (const id of sources) await prisma.jobSource.deleteMany({ where: { id } });
});

const send = (userId: string, text: string, clientId = crypto.randomUUID()) =>
    sendChatMessage({ userId, text, clientId });

describe('log_work: a Win drafted in chat is not in the record until Confirm', () => {
    test('the router drafts; only the tap writes Evidence + ClaimLink (rule 5)', async () => {
        const userId = user('log');
        nextRoute = { action: 'log_work', reply: 'Drafting that.', text: 'moved order events onto Kafka this week' };
        const result = await send(userId, 'moved order events onto Kafka this week');
        expect(result.success).toBe(true);
        if (!result.success) return;

        const card = result.data.assistant.cards[0];
        expect(card.type).toBe('win_draft');
        if (card.type !== 'win_draft') return;

        const win = await prisma.win.findUniqueOrThrow({ where: { id: card.winId } });
        expect(win.status).toBe(WinStatus.draft);
        expect(win.source).toBe(WinSource.chat);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);

        const confirmed = await confirmWinForUser(userId, card.winId);
        expect(confirmed.success).toBe(true);
        expect(await prisma.evidence.count({ where: { userId, confirmedByUser: true } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: card.winId, groundState: GroundState.grounded } })).toBe(1);

        // A reload shows it confirmed, so Confirm is never offered twice.
        const thread = await listThread(userId);
        const reloaded = thread.flatMap((m) => m.cards).find((c) => c.type === 'win_draft');
        expect(reloaded && reloaded.type === 'win_draft' && reloaded.current).toBe('confirmed');
    });
});

describe('idempotency', () => {
    test('the same clientId twice is one message and one reply', async () => {
        const userId = user('idem');
        nextRoute = { action: 'answer', reply: 'Start with the job description.' };
        const clientId = crypto.randomUUID();
        const first = await send(userId, 'how do I prepare?', clientId);
        const second = await send(userId, 'how do I prepare?', clientId);
        expect(first.success && second.success).toBe(true);
        if (!first.success || !second.success) return;
        expect(second.data.user.id).toBe(first.data.user.id);
        expect(second.data.assistant.id).toBe(first.data.assistant.id);
        expect(await prisma.chatMessage.count({ where: { userId } })).toBe(2);
    });
});

describe('failure', () => {
    test('a router failure keeps what the user typed and says what to do', async () => {
        const userId = user('fail');
        nextRoute = new Error('model down');
        const result = await send(userId, 'something only a model could read');
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.user.text).toBe('something only a model could read');
        expect(result.data.assistant.text).toContain('Try rephrasing');
        expect(await prisma.chatMessage.count({ where: { userId } })).toBe(2);
    });
});

describe('update_job', () => {
    test('moves the job the router picked by index, and only that one', async () => {
        const userId = user('job');
        const older = await prisma.applicationWorkspace.create({
            data: { userId, sourceUrl: `https://jobs.example.com/${userId}/1`, companyName: 'Razorpay', roleTitle: 'SDE II', applicationStatus: 'analyzed' },
        });
        await new Promise((r) => setTimeout(r, 5));
        const newer = await prisma.applicationWorkspace.create({
            data: { userId, sourceUrl: `https://jobs.example.com/${userId}/2`, companyName: 'Eltropy', roleTitle: 'Senior Backend Engineer', applicationStatus: 'analyzed' },
        });
        // Index 1 is the most recently updated job: Eltropy.
        nextRoute = { action: 'update_job', reply: 'Marked as applied.', jobIndex: 1, jobAction: 'applied' };
        const result = await send(userId, 'I applied to the Eltropy one');
        expect(result.success).toBe(true);
        expect((await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: newer.id } })).applicationStatus).toBe('applied');
        expect((await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: older.id } })).applicationStatus).toBe('analyzed');
    });
});

describe('find_jobs', () => {
    test('searches open postings on the boards we ingest', async () => {
        const userId = user('find');
        const token = `chat-test-${crypto.randomUUID()}`;
        const source = await prisma.jobSource.create({ data: { provider: 'greenhouse', boardToken: token, companyName: 'Acme Payments' } });
        sources.push(source.id);
        await prisma.jobPosting.createMany({
            data: [
                { sourceId: source.id, externalId: '1', title: 'Senior Backend Engineer, Ledger', location: 'Remote - India', absoluteUrl: `https://boards.greenhouse.io/${token}/jobs/1`, contentHash: 'a', postedAt: new Date() },
                { sourceId: source.id, externalId: '2', title: 'Backend Engineer', location: 'Remote', absoluteUrl: `https://boards.greenhouse.io/${token}/jobs/2`, contentHash: 'b', closedAt: new Date() },
                { sourceId: source.id, externalId: '3', title: 'Product Designer', location: 'Remote', absoluteUrl: `https://boards.greenhouse.io/${token}/jobs/3`, contentHash: 'c' },
            ],
        });
        nextRoute = { action: 'find_jobs', reply: 'Open roles that match.', query: 'backend engineer ledger', remoteOnly: true };
        const result = await send(userId, 'find me remote backend engineer roles on ledgers');
        expect(result.success).toBe(true);
        if (!result.success) return;
        const card = result.data.assistant.cards[0];
        expect(card?.type).toBe('postings');
        if (card?.type !== 'postings') return;
        const mine = card.items.filter((p) => p.company === 'Acme Payments');
        // The closed posting and the designer role are not offered.
        expect(mine.map((p) => p.title)).toEqual(['Senior Backend Engineer, Ledger']);
    });
});

describe('find_jobs by company', () => {
    test('"Engineering jobs at Acme" filters on the company, not the title', async () => {
        const userId = user('findco');
        const token = `chat-test-co-${crypto.randomUUID()}`;
        const source = await prisma.jobSource.create({ data: { provider: 'greenhouse', boardToken: token, companyName: 'Zebracorp Labs' } });
        sources.push(source.id);
        await prisma.jobPosting.createMany({
            data: [{ sourceId: source.id, externalId: 'z1', title: 'Software Engineer, Platform', location: 'Remote', absoluteUrl: `https://boards.greenhouse.io/${token}/jobs/z1`, contentHash: 'z', postedAt: new Date() }],
        });
        // The model wrote the company into the query, as it did in QA.
        nextRoute = { action: 'find_jobs', reply: 'x', query: 'Engineer at Zebracorp' };
        const result = await send(userId, 'find me engineering jobs at Zebracorp');
        const card = result.success ? result.data.assistant.cards[0] : null;
        expect(card?.type).toBe('postings');
        if (card?.type !== 'postings') return;
        expect(card.items.map((p) => p.company)).toEqual(['Zebracorp Labs']);
    });
});

describe('ask_record', () => {
    test('finds the user\'s own confirmed Win, and never another user\'s', async () => {
        const userId = user('record');
        const stranger = user('stranger');
        for (const owner of [userId, stranger]) {
            nextRoute = { action: 'log_work', reply: 'Drafting.', text: 'moved order events onto Kafka' };
            const drafted = await send(owner, 'moved order events onto Kafka');
            const card = drafted.success ? drafted.data.assistant.cards[0] : null;
            if (card?.type === 'win_draft') await confirmWinForUser(owner, card.winId);
        }
        nextRoute = { action: 'ask_record', reply: 'From your record.', query: 'kafka' };
        const result = await send(userId, 'what did I do with Kafka?');
        expect(result.success).toBe(true);
        if (!result.success) return;
        const card = result.data.assistant.cards[0];
        expect(card?.type).toBe('record');
        if (card?.type !== 'record') return;
        const owners = await prisma.win.findMany({ where: { id: { in: card.items.map((i) => i.winId) } }, select: { userId: true } });
        expect(owners.length).toBeGreaterThan(0);
        expect(owners.every((w) => w.userId === userId)).toBe(true);
    });
});

describe('job actions without a job', () => {
    test('tailor with an empty tracker asks for a link instead of guessing', async () => {
        const userId = user('nojob');
        nextRoute = { action: 'tailor_resume', reply: 'Tailoring.', jobIndex: 1 };
        const result = await send(userId, 'tailor my resume for it');
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.assistant.text).toContain('job link');
        expect(result.data.assistant.cards).toHaveLength(0);
    });
});

describe('channels', () => {
    test('with the chat flag off, a channel keeps its old flow and no model is called', async () => {
        const userId = user('flagoff');
        nextRoute = new Error('the router must not run when chat is off');
        expect(await routeChannelText(userId, 'show my pipeline', 'telegram')).toBeNull();
    });
});

describe('companyName', () => {
    test('keeps just the name, never the description', async () => {
        const { companyName } = await import('./chat');
        expect(companyName('Linear, the project management software company')).toBe('Linear');
        expect(companyName('Jack and Jill, the AI recruiting startup')).toBe('Jack and Jill');
        expect(companyName('The Browser Company')).toBe('The Browser Company');
        expect(companyName('Razorpay (payments)')).toBe('Razorpay');
    });

    test('keeps what the user said about the company as a hint', async () => {
        const { companyHint } = await import('./chat');
        expect(companyHint('Linear, the project management software company', 'Linear')).toBe('the project management software company');
        expect(companyHint('Razorpay', 'Razorpay')).toBeNull();
    });
});
