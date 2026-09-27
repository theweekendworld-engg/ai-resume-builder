/**
 * Scout → tailored resume, per-job copies, and generation metering at value,
 * against the local Postgres (audit 2026-09-27, F and K).
 *
 * The model is kept out by seeding `ParsedJDCache` for each posting, and the
 * queue by the `channelGenerate` enqueue seam, so these tests prove the
 * storage and metering facts without firing a pipeline.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { GenerationStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    __testing as generateTesting,
    CLARIFICATION_MARKER,
    processChannelGenerate,
    stripClarificationBlock,
} from '@/services/channelGenerate';
import { resolveGenerationWriteTarget } from '@/actions/generationPipeline';
import { tailorResumeForRun } from '@/services/tailor';

const RUN = `itest-tailor-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let n = 0;
const users: string[] = [];
function user(label: string): string {
    n += 1;
    const id = `${RUN}-${label}-${n}`;
    users.push(id);
    return id;
}

/** A posting whose required skills the fixture record DOES cover: no questions. */
const COVERED_JD = `Backend Engineer at Acme. ${'We build payment infrastructure for merchants across India. '.repeat(4)}
Requirements: strong TypeScript and PostgreSQL experience building production services. Nice to have: Redis.`;
/** A posting that asks for something the record lacks: one question. */
const GAP_JD = `Platform Engineer at Globex. ${'We run a large fleet of services for logistics customers. '.repeat(4)}
Requirements: hands-on Kubernetes and TypeScript. Ownership of on-call rotations.`;

async function seedParsedJD(jd: string, requiredSkills: string[]) {
    const hash = createHash('sha256').update(jd.trim()).digest('hex');
    await prisma.parsedJDCache.upsert({
        where: { jdHash: hash },
        create: {
            jdHash: hash,
            parsedJD: { role: 'Engineer', company: 'Acme', requiredSkills, preferredSkills: [] },
            expiresAt: new Date(Date.now() + 3_600_000),
        },
        update: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
}

const BASE_CONTENT = {
    personalInfo: { fullName: 'Test Person', email: 't@example.com', phone: '', location: '', linkedin: '', github: '', website: '', title: 'Engineer', summary: 'Engineer.' },
    experience: [{ id: 'e1', company: 'Plivo', role: 'Engineer', startDate: '2022', endDate: '', current: true, location: '', description: ['Built TypeScript services on PostgreSQL.'] }],
    education: [],
    projects: [],
    skills: [{ id: 's1', name: 'Languages', skills: ['TypeScript', 'PostgreSQL'] }],
} as unknown as Prisma.InputJsonValue;

async function seedUser(options: { resume?: boolean; experience?: boolean } = {}) {
    const userId = user('u');
    if (options.experience !== false) {
        await prisma.userExperience.create({
            data: { userId, company: 'Plivo', role: 'Engineer', startDate: '2022', description: 'Built TypeScript services on PostgreSQL.', current: true },
        });
    }
    const base = options.resume === false
        ? null
        : await prisma.resume.create({ data: { userId, title: 'My Resume', content: BASE_CONTENT } });
    return { userId, base };
}

async function seedScoutJob(userId: string, jd: string) {
    n += 1;
    const run = await prisma.agentRun.create({
        data: {
            userId,
            agent: 'scout',
            inputKey: `linkedin_job:${RUN}-${n}`,
            input: { url: 'https://www.linkedin.com/jobs/view/1/', source: 'dashboard' },
            kind: 'job_posting',
            status: 'succeeded',
            result: {
                ingest: { status: 'ok', data: { text: jd, title: 'Backend Engineer', companyName: 'Acme' }, sources: [], finishedAt: new Date().toISOString() },
                jd: { status: 'ok', data: { role: 'Backend Engineer', company: 'Acme' }, sources: [], finishedAt: new Date().toISOString() },
            },
        },
    });
    const workspace = await prisma.applicationWorkspace.create({
        data: { userId, sourceUrl: `https://www.linkedin.com/jobs/view/${RUN}-${n}/`, scoutRunId: run.id, companyName: 'Acme', roleTitle: 'Backend Engineer', jobDescription: jd },
    });
    return { run, workspace };
}

/** Units of `tailored_generation` this user has been charged, net of refunds. */
async function charged(userId: string): Promise<number> {
    const rows = await prisma.usageQuota.findMany({ where: { userId, action: 'tailored_generation' }, select: { used: true } });
    return rows.reduce((sum, row) => sum + row.used, 0);
}

const enqueued: string[] = [];
beforeAll(async () => {
    await seedParsedJD(COVERED_JD, ['TypeScript', 'PostgreSQL']);
    await seedParsedJD(GAP_JD, ['Kubernetes', 'TypeScript']);
});
afterEach(() => {
    generateTesting.setEnqueuer(async (sessionId) => {
        enqueued.push(sessionId);
        return { runId: 'test' };
    });
});
generateTesting.setEnqueuer(async (sessionId) => {
    enqueued.push(sessionId);
    return { runId: 'test' };
});

afterAll(async () => {
    generateTesting.setEnqueuer(null);
    await prisma.generationSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: { in: users } } });
    await prisma.agentRun.deleteMany({ where: { userId: { in: users } } });
    await prisma.resume.deleteMany({ where: { userId: { in: users } } });
    await prisma.userExperience.deleteMany({ where: { userId: { in: users } } });
    await prisma.usageQuota.deleteMany({ where: { userId: { in: users } } });
});

