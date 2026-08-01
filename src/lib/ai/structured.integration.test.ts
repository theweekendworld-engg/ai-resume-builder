/**
 * generateStructured — ApiUsageLog persistence, against a live Postgres.
 *
 * This is the substrate for the per-feature cost tripwires (PRD 08 §4.3). If
 * the feature tag is missing or the cost is floored to zero, cost monitoring
 * reads healthy while blind — the exact failure mode that made `toMicroDollars`
 * necessary. These tests pin both.
 *
 * The model is mocked via the __testing seam; only the log write is real.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { __testing, generateStructured } from './structured';

const RUN = `itest-ai-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function newUser(name: string): string {
    const id = `${RUN}:${name}`;
    users.push(id);
    return id;
}

const Schema = z.object({ summary: z.string() });

/** Mock model returning a fixed object plus plausible token counts. */
function mockRunner(text: string, tokens = { input: 1500, output: 350 }) {
    return async () => ({
        object: { summary: text },
        inputTokens: tokens.input,
        outputTokens: tokens.output,
    });
}

afterEach(() => {
    __testing.reset();
});

afterAll(async () => {
    if (users.length > 0) {
        await prisma.apiUsageLog.deleteMany({ where: { userId: { in: users } } });
    }
});

describe('ApiUsageLog persistence', () => {
    test('writes one row carrying the feature and task tags', async () => {
        const userId = newUser('tagged');
        __testing.setObjectRunner(mockRunner('ok') as never);

        await generateStructured({
            task: 'winStructure',
            feature: 'work_log',
            userId,
            schema: Schema,
            system: 'test',
            prompt: 'test',
        });

        const rows = await prisma.apiUsageLog.findMany({ where: { userId } });
        expect(rows).toHaveLength(1);

        const meta = rows[0].metadata as Record<string, unknown> | null;
        // The group-by keys for v_feature_cost_daily. Without these the
        // tripwire query has nothing to aggregate on.
        expect(meta?.feature).toBe('work_log');
        expect(meta?.task).toBe('winStructure');
        expect(rows[0].status).toBe('success');
        expect(rows[0].inputTokens).toBe(1500);
        expect(rows[0].outputTokens).toBe(350);
        expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    test('a sub-cent call records a non-zero cost', async () => {
        // Regression guard. Per-call cost was rounded to 2dp, so every cheap
        // call logged as $0.00 — and under this product most calls are cheap.
        // The tripwires would have read zero for the highest-volume operations.
        const userId = newUser('subcent');
        __testing.setObjectRunner(mockRunner('ok') as never);

        await generateStructured({
            task: 'winStructure',
            feature: 'work_log',
            userId,
            schema: Schema,
            system: 'test',
            prompt: 'test',
        });

        const row = await prisma.apiUsageLog.findFirstOrThrow({ where: { userId } });
        expect(row.costUsd).toBeGreaterThan(0);
        expect(row.costUsd).toBeLessThan(0.01);
    });

    test('a provider failure is logged as failed rather than swallowed', async () => {
        const userId = newUser('failed');
        __testing.setObjectRunner((async () => {
            throw new Error('provider exploded');
        }) as never);

        await expect(
            generateStructured({
                task: 'winStructure',
                feature: 'work_log',
                userId,
                schema: Schema,
                system: 'test',
                prompt: 'test',
                maxRetries: 0,
            }),
        ).rejects.toThrow();

        const rows = await prisma.apiUsageLog.findMany({ where: { userId } });
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.some((r) => r.status === 'failed')).toBe(true);
    });

    test('retries accumulate onto the same logical operation', async () => {
        const userId = newUser('retry');
        let call = 0;
        __testing.setObjectRunner((async () => {
            call += 1;
            // First response violates the schema, forcing one retry.
            return call === 1
                ? { object: { wrong: true }, inputTokens: 100, outputTokens: 20 }
                : { object: { summary: 'ok' }, inputTokens: 120, outputTokens: 30 };
        }) as never);

        const result = await generateStructured({
            task: 'winStructure',
            feature: 'work_log',
            userId,
            schema: Schema,
            system: 'test',
            prompt: 'test',
            maxRetries: 1,
        });

        expect(result.data.summary).toBe('ok');

        const rows = await prisma.apiUsageLog.findMany({ where: { userId } });
        const totalTokens = rows.reduce((n, r) => n + r.totalTokens, 0);
        // Both attempts must be paid for in the cost record, however they are
        // grouped — a retry that bills as one attempt understates real spend.
        expect(totalTokens).toBeGreaterThanOrEqual(100 + 20 + 120 + 30);
    });
});
