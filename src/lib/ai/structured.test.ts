import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { z } from 'zod';
import { config } from '@/lib/config';
import { calculateOpenAiCostUsd } from '@/lib/usageTracker';
import { generateStructured, __testing, type ObjectRunner } from './structured';

/**
 * `generateStructured` unit tests.
 *
 * No model is called and no database is touched: the AI SDK call and the
 * ApiUsageLog write are both injected seams. The behaviour under test is the
 * orchestration — model resolution, validation retry, guard retry, degradation,
 * and what lands in the usage log.
 */

const Schema = z.object({
    summary: z.string(),
    bullets: z.array(z.string()),
});

type LoggedCall = {
    operation: string;
    model: string;
    costUsd?: number;
    latencyMs?: number;
    status?: string;
    metadata?: Record<string, unknown>;
};

let logged: LoggedCall[] = [];
let prompts: string[] = [];
let models: string[] = [];

function useRunner(responses: Array<unknown | (() => never)>) {
    let index = 0;
    const runner: ObjectRunner = async ({ model, prompt }) => {
        models.push(model);
        prompts.push(prompt);
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (typeof response === 'function') (response as () => never)();
        return { object: response, inputTokens: 100_000, outputTokens: 50_000 };
    };
    __testing.setObjectRunner(runner);
}

beforeEach(() => {
    logged = [];
    prompts = [];
    models = [];
    __testing.setUsageLogger(async (input) => {
        logged.push(input as LoggedCall);
    });
});

afterAll(() => {
    __testing.reset();
});

const base = {
    feature: 'work_log' as const,
    userId: 'user_123',
    schema: Schema,
    system: 'You are a careful editor.',
    prompt: 'Summarise the log.',
};

describe('generateStructured — model resolution', () => {
    test('resolves the model from the task map, not from the call site', async () => {
        useRunner([{ summary: 'ok', bullets: [] }]);
        await generateStructured({ ...base, task: 'winDraft' });
        expect(models).toEqual([config.openai.models.winDraft]);
    });

    test('a different task resolves a different configured model', async () => {
        useRunner([{ summary: 'ok', bullets: [] }]);
        await generateStructured({ ...base, task: 'digestCompose' });
        expect(models).toEqual([config.openai.models.digestCompose]);
    });
});

describe('generateStructured — validation and retry', () => {
    test('returns parsed data on a valid first response', async () => {
        useRunner([{ summary: 'clean', bullets: ['a'] }]);
        const result = await generateStructured({ ...base, task: 'winStructure' });
        expect(result.data).toEqual({ summary: 'clean', bullets: ['a'] });
        expect(result.degraded).toBe(false);
        expect(result.usage.calls).toBe(1);
    });

    test('retries once with the validation error appended, then succeeds', async () => {
        useRunner([{ summary: 42 }, { summary: 'fixed', bullets: [] }]);
        const result = await generateStructured({ ...base, task: 'winStructure' });

        expect(result.data.summary).toBe('fixed');
        expect(result.usage.calls).toBe(2);
        expect(prompts[0]).toBe('Summarise the log.');
        expect(prompts[1]).toContain('did not satisfy the required schema');
        expect(prompts[1]).toContain('summary');
    });

    test('throws after the retry budget is exhausted, and logs the failure', async () => {
        useRunner([{ nope: true }]);
        await expect(generateStructured({ ...base, task: 'winStructure' })).rejects.toThrow(
            /schema validation failed after 2 attempt/,
        );
        expect(logged.at(-1)?.status).toBe('failed');
        expect(logged.at(-1)?.metadata?.stage).toBe('validate');
    });

    test('maxRetries: 0 means exactly one attempt', async () => {
        useRunner([{ nope: true }]);
        await expect(
            generateStructured({ ...base, task: 'winStructure', maxRetries: 0 }),
        ).rejects.toThrow(/after 1 attempt/);
    });

    test('a provider error propagates and is logged as failed', async () => {
        useRunner([
            () => {
                throw new Error('provider 503');
            },
        ]);
        await expect(generateStructured({ ...base, task: 'winStructure' })).rejects.toThrow('provider 503');
        expect(logged.at(-1)?.status).toBe('failed');
        expect(logged.at(-1)?.metadata?.stage).toBe('generate');
    });
});