describe('tailorResumeForRun', () => {
    test('makes a per-job copy, links it to the job, starts generation into it, and leaves the base alone', async () => {
        const { userId, base } = await seedUser();
        const { run, workspace } = await seedScoutJob(userId, COVERED_JD);

        const result = await tailorResumeForRun(userId, run.id, 'web');
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.status).toBe('generating');

        const copy = await prisma.resume.findUniqueOrThrow({ where: { id: result.data.resumeId! } });
        expect(copy.id).not.toBe(base!.id);
        expect(copy.baseResumeId).toBe(base!.id);
        expect(copy.workspaceId).toBe(workspace.id);
        expect(copy.title).toBe('Backend Engineer — Acme');

        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: result.data.sessionId } });
        expect(session.sourceResumeId).toBe(copy.id);
        expect(session.workspaceId).toBe(workspace.id);

        const ws = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });
        expect(ws.selectedResumeId).toBe(copy.id);

        // The master is untouched.
        const master = await prisma.resume.findUniqueOrThrow({ where: { id: base!.id } });
        expect(master.content).toEqual(BASE_CONTENT as Prisma.JsonValue);
        expect(master.baseResumeId).toBeNull();

        expect(enqueued).toContain(result.data.sessionId);
        expect(await charged(userId)).toBe(1);
    });

    test('is idempotent: a second tap returns the same generation and charges nothing more', async () => {
        const { userId } = await seedUser();
        const { run } = await seedScoutJob(userId, COVERED_JD);

        const first = await tailorResumeForRun(userId, run.id, 'web');
        const second = await tailorResumeForRun(userId, run.id, 'web');
        if (!first.success || !second.success) throw new Error('expected ok');
        expect(second.data.sessionId).toBe(first.data.sessionId);
        expect(second.data.resumeId).toBe(first.data.resumeId);
        expect(await prisma.resume.count({ where: { userId, NOT: { baseResumeId: null } } })).toBe(1);
        expect(await charged(userId)).toBe(1);
    });

    test('re-tailoring after a finished run reuses the same per-job copy', async () => {
        const { userId } = await seedUser();
        const { run } = await seedScoutJob(userId, COVERED_JD);
        const first = await tailorResumeForRun(userId, run.id, 'web');
        if (!first.success) throw new Error('expected ok');
        await prisma.generationSession.update({ where: { id: first.data.sessionId }, data: { status: GenerationStatus.completed } });

        const again = await tailorResumeForRun(userId, run.id, 'web');
        if (!again.success) throw new Error('expected ok');
        expect(again.data.sessionId).not.toBe(first.data.sessionId);
        expect(again.data.resumeId).toBe(first.data.resumeId);
    });

    test('no base resume → no_base_resume, and nothing is charged', async () => {
        const { userId } = await seedUser({ resume: false });
        const { run } = await seedScoutJob(userId, COVERED_JD);
        const result = await tailorResumeForRun(userId, run.id, 'web');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('no_base_resume');
        expect(await charged(userId)).toBe(0);
    });

    test("another user's run is not found", async () => {
        const { userId } = await seedUser();
        const other = await seedUser();
        const { run } = await seedScoutJob(other.userId, COVERED_JD);
        const result = await tailorResumeForRun(userId, run.id, 'web');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('not_found');
    });
});

