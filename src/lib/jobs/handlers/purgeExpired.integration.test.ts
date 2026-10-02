import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { purgeExpiredHandler } from './purgeExpired';
import type { JobContext } from '../types';

const USER = `itest-purge-${Date.now()}`;
const ctx = { jobId: 'j', attempt: 1, deadline: new Date(Date.now() + 60_000), enqueue: async () => ({ jobId: 'x', deduped: false }), log: () => {} } as unknown as JobContext;

afterAll(async () => {
    await prisma.agentRun.deleteMany({ where: { userId: USER } });
    await prisma.generationSession.deleteMany({ where: { userId: USER } });
});

/** `updatedAt` is maintained by Prisma, so age a row with raw SQL. */
async function age(table: 'AgentRun' | 'GenerationSession', id: string, minutes: number) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = NOW() - INTERVAL '${minutes} minutes' WHERE id = $1`, id);
}

describe('purge_expired recovers work a killed function left behind', () => {
    test('a Scout run idle 20 minutes is failed; one working now is left alone', async () => {
        const stale = await prisma.agentRun.create({ data: { userId: USER, agent: 'scout', inputKey: `${USER}-a`, status: 'running', channel: 'web', input: {} } });
        const live = await prisma.agentRun.create({ data: { userId: USER, agent: 'scout', inputKey: `${USER}-b`, status: 'running', channel: 'web', input: {} } });
        await age('AgentRun', stale.id, 20);
        await purgeExpiredHandler({}, ctx);
        expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('failed');
        expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('running');
    });

    test('a generation stuck 45 minutes becomes failed, so it can be retried', async () => {
        const stuck = await prisma.generationSession.create({ data: { userId: USER, jobDescription: 'jd', status: 'generating' } });
        await age('GenerationSession', stuck.id, 45);
        await purgeExpiredHandler({}, ctx);
        const after = await prisma.generationSession.findUniqueOrThrow({ where: { id: stuck.id } });
        expect(after.status).toBe('failed');
        expect(after.errorMessage).toContain('Retry');
    });
});
