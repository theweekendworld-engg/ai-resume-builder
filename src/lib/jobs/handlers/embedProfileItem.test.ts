/**
 * The cutover, end to end: a profile row whose vector is gone is found by the
 * sweep, re-embedded into the real store (local Postgres / pgvector), and the
 * next sweep finds nothing to do.
 *
 * Only the embedding model is mocked. The store is the one production runs.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { installMocks, uninstallMocks } from '@/__mocks__';
import { qdrantPointsForUser } from '@/services/winFixtures.test-utils';
import { deleteFromQdrant } from '@/lib/embeddings';
import { reconcileGraphHandler, type ReconcileReport } from './reconcileGraph';
import { embedProfileItemHandler } from './embedProfileItem';
import type { JobContext } from '../types';

const USER = `itest-profile-embed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ctx = {
    jobId: `${USER}:job`,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    enqueue: async () => ({ jobId: `${USER}:child`, deduped: false }),
    log: () => {},
} as unknown as JobContext;

const sweep = async () => (await reconcileGraphHandler({ userId: USER }, ctx)) as ReconcileReport;

let projectId = '';
let experienceId = '';

beforeAll(async () => {
    installMocks({ only: ['openai'] });
    // Exactly what production held after Qdrant Cloud was lost: rows that
    // believe they are embedded, pointing at vectors that no longer exist.
    const project = await prisma.userProject.create({
        data: {
            userId: USER, name: 'Ledger service', description: 'Double-entry ledger in Go.',
            technologies: ['go', 'postgres'], embedded: true, qdrantPointId: crypto.randomUUID(),
        },
    });
    const experience = await prisma.userExperience.create({
        data: {
            userId: USER, role: 'Backend Engineer', company: 'Northwind', description: 'Owned billing.',
            highlights: ['Moved billing onto Kubernetes.'], startDate: '2022-01',
            embedded: true, qdrantPointId: crypto.randomUUID(),
        },
    });
    projectId = project.id;
    experienceId = experience.id;
});

afterAll(async () => {
    for (const point of await qdrantPointsForUser(USER)) await deleteFromQdrant(point.id);
    await prisma.job.deleteMany({ where: { OR: [{ dedupeKey: { contains: projectId } }, { dedupeKey: { contains: experienceId } }] } });
    await prisma.userProject.deleteMany({ where: { userId: USER } });
    await prisma.userExperience.deleteMany({ where: { userId: USER } });
    uninstallMocks();
});

describe('profile rows with no live vector', () => {
    test('the sweep finds them and enqueues one embed job each', async () => {
        const report = await sweep();
        expect(report.profileMissing).toBe(2);
        const jobs = await prisma.job.findMany({ where: { kind: 'embed_profile_item' } });
        const mine = jobs.filter((j) => [projectId, experienceId].includes((j.payload as { id?: string }).id ?? ''));
        expect(mine.map((j) => (j.payload as { kind: string }).kind).sort()).toEqual(['experience', 'project']);
    });

    test('a second sweep the same day does not enqueue twice', async () => {
        await sweep();
        const jobs = await prisma.job.findMany({ where: { kind: 'embed_profile_item' } });
        const mine = jobs.filter((j) => [projectId, experienceId].includes((j.payload as { id?: string }).id ?? ''));
        expect(mine).toHaveLength(2);
    });

    test('the handler writes a real vector and updates the row', async () => {
        await embedProfileItemHandler({ kind: 'project', id: projectId }, ctx);
        await embedProfileItemHandler({ kind: 'experience', id: experienceId }, ctx);

        const points = await qdrantPointsForUser(USER);
        expect(points.map((p) => p.payload.sourceId).sort()).toEqual([experienceId, projectId].sort());

        const project = await prisma.userProject.findUniqueOrThrow({ where: { id: projectId } });
        expect(points.map((p) => p.id)).toContain(project.qdrantPointId!);
        expect(project.embedded).toBe(true);
    });

    test('then the sweep has nothing left to repair', async () => {
        const report = await sweep();
        expect(report.profileMissing).toBe(0);
    });

    test('a bad payload is refused without a retry', async () => {
        const result = await embedProfileItemHandler({ kind: 'nope', id: '' }, ctx);
        expect(result).toEqual({ embedded: false, reason: 'bad_payload' });
    });
});