describe('metering at value', () => {
    test('asking questions costs nothing; abandoning them costs nothing; finishing them costs one unit', async () => {
        const { userId } = await seedUser();
        const { run } = await seedScoutJob(userId, GAP_JD);

        const started = await tailorResumeForRun(userId, run.id, 'web');
        if (!started.success) throw new Error(started.error);
        expect(started.data.status).toBe('awaiting_clarification');
        expect(started.data.nextQuestion?.gap).toBe('Kubernetes');
        expect(await charged(userId)).toBe(0);

        const done = await processChannelGenerate({ userId, channel: 'web', sessionId: started.data.sessionId, skipAll: true });
        expect(done.success).toBe(true);
        expect(done.status).toBe('generating');
        expect(await charged(userId)).toBe(1);

        // A repeated final submit (double tap) neither charges nor restarts.
        const repeat = await processChannelGenerate({ userId, channel: 'web', sessionId: started.data.sessionId, skipAll: true });
        expect(repeat.status).toBe('generating');
        expect(await charged(userId)).toBe(1);
    });

    test('a failed start is refunded and the session is marked failed', async () => {
        const { userId } = await seedUser();
        generateTesting.setEnqueuer(async () => {
            throw new Error('queue down');
        });
        const result = await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD });
        expect(result.success).toBe(false);
        expect(result.code).toBe('enqueue_failed');
        expect(await charged(userId)).toBe(0);
        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: result.sessionId! } });
        expect(session.status).toBe(GenerationStatus.failed);
    });

    test('an empty profile is refused before anything is charged', async () => {
        const { userId } = await seedUser({ resume: false, experience: false });
        const result = await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD });
        expect(result.success).toBe(false);
        expect(result.code).toBe('empty_profile');
        expect(await charged(userId)).toBe(0);
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(0);
    });

    test('regenerating a recent session of the same posting is free, up to the daily cap', async () => {
        const { userId } = await seedUser();
        const first = await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD });
        if (!first.success) throw new Error(first.error);
        expect(await charged(userId)).toBe(1);

        const regen = await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD, regenerateOfSessionId: first.sessionId });
        expect(regen.success).toBe(true);
        expect(await charged(userId)).toBe(1);

        await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD, regenerateOfSessionId: first.sessionId });
        // Three copies of the posting today: the next regeneration is charged.
        await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD, regenerateOfSessionId: first.sessionId });
        expect(await charged(userId)).toBe(2);
    });

    test("someone else's session id does not buy a free regeneration", async () => {
        const { userId } = await seedUser();
        const other = await seedUser();
        const theirs = await processChannelGenerate({ userId: other.userId, channel: 'web', message: COVERED_JD });
        if (!theirs.success) throw new Error(theirs.error);
        await processChannelGenerate({ userId, channel: 'web', message: COVERED_JD, regenerateOfSessionId: theirs.sessionId });
        expect(await charged(userId)).toBe(1);
    });
});

describe('the master resume is never overwritten', () => {
    test('a base with content resolves to a new per-job copy; a copy resolves to itself; an empty base is filled', async () => {
        const { userId, base } = await seedUser();
        const target = await resolveGenerationWriteTarget({ userId, sourceResumeId: base!.id });
        expect(target).toBeDefined();
        expect(target).not.toBe(base!.id);
        const copy = await prisma.resume.findUniqueOrThrow({ where: { id: target! } });
        expect(copy.baseResumeId).toBe(base!.id);

        expect(await resolveGenerationWriteTarget({ userId, sourceResumeId: copy.id })).toBe(copy.id);

        const empty = await prisma.resume.create({ data: { userId, title: 'Blank' } });
        expect(await resolveGenerationWriteTarget({ userId, sourceResumeId: empty.id })).toBe(empty.id);

        expect(await resolveGenerationWriteTarget({ userId, sourceResumeId: null })).toBeUndefined();
    });

    test('with a tracked job, the existing copy for that job is reused', async () => {
        const { userId, base } = await seedUser();
        const { workspace } = await seedScoutJob(userId, COVERED_JD);
        const first = await resolveGenerationWriteTarget({ userId, sourceResumeId: base!.id, workspaceId: workspace.id });
        const second = await resolveGenerationWriteTarget({ userId, sourceResumeId: base!.id, workspaceId: workspace.id });
        expect(second).toBe(first);
    });

    test("another user's resume id is not a write target", async () => {
        const { userId } = await seedUser();
        const other = await seedUser();
        expect(await resolveGenerationWriteTarget({ userId, sourceResumeId: other.base!.id })).toBeUndefined();
    });
});

describe('stripClarificationBlock', () => {
    test('returns the posting without the appended answers', () => {
        const enriched = `${COVERED_JD}${CLARIFICATION_MARKER}\n- Gap: Kubernetes\n  Answer: ran a cluster`;
        expect(stripClarificationBlock(enriched)).toBe(COVERED_JD);
        expect(stripClarificationBlock(COVERED_JD)).toBe(COVERED_JD);
    });
});
