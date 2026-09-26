/**
 * The first production Scout run failed at `start()` — the durable workflow
 * never began — and the reason was swallowed. Enqueue now logs the error and
 * runs the same stages inside the request. This proves the fallback runs,
 * records itself, and that a failure is loud, against the local Postgres.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { createOrGetRun } from '@/lib/agent/run';
import { __testing, enqueueScoutRun } from '@/services/scout';

// Seams, not mock.module: a module mock leaks into every test file in the run.
const stagesCalls: string[] = [];
__testing.setStarter(async () => {
    throw new Error('WorkflowAPIError: no runner');
});
__testing.setStagesRunner(async (runId) => {
    stagesCalls.push(runId);
});

const USER = `itest-enqueue-${Date.now()}`;
const env = process.env as Record<string, string | undefined>;
const originalEnv = env.NODE_ENV;

afterEach(() => {
    env.NODE_ENV = originalEnv;
});
afterAll(async () => {
    __testing.setStarter(null);
    __testing.setStagesRunner(null);
    await prisma.agentRun.deleteMany({ where: { userId: USER } });
});

describe('enqueueScoutRun in production', () => {
    test('a failed workflow start falls back to an in-request run, logged', async () => {
        const { run } = await createOrGetRun({ userId: USER, agent: 'scout', inputKey: 'k1', input: { url: 'https://example.com', source: 'telegram' } });
        const errors: unknown[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { errors.push(args); };
        env.NODE_ENV = 'production';
        try {
            await enqueueScoutRun(run.id);
        } finally {
            console.error = originalError;
        }
        // after() throws outside a request scope, so the run proceeds detached.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stagesCalls).toContain(run.id);
        const fresh = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
        expect(fresh.workflowRunId?.startsWith('inline:fallback:')).toBe(true);
        expect(fresh.status).not.toBe('failed');
        expect(JSON.stringify(errors)).toContain('no runner');
    });
});
