/**
 * Ask only what is unknown (docs/impl/08-memory.md §3–4), against the local
 * Postgres. The model is kept out by seeding `ParsedJDCache` for each posting,
 * and the queue by the `channelGenerate` enqueue seam.
 *
 * What is proven:
 *   - answering a resume question (web or Telegram) remembers it under the
 *     question's topic; "skip" and "no" remember nothing;
 *   - a skill the record already evidences is not asked about, including
 *     the production case (the record says "Anthropic models", the posting
 *     asks for "Claude") and a confirmed, shareable Win;
 *   - a second tailoring that needs the same skill asks nothing, uses the
 *     stored answer as the clarification answer, and says so;
 *   - the question cap counts only questions actually asked;
 *   - a Scout preference answer is remembered too, private where it should be.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { GenerationStatus, WinSensitivity, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyAnswerToProfile } from '@/lib/scout/preferences';
import { __testing as generateTesting, CLARIFICATION_MARKER, processChannelGenerate } from '@/services/channelGenerate';
import { cleanupTestUser, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import { listMemories, remember } from '@/services/memory';

const RUN = `itest-memcap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];
const jdHashes: string[] = [];
let postings = 0;

/** A posting whose parsed requirements are exactly `skills`. */
async function posting(skills: string[]): Promise<string> {
    postings += 1;
    const jd = `Engineer #${postings} at Acme (${RUN}). ${'We build real-time voice infrastructure for businesses. '.repeat(4)}\nRequirements: ${skills.join(', ')}.`;
    const hash = createHash('sha256').update(jd.trim()).digest('hex');
    jdHashes.push(hash);
    await prisma.parsedJDCache.upsert({
        where: { jdHash: hash },
        create: { jdHash: hash, parsedJD: { role: 'Engineer', company: 'Acme', requiredSkills: skills, preferredSkills: [] }, expiresAt: new Date(Date.now() + 3_600_000) },
        update: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return jd;
}

async function seedUser(description = 'Built TypeScript services on PostgreSQL.'): Promise<string> {
    const userId = newTestUserId('memcap');
    users.push(userId);
    await prisma.userExperience.create({
        data: { userId, company: 'Plivo', role: 'Engineer', startDate: '2022', description, current: true },
    });
    return userId;
}

const enqueued: string[] = [];
beforeAll(() => {
    generateTesting.setEnqueuer(async (sessionId) => {
        enqueued.push(sessionId);
        return { runId: 'test' };
    });
});

afterAll(async () => {
    generateTesting.setEnqueuer(null);
    await prisma.generationSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.parsedJDCache.deleteMany({ where: { jdHash: { in: jdHashes } } });
    for (const id of users) await cleanupTestUser(id);
});

async function start(userId: string, jd: string, channel: 'web' | 'telegram' = 'web') {
    return processChannelGenerate({ userId, channel, message: jd });
}

describe('answering a question remembers it', () => {
    test('web: the answer is stored under the question\'s topic, in the user\'s words', async () => {
        const userId = await seedUser();
        const started = await start(userId, await posting(['Kubernetes', 'TypeScript']));
        expect(started.status).toBe('awaiting_clarification');
        expect(started.nextQuestion?.gap).toBe('Kubernetes');

        const answered = await processChannelGenerate({ userId, channel: 'web', sessionId: started.sessionId, message: 'Yes, ran EKS clusters for 40 services at Plivo' });
        expect(answered.success).toBe(true);

        const memories = await listMemories(userId);
        expect(memories).toHaveLength(1);
        expect(memories[0]).toMatchObject({
            key: 'skill:kubernetes',
            label: 'Kubernetes',
            text: 'Ran EKS clusters for 40 services at Plivo',
            source: 'clarification_answer',
            sensitivity: 'shareable',
        });
        const row = await prisma.userMemory.findFirstOrThrow({ where: { userId } });
        expect(row.sourceRef).toBe(`generation:${started.sessionId}:q1`);
    });

    test('Telegram: the same path remembers it', async () => {
        const userId = await seedUser();
        const started = await start(userId, await posting(['Terraform']), 'telegram');
        expect(started.status).toBe('awaiting_clarification');
        await processChannelGenerate({ userId, channel: 'telegram', sessionId: started.sessionId, message: 'Terraform modules for our AWS accounts' });
        expect((await listMemories(userId)).map((m) => [m.key, m.text])).toEqual([['skill:terraform', 'Terraform modules for our AWS accounts']]);
    });

    test('"skip", "skip all" and "no" remember nothing', async () => {
        const userId = await seedUser();
        const started = await start(userId, await posting(['Kubernetes', 'Terraform', 'Kafka']));
        await processChannelGenerate({ userId, channel: 'web', sessionId: started.sessionId, skip: true });
        await processChannelGenerate({ userId, channel: 'web', sessionId: started.sessionId, message: 'no, never used it' });
        await processChannelGenerate({ userId, channel: 'web', sessionId: started.sessionId, skipAll: true });
        expect(await listMemories(userId)).toHaveLength(0);
    });
});

describe('the record answers what it already shows: no question', () => {
    test('"Anthropic models" in the record answers a posting that asks for Claude', async () => {
        const userId = await seedUser('Built the voice agent at Plivo in TypeScript; it runs on Anthropic models for intent detection.');
        const started = await start(userId, await posting(['Claude', 'TypeScript']));
        expect(started.success).toBe(true);
        expect(started.status).toBe('generating');
        expect(started.questions ?? []).toHaveLength(0);
        expect(enqueued).toContain(started.sessionId!);
    });

    test('a confirmed, shareable Win evidences a skill; a draft or confidential one does not', async () => {
        const userId = await seedUser();
        const shareable = await makeWin({ userId, title: 'Shipped an MCP server for internal tools', narrative: 'Let agents call our billing APIs.' });
        await prisma.win.update({ where: { id: shareable.id }, data: { status: WinStatus.confirmed, confirmedAt: new Date() } });
        await makeWin({ userId, title: 'Wrote Terraform modules', narrative: 'Draft, never confirmed.' });
        const secret = await makeWin({ userId, title: 'Kafka migration for the confidential client', sensitivity: WinSensitivity.confidential });
        await prisma.win.update({ where: { id: secret.id }, data: { status: WinStatus.confirmed, confirmedAt: new Date() } });

        const started = await start(userId, await posting(['MCP', 'Terraform', 'Kafka']));
        expect(started.status).toBe('awaiting_clarification');
        expect((started.questions ?? []).map((q) => q.gap)).toEqual(['Terraform', 'Kafka']);
    });

    test('two spellings of one skill are one question', async () => {
        const userId = await seedUser();
        const started = await start(userId, await posting(['Kubernetes', 'K8s', 'kubernetes']));
        expect((started.questions ?? []).map((q) => q.gap)).toEqual(['Kubernetes']);
    });
});

describe('a second tailoring uses what the user said instead of asking', () => {
    test('same skill on a later posting: no question, the stored answer is used, and it says so', async () => {
        const userId = await seedUser();
        const first = await start(userId, await posting(['Kubernetes', 'TypeScript']));
        expect(first.nextQuestion?.gap).toBe('Kubernetes');
        await processChannelGenerate({ userId, channel: 'web', sessionId: first.sessionId, message: 'Ran EKS clusters for 40 services at Plivo' });

        const second = await start(userId, await posting(['K8s', 'PostgreSQL']));
        expect(second.success).toBe(true);
        expect(second.status).toBe('generating');
        expect(second.questions ?? []).toHaveLength(0);
        expect(second.remembered).toHaveLength(1);
        expect(second.remembered?.[0]).toMatchObject({ gap: 'K8s', key: 'skill:kubernetes', text: 'Ran EKS clusters for 40 services at Plivo' });

        // Exactly like a clarification answer: appended to the posting the
        // pipeline reads, under the same marker.
        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: second.sessionId } });
        expect(session.jobDescription).toContain(CLARIFICATION_MARKER);
        expect(session.jobDescription).toContain('Answer: Ran EKS clusters for 40 services at Plivo');
        expect((session.clarifications as { remembered?: unknown[] }).remembered).toHaveLength(1);
        expect(enqueued).toContain(second.sessionId!);

        // Counted, so it sorts first in the prompt index.
        const memory = await prisma.userMemory.findFirstOrThrow({ where: { userId, status: 'active' } });
        expect(memory.useCount).toBe(1);

        // A memory is user-stated, never evidence: no Win, no Evidence row.
        expect(await prisma.win.count({ where: { userId } })).toBe(0);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
    });

    test('only the unknown is asked; the remembered answer joins the typed one', async () => {
        const userId = await seedUser();
        await remember(userId, { key: 'skill:claude', label: 'Claude', text: 'Voice agent on Claude Sonnet', source: 'clarification_answer' });
        const started = await start(userId, await posting(['Claude', 'Terraform']));
        expect(started.status).toBe('awaiting_clarification');
        expect((started.questions ?? []).map((q) => q.gap)).toEqual(['Terraform']);
        expect(started.remembered?.map((r) => r.gap)).toEqual(['Claude']);

        const done = await processChannelGenerate({ userId, channel: 'web', sessionId: started.sessionId, message: 'Terraform for AWS accounts' });
        expect(done.status).toBe('generating');
        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: started.sessionId } });
        expect(session.jobDescription).toContain('Answer: Voice agent on Claude Sonnet');
        expect(session.jobDescription).toContain('Answer: Terraform for AWS accounts');
    });

    test('the cap counts questions asked, not gaps answered from memory', async () => {
        const userId = await seedUser();
        await remember(userId, { key: 'skill:kubernetes', label: 'Kubernetes', text: 'EKS at Plivo', source: 'clarification_answer' });
        const started = await start(userId, await posting(['Kubernetes', 'Terraform', 'Kafka', 'Rust', 'Elixir']));
        expect(started.remembered?.map((r) => r.gap)).toEqual(['Kubernetes']);
        expect((started.questions ?? []).map((q) => q.gap)).toEqual(['Terraform', 'Kafka', 'Rust']);
    });

    test('a forgotten memory is unknown again, and is asked', async () => {
        const userId = await seedUser();
        const saved = await remember(userId, { key: 'skill:terraform', text: 'Terraform for AWS', source: 'clarification_answer' });
        await prisma.userMemory.update({ where: { id: saved!.id }, data: { status: 'deleted' } });
        const started = await start(userId, await posting(['Terraform']));
        expect(started.status).toBe('awaiting_clarification');
        expect(started.remembered).toBeUndefined();
    });

    test('auto-generate users never get questions, but memory still answers', async () => {
        const userId = await seedUser();
        await prisma.userProfile.create({ data: { userId, preferences: { autoGenerate: true } } });
        await remember(userId, { key: 'skill:kafka', text: 'Kafka consumers for call events', source: 'clarification_answer' });
        const started = await start(userId, await posting(['Kafka', 'Rust']));
        expect(started.status).toBe('generating');
        expect(started.remembered?.map((r) => r.gap)).toEqual(['Kafka']);
        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: started.sessionId } });
        expect(session.status).toBe(GenerationStatus.generating);
        expect(session.jobDescription).toContain('Answer: Kafka consumers for call events');
    });
});

describe('a Scout answer is remembered too', () => {
    test('an understood answer is kept; pay is private; noise is not kept', async () => {
        const userId = await seedUser();
        await applyAnswerToProfile(userId, 'pref.workMode', 'Remote, or hybrid in Bengaluru', 'run-1');
        await applyAnswerToProfile(userId, 'pref.minComp', '₹45 LPA', 'run-1');
        await applyAnswerToProfile(userId, 'pref.relocate', 'banana', 'run-1');

        const memories = await listMemories(userId);
        const byKey = Object.fromEntries(memories.map((m) => [m.key, m]));
        expect(byKey['pref:work_mode']).toMatchObject({ text: 'Remote, or hybrid in Bengaluru', source: 'scout_answer', sensitivity: 'shareable', label: 'Work mode' });
        expect(byKey['pref:min_comp']).toMatchObject({ text: '₹45 LPA', sensitivity: 'private' });
        expect(byKey['pref:relocate']).toBeUndefined();
        const row = await prisma.userMemory.findFirstOrThrow({ where: { userId, key: 'pref:work_mode' } });
        expect(row.sourceRef).toBe('scout:run-1:pref.workMode');
    });
});