describe('generateStructured — the numeric guard', () => {
    const guard = { sourceText: 'Cut p95 latency 77% on checkout.', fields: ['bullets'] };

    test('a clean output passes the guard with no extra call', async () => {
        useRunner([{ summary: 's', bullets: ['Cut p95 latency 77%.'] }]);
        const result = await generateStructured({ ...base, task: 'packetCompose', guard });
        expect(result.degraded).toBe(false);
        expect(result.usage.calls).toBe(1);
        expect(result.guardViolations).toEqual([]);
    });

    test('a fabricated number triggers exactly one corrective retry, and the fix is kept', async () => {
        useRunner([
            { summary: 's', bullets: ['Cut p95 latency 91%.'] },
            { summary: 's', bullets: ['Cut p95 latency 77%.'] },
        ]);
        const result = await generateStructured({ ...base, task: 'packetCompose', guard });

        expect(result.usage.calls).toBe(2);
        expect(result.degraded).toBe(false);
        expect(result.data.bullets).toEqual(['Cut p95 latency 77%.']);
        expect(prompts[1]).toContain('do not appear in the source material');
        expect(prompts[1]).toContain('91%');
    });

    test('a second fabrication strips the field and degrades', async () => {
        useRunner([{ summary: 's', bullets: ['Cut p95 latency 91%.', 'Kept the runbook current.'] }]);
        const result = await generateStructured({ ...base, task: 'packetCompose', guard });

        expect(result.usage.calls).toBe(2);
        expect(result.degraded).toBe(true);
        expect(result.data.bullets).toEqual(['Kept the runbook current.']);
        expect(result.guardViolations.map((violation) => violation.quantity.raw)).toEqual(['91%']);
    });

    test('a failed corrective call degrades instead of throwing', async () => {
        let call = 0;
        __testing.setObjectRunner(async () => {
            call += 1;
            if (call === 1) {
                return { object: { summary: 's', bullets: ['Cut latency 91%.'] }, inputTokens: 10, outputTokens: 5 };
            }
            throw new Error('provider 503');
        });

        const result = await generateStructured({ ...base, task: 'packetCompose', guard });
        expect(result.degraded).toBe(true);
        expect(result.data.bullets).toEqual([]);
    });

    test('a partially-improved retry is kept and the remainder stripped', async () => {
        useRunner([
            { summary: 's', bullets: ['Cut latency 91%.', 'Saved $4m.'] },
            { summary: 's', bullets: ['Cut latency 77%.', 'Saved $4m.'] },
        ]);
        const result = await generateStructured({ ...base, task: 'packetCompose', guard });
        expect(result.degraded).toBe(true);
        expect(result.data.bullets).toEqual(['Cut latency 77%.']);
    });

    test('the guard only inspects declared fields', async () => {
        useRunner([{ summary: 'Grew revenue 999%.', bullets: ['Cut p95 latency 77%.'] }]);
        const result = await generateStructured({ ...base, task: 'packetCompose', guard });
        expect(result.degraded).toBe(false);
        expect(result.data.summary).toBe('Grew revenue 999%.');
    });

    test('no guard means no guard call and no degradation', async () => {
        useRunner([{ summary: 'Grew revenue 999%.', bullets: ['Saved $9m.'] }]);
        const result = await generateStructured({ ...base, task: 'packetCompose' });
        expect(result.usage.calls).toBe(1);
        expect(result.degraded).toBe(false);
    });
});

describe('generateStructured — usage accounting', () => {
    test('logs one success line tagged with feature and task', async () => {
        useRunner([{ summary: 'ok', bullets: [] }]);
        await generateStructured({ ...base, task: 'radarReason', feature: 'radar' });

        expect(logged.length).toBe(1);
        expect(logged[0].operation).toBe('ai.radarReason');
        expect(logged[0].model).toBe(config.openai.models.radarReason);
        expect(logged[0].metadata?.feature).toBe('radar');
        expect(logged[0].metadata?.task).toBe('radarReason');
        expect(logged[0].metadata?.degraded).toBe(false);
        expect(logged[0].status).toBe('success');
        expect(typeof logged[0].latencyMs).toBe('number');
    });

    test('token usage and cost accumulate across retries', async () => {
        useRunner([{ bad: true }, { summary: 'ok', bullets: [] }]);
        const result = await generateStructured({ ...base, task: 'winDraft' });

        expect(result.usage.inputTokens).toBe(200_000);
        expect(result.usage.outputTokens).toBe(100_000);
        expect(result.usage.totalTokens).toBe(300_000);
        // cost comes from the shared pricing table in usageTracker, never a local copy
        expect(result.usage.costUsd).toBe(
            calculateOpenAiCostUsd({
                model: config.openai.models.winDraft,
                inputTokens: 200_000,
                outputTokens: 100_000,
            }),
        );
        expect(logged[0].costUsd).toBe(result.usage.costUsd);
    });

    test('a usage-log write failure never fails the generation', async () => {
        useRunner([{ summary: 'ok', bullets: [] }]);
        __testing.setUsageLogger(async () => {
            throw new Error('P1001: cannot reach database server');
        });
        const result = await generateStructured({ ...base, task: 'winDraft' });
        expect(result.data.summary).toBe('ok');
    });
});

// Requires a live Postgres. Unreachable in this environment (Prisma P1001).
describe.skip('generateStructured — ApiUsageLog persistence', () => {
    // TODO(db): assert one ApiUsageLog row per call with metadata.feature / metadata.task
    // populated, so the v_feature_cost_daily tripwire view (PRD 08 §4.3) has data.
    test('writes an ApiUsageLog row with the feature tag', () => {});
    // TODO(db): assert a guard-degraded call records degraded:true in metadata for the
    // ai_guard_violation funnel.
    test('records guard violations on the log row', () => {});
});
