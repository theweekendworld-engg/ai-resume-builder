/**
 * Weekly memory consolidation (docs/impl/08-memory.md §5), against the local
 * Postgres with the model scripted.
 *
 * What is proven: lines on one topic merge into one; a fresh line is rewritten
 * to fewer words; a rewrite that adds a word, or that the numeric guard had to
 * strip, keeps the originals; a merge never widens sensitivity; a second run
 * has nothing to do and never calls the model; the dispatcher fans out one
 * child per user with fresh lines, keyed per user-week.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { prisma } from '@/lib/prisma';
import { memoryConsolidateDedupeKey, memoryConsolidateHandler } from '@/lib/jobs/handlers/memoryConsolidate';
import type { EnqueueFn, JobContext } from '@/lib/jobs/types';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';
import { addsNothing, consolidateMemories, joinLines } from './memoryConsolidation';
import { remember } from './memory';

const WEEK = '2026-11-09';
const users: string[] = [];
function user(): string {
    const id = newTestUserId('memcons');
    users.push(id);
    return id;
}

let calls = 0;
let prompts: string[] = [];
/** The scripted model: a function of the prompt, so each test says what it returns. */
let reply: (prompt: string) => unknown = () => ({ items: [] });

beforeAll(() => {
    structuredTesting.setUsageLogger(async () => undefined);
    structuredTesting.setBudgetGuard(async () => undefined);
    structuredTesting.setObjectRunner(async ({ prompt }) => {
        calls += 1;
        prompts.push(prompt);
        return { object: reply(prompt), inputTokens: 100, outputTokens: 20 };
    });
});

afterEach(() => {
    calls = 0;
    prompts = [];
    reply = () => ({ items: [] });
});

afterAll(async () => {
    structuredTesting.reset();
    for (const id of users) await cleanupTestUser(id);
});

const active = (userId: string) => prisma.userMemory.findMany({ where: { userId, status: 'active' }, orderBy: { key: 'asc' } });

describe('the "nothing new" check', () => {
    test('every word of the rewrite must already be in the topic\'s lines', () => {
        expect(addsNothing('Claude Sonnet voice agent at Plivo', ['I built a voice agent at Plivo using Claude Sonnet'])).toBe(true);
        expect(addsNothing('Claude Sonnet voice agent at Plivo; 2k calls/day', ['voice agent on Claude Sonnet at Plivo, 2k calls/day'])).toBe(true);
        expect(addsNothing('Claude expert at Plivo', ['voice agent on Claude at Plivo'])).toBe(false);
        expect(addsNothing('Handles 3k calls', ['handles 2k calls'])).toBe(false);
    });

    test('a merge by joining adds no word', () => {
        expect(joinLines(['Ran EKS clusters.', 'ran eks clusters', 'Helm charts for 40 services'])).toBe('Ran EKS clusters; Helm charts for 40 services');
    });
});

