/**
 * Cost controls from the launch audit (2026-10-02), against the local Postgres.
 * Each test reproduces the exploit the audit found and proves it is closed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GenerationStatus } from '@prisma/client';
import { z } from 'zod';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting, generateStructured } from '@/lib/ai/structured';
import { __usageTesting, UsageLimitError } from '@/lib/usageTracker';
import { settleChargeForKind } from '@/lib/scout/metering';

const clerk = installClerkMock();
const { submitClarificationAnswers } = await import('@/actions/clarify');
const { POST: retryPost } = await import('@/app/api/generate/retry/route');

const RUN = `itest-cost-${Date.now()}`;
const SPENDER = `${RUN}-spender`;
const FRESH = `${RUN}-fresh`;
const USER = `${RUN}-user`;

beforeAll(() => {
    aiTesting.setObjectRunner(async () => ({ object: { ok: true }, inputTokens: 1, outputTokens: 1 }));
});

afterAll(async () => {
    aiTesting.reset();
    for (const userId of [SPENDER, FRESH, USER]) {
        await prisma.apiUsageLog.deleteMany({ where: { userId } });
        await prisma.generationSession.deleteMany({ where: { userId } });
        await prisma.agentRun.deleteMany({ where: { userId } });
        await prisma.usageQuota.deleteMany({ where: { userId } });
    }
    clerk.signOut();
});

const call = (userId: string) =>
    generateStructured({ task: 'chatRoute', feature: 'chat', userId, schema: z.object({ ok: z.boolean() }), system: 's', prompt: 'p' });

describe('the monthly cost cap covers generateStructured', () => {
    test('a user over the free budget is refused before the model runs', async () => {
        // $3 of spend, over the $2 free-tier backstop, and logged as FAILED:
        // failed calls bill tokens too, and used to be invisible to the cap.
        await prisma.apiUsageLog.create({
            data: { userId: SPENDER, operation: 'ai.test', provider: 'openai', model: 'm', costUsd: 3, totalTokens: 10, status: 'failed' },
        });
        __usageTesting.clearCache();
        let ran = false;
        aiTesting.setObjectRunner(async () => {
            ran = true;
            return { object: { ok: true }, inputTokens: 1, outputTokens: 1 };
        });
        await expect(call(SPENDER)).rejects.toBeInstanceOf(UsageLimitError);
        expect(ran).toBe(false);
    });

    test('a user under budget is served', async () => {
        __usageTesting.clearCache();
        const result = await call(FRESH);
        expect(result.data).toEqual({ ok: true });
    });
});

describe('clarification answers cannot re-run a finished generation', () => {
    test('submitting answers to a completed session is refused', async () => {
        clerk.signIn(USER);
        const session = await prisma.generationSession.create({
            data: { userId: USER, jobDescription: 'jd', status: GenerationStatus.completed, clarifications: { questions: [], answers: {} } },
        });
        const result = await submitClarificationAnswers({ sessionId: session.id, answers: { q1: 'more text' } });
        expect(result.success).toBe(false);
        expect(result.error).toContain('already used');
        const after = await prisma.generationSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(after.status).toBe(GenerationStatus.completed);
    });
});

describe('retry is for failed generations only', () => {
    const retry = (sessionId: string) =>
        retryPost(new Request('http://localhost/api/generate/retry', { method: 'POST', body: JSON.stringify({ sessionId }) }) as never);

    test('a completed session cannot be retried', async () => {
        clerk.signIn(USER);
        const session = await prisma.generationSession.create({
            data: { userId: USER, jobDescription: 'jd', status: GenerationStatus.completed },
        });
        const res = await retry(session.id);
        expect(res.status).toBe(409);
        const after = await prisma.generationSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(after.status).toBe(GenerationStatus.completed);
    });

    test('another user\'s session is not found', async () => {
        const session = await prisma.generationSession.create({
            data: { userId: SPENDER, jobDescription: 'jd', status: GenerationStatus.failed },
        });
        clerk.signIn(USER);
        expect((await retry(session.id)).status).toBe(404);
    });
});

describe('company research keeps its charge', () => {
    test('a run the user asked to research by name is not refunded as "not a job"', async () => {
        const run = await prisma.agentRun.create({
            data: {
                userId: USER, agent: 'scout', inputKey: `${RUN}-research`, status: 'running', channel: 'web',
                input: { text: 'Research the company: Razorpay', source: 'dashboard', intent: 'company_research', company: 'Razorpay' },
            },
        });
        expect(await settleChargeForKind(run.id, 'company_signal')).toBe(false);
    });
});