describe('consolidateMemories', () => {
    test('rewrites a fresh line to the fewest words and supersedes it', async () => {
        const userId = user();
        const original = await remember(userId, {
            key: 'skill:claude', label: 'Claude',
            text: 'I built a production voice agent at Plivo using Claude Sonnet that handles 2k calls a day',
            source: 'clarification_answer',
        });
        reply = () => ({ items: [{ index: 1, text: 'Claude Sonnet production voice agent at Plivo; 2k calls a day' }] });

        const result = await consolidateMemories(userId, { weekKey: WEEK });
        expect(result).toMatchObject({ rewritten: 1, merged: 0, kept: 0 });
        expect(calls).toBe(1);

        const rows = await active(userId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ key: 'skill:claude', label: 'Claude', text: 'Claude Sonnet production voice agent at Plivo; 2k calls a day', source: 'consolidation', sourceRef: `consolidate:${WEEK}` });
        const old = await prisma.userMemory.findUniqueOrThrow({ where: { id: original!.id } });
        expect(old).toMatchObject({ status: 'superseded', supersededById: rows[0].id });
    });

    test('merges lines on one topic (an alias key) into one, keeping the most private sensitivity and the usage', async () => {
        const userId = user();
        // Written as an older build would have: two raw keys for one topic.
        await prisma.userMemory.create({ data: { userId, key: 'skill:k8s', label: 'K8s', text: 'Ran EKS clusters at Plivo for two years', source: 'clarification_answer', useCount: 2 } });
        await prisma.userMemory.create({ data: { userId, key: 'skill:kubernetes', label: 'Kubernetes', text: 'Wrote Helm charts for 40 services at Plivo', source: 'clarification_answer', sensitivity: 'private', useCount: 1 } });
        reply = () => ({ items: [{ index: 1, text: 'EKS clusters, Helm charts for 40 services at Plivo' }] });

        const result = await consolidateMemories(userId, { weekKey: WEEK });
        expect(result).toMatchObject({ merged: 1 });
        const rows = await active(userId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ key: 'skill:kubernetes', text: 'EKS clusters, Helm charts for 40 services at Plivo', sensitivity: 'private', useCount: 3 });
        expect(await prisma.userMemory.count({ where: { userId, status: 'superseded', supersededById: rows[0].id } })).toBe(2);
    });

    test('a rewrite that adds a word keeps the original', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:rust', text: 'Wrote a small Rust CLI to tail call logs at work', source: 'clarification_answer' });
        reply = () => ({ items: [{ index: 1, text: 'Expert Rust engineer, CLI tooling' }] });

        const result = await consolidateMemories(userId, { weekKey: WEEK });
        expect(result).toMatchObject({ rewritten: 0, kept: 1 });
        const rows = await active(userId);
        expect(rows[0]).toMatchObject({ text: 'Wrote a small Rust CLI to tail call logs at work', source: 'clarification_answer' });
    });

    test('if the numeric guard strips anything, every original is kept', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:kafka', text: 'Built Kafka consumers for call events at Plivo last year', source: 'clarification_answer' });
        await remember(userId, { key: 'skill:go', text: 'Go services for the billing team at Plivo since joining', source: 'clarification_answer' });
        // Topic 2 is fine; topic 1 invents a figure, on the first try and the corrective retry.
        reply = () => ({ items: [
            { index: 1, text: 'Kafka consumers, 10M events/day, Plivo' },
            { index: 2, text: 'Go billing services at Plivo' },
        ] });

        const result = await consolidateMemories(userId, { weekKey: WEEK });
        expect(result.skipped).toBe('guard');
        expect(calls).toBe(2); // the attempt and its one corrective retry
        const rows = await active(userId);
        expect(rows.map((row) => row.source)).toEqual(['clarification_answer', 'clarification_answer']);
        expect(await prisma.userMemory.count({ where: { userId, source: 'consolidation' } })).toBe(0);
    });

    test('the guard is shown only the memories: the prompt is the topics, the source is their lines', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:python', label: 'Python', text: 'FastAPI services for the dialer team at Plivo since 2022', source: 'clarification_answer' });
        reply = () => ({ items: [{ index: 1, text: 'FastAPI services, dialer team, Plivo, since 2022' }] });
        await consolidateMemories(userId, { weekKey: WEEK });
        expect(prompts[0]).toContain('1. Python');
        expect(prompts[0]).toContain('- FastAPI services for the dialer team at Plivo since 2022');
    });

    test('idempotent: a second run has nothing to do and never calls the model', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:claude', text: 'I built a production voice agent at Plivo using Claude Sonnet', source: 'clarification_answer' });
        reply = () => ({ items: [{ index: 1, text: 'Claude Sonnet production voice agent at Plivo' }] });
        await consolidateMemories(userId, { weekKey: WEEK });
        const after = await prisma.userMemory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
        calls = 0;

        const again = await consolidateMemories(userId, { weekKey: WEEK });
        expect(again.skipped).toBe('nothing_to_do');
        expect(calls).toBe(0);
        expect(await prisma.userMemory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).toEqual(after);
    });

    test('short lines, user edits and consolidated lines are left alone', async () => {
        const userId = user();
        await remember(userId, { key: 'pref:work_mode', text: 'remote', source: 'scout_answer' });
        await remember(userId, { key: 'skill:java', text: 'Spring Boot services at Plivo for the reporting team, four of them', source: 'user_edit' });
        const result = await consolidateMemories(userId, { weekKey: WEEK });
        expect(result.skipped).toBe('nothing_to_do');
        expect(calls).toBe(0);
    });
});

describe('memory_consolidate handler', () => {
    function context(): { ctx: JobContext; enqueued: Array<{ payload: object; dedupeKey?: string }> } {
        const enqueued: Array<{ payload: object; dedupeKey?: string }> = [];
        const enqueue: EnqueueFn = async (_kind, payload, opts) => {
            enqueued.push({ payload, dedupeKey: opts?.dedupeKey });
            return { jobId: `j${enqueued.length}`, deduped: false };
        };
        return {
            ctx: { jobId: 'parent', attempt: 1, deadline: new Date(Date.now() + 30_000), enqueue, log: () => undefined },
            enqueued,
        };
    }

    test('dispatch fans out one child per user with a fresh line, keyed per user-week', async () => {
        const fresh = user();
        const stale = user();
        const done = user();
        await remember(fresh, { key: 'skill:go', text: 'Go services for billing at Plivo since 2023', source: 'clarification_answer' });
        await prisma.userMemory.create({ data: { userId: stale, key: 'skill:go', text: 'Old line', source: 'clarification_answer', createdAt: new Date(Date.now() - 30 * 86_400_000) } });
        await prisma.userMemory.create({ data: { userId: done, key: 'skill:go', text: 'Go billing', source: 'consolidation' } });

        const { ctx, enqueued } = context();
        await memoryConsolidateHandler({}, ctx);
        const children = enqueued.filter((entry) => [fresh, stale, done].includes((entry.payload as { userId: string }).userId));
        expect(children).toHaveLength(1);
        const payload = children[0].payload as { userId: string; week: string };
        expect(payload.userId).toBe(fresh);
        expect(children[0].dedupeKey).toBe(memoryConsolidateDedupeKey(fresh, payload.week));
        expect(children[0].dedupeKey).toBe(`memory_consolidate:${fresh}:${payload.week}`);
    });

    test('a child consolidates its user', async () => {
        const userId = user();
        await remember(userId, { key: 'skill:claude', text: 'I built a production voice agent at Plivo using Claude Sonnet', source: 'clarification_answer' });
        reply = () => ({ items: [{ index: 1, text: 'Claude Sonnet voice agent at Plivo' }] });
        const { ctx, enqueued } = context();
        const result = await memoryConsolidateHandler({ userId, week: WEEK }, ctx);
        expect(result).toMatchObject({ userId, weekKey: WEEK, rewritten: 1 });
        expect(enqueued).toHaveLength(0); // a child never fans out
    });

    test('a garbage payload throws rather than running as a dispatch', async () => {
        const { ctx } = context();
        await expect(memoryConsolidateHandler({ userId: 'u', week: 'last week' }, ctx)).rejects.toThrow('invalid payload');
    });
});
