/**
 * Agent run ledger — integration tests against the local Postgres.
 *
 * These prove the four guarantees in `run.ts` as storage facts, not as intent:
 * every step leaves a row; a failing step degrades rather than fails the run;
 * concurrent sections do not overwrite each other's results; and a stored
 * `ok` is not re-run.
 *
 * Isolation: every row is tagged with a unique userId and deleted afterwards.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import {
    appendResult,
    createOrGetRun,
    finishRun,
    invalidateSections,
    loadRun,
    readSections,
    recordAnswer,
    runStep,
    settleStatus,
    type StoredSection,
} from './run';
import { runScoutStages, type StageDriver } from '@/lib/scout/stages';

const RUN = `itest-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let counter = 0;

async function newRun(agent = 'itest') {
    counter += 1;
    const { run } = await createOrGetRun({
        userId: RUN,
        agent,
        inputKey: `k${counter}`,
        input: { url: 'https://example.com' },
    });
    return run;
}

afterAll(async () => {
    await prisma.agentRun.deleteMany({ where: { userId: RUN } });
});

describe('createOrGetRun', () => {
    test('the same input key returns the same run', async () => {
        const first = await createOrGetRun({ userId: RUN, agent: 'itest', inputKey: 'dup', input: {} });
        const second = await createOrGetRun({ userId: RUN, agent: 'itest', inputKey: 'dup', input: {} });
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.run.id).toBe(first.run.id);
    });

    test('concurrent creates for one key produce one row', async () => {
        const results = await Promise.all(
            Array.from({ length: 5 }, () => createOrGetRun({ userId: RUN, agent: 'itest', inputKey: 'race', input: {} })),
        );
        expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
        expect(results.filter((result) => result.created)).toHaveLength(1);
    });
});

describe('runStep', () => {
    test('records a succeeded step with its sources and merges the result', async () => {
        const run = await newRun();
        const section = await runStep(run.id, 'alpha', async (ctx) => {
            ctx.sources.add({ url: 'https://example.com/a?utm_source=x', title: 'A', text: 'hello' });
            ctx.addCost(0.002);
            return { status: 'ok', data: { value: 1 } };
        }, { feature: 'scout' });

        expect(section.status).toBe('ok');
        const steps = await prisma.agentStep.findMany({ where: { runId: run.id } });
        expect(steps).toHaveLength(1);
        expect(steps[0].status).toBe('succeeded');
        expect(steps[0].costUsd).toBeCloseTo(0.002);
        expect((steps[0].sources as { url: string }[])[0].url).toContain('example.com/a');

        const fresh = await loadRun(run.id);
        expect(readSections(fresh!).alpha.status).toBe('ok');
        expect(fresh!.costUsd).toBeCloseTo(0.002);
        expect(fresh!.stepCount).toBe(1);
    });

    test('a throwing step is retried, recorded per attempt, and degrades to failed', async () => {
        const run = await newRun();
        let calls = 0;
        const section = await runStep(run.id, 'flaky', async () => {
            calls += 1;
            throw new Error('vendor 503');
        }, { feature: 'scout', maxAttempts: 2 });

        expect(calls).toBe(2);
        expect(section.status).toBe('failed');
        const steps = await prisma.agentStep.findMany({ where: { runId: run.id }, orderBy: { attempt: 'asc' } });
        expect(steps.map((step) => [step.attempt, step.status])).toEqual([[1, 'failed'], [2, 'failed']]);
        expect(steps[0].error).toContain('vendor 503');
    });

    test('a hung step times out rather than stalling the run', async () => {
        const run = await newRun();
        const started = Date.now();
        const section = await runStep(run.id, 'hung', () => new Promise(() => undefined), {
            feature: 'scout',
            timeoutMs: 150,
            maxAttempts: 1,
        });
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(section.status).toBe('failed');
        if (section.status === 'failed') expect(section.reason).toContain('timed out');
    });

    test('a stored ok result is not re-run', async () => {
        const run = await newRun();
        let calls = 0;
        const fn = async () => {
            calls += 1;
            return { status: 'ok' as const, data: calls };
        };
        await runStep(run.id, 'once', fn, { feature: 'scout' });
        await runStep(run.id, 'once', fn, { feature: 'scout' });
        expect(calls).toBe(1);

        await invalidateSections(run.id, ['once']);
        await runStep(run.id, 'once', fn, { feature: 'scout' });
        expect(calls).toBe(2);
    });

    test('concurrent sections do not overwrite each other', async () => {
        const run = await newRun();
        const names = ['s1', 's2', 's3', 's4', 's5', 's6'];
        await Promise.all(names.map((name) => runStep(run.id, name, async () => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
            return { status: 'ok', data: name };
        }, { feature: 'scout' })));

        const fresh = await loadRun(run.id);
        expect(Object.keys(readSections(fresh!)).sort()).toEqual([...names].sort());
        expect(fresh!.stepCount).toBe(names.length);
    });

    test('the budget stops further steps with a stated reason', async () => {
        const run = await newRun('itestbudget');
        process.env.AGENT_ITESTBUDGET_MAX_COST_USD = '0.001';
        try {
            await runStep(run.id, 'spend', async (ctx) => {
                ctx.addCost(0.005);
                return { status: 'ok', data: 1 };
            }, { feature: 'scout' });
            let ran = false;
            const section = await runStep(run.id, 'next', async () => {
                ran = true;
                return { status: 'ok', data: 2 };
            }, { feature: 'scout' });
            expect(ran).toBe(false);
            expect(section.status).toBe('skipped');
        } finally {
            delete process.env.AGENT_ITESTBUDGET_MAX_COST_USD;
        }
    });
});

describe('answers and appends', () => {
    test('recordAnswer stores the answer and clears the question', async () => {
        const run = await newRun();
        await prisma.agentRun.update({
            where: { id: run.id },
            data: { status: 'awaiting_input', pendingQuestion: { id: 'q1', step: 'fit', prompt: '?' } },
        });
        await recordAnswer(run.id, 'q1', 'Bengaluru');
        const fresh = await loadRun(run.id);
        expect(fresh!.answers).toEqual({ q1: 'Bengaluru' });
        expect(fresh!.pendingQuestion).toBeNull();
    });

    test('appendResult appends under concurrency', async () => {
        const run = await newRun();
        await Promise.all([1, 2, 3, 4].map((n) => appendResult(run.id, 'drafts', { n })));
        const fresh = await loadRun(run.id);
        const drafts = (fresh!.result as { drafts: { n: number }[] }).drafts;
        expect(drafts.map((draft) => draft.n).sort()).toEqual([1, 2, 3, 4]);
    });
});

describe('settleStatus', () => {
    const at = new Date().toISOString();
    const ok: StoredSection = { status: 'ok', data: 1, sources: [], finishedAt: at };
    const failed: StoredSection = { status: 'failed', reason: 'x', finishedAt: at };
    const unavailable: StoredSection = { status: 'unavailable', reason: 'no key', sources: [], finishedAt: at };

    test('all ok → succeeded; ok plus degraded → partial; nothing ok → failed', () => {
        expect(settleStatus({ a: ok, b: ok })).toBe('succeeded');
        expect(settleStatus({ a: ok, b: unavailable })).toBe('partial');
        expect(settleStatus({ a: failed, b: unavailable })).toBe('failed');
    });

    test('an explicit error always fails the run', () => {
        expect(settleStatus({ a: ok }, 'ingest failed')).toBe('failed');
    });

    test('a pending question wins over everything else', () => {
        expect(settleStatus({
            a: ok,
            b: { status: 'needs_input', question: { id: 'q', step: 'b', prompt: '?' }, finishedAt: at },
        })).toBe('awaiting_input');
    });
});

describe('runScoutStages against the real ledger', () => {
    function driver(impl: Record<string, () => Promise<{ status: 'ok'; data: unknown } | { status: 'unavailable'; reason: string }>>): StageDriver & { order: string[] } {
        const order: string[] = [];
        return {
            order,
            begin: async () => undefined,
            runSection: async (runId, name) => {
                order.push(name);
                const fn = impl[name] ?? (async () => ({ status: 'ok' as const, data: {} }));
                return runStep(runId, name, fn as never, { feature: 'scout', maxAttempts: 1 });
            },
            setKind: async (runId, kind) => {
                await prisma.agentRun.update({ where: { id: runId }, data: { kind } });
            },
            progress: async () => undefined,
            finish: async (runId, error) => {
                await finishRun(runId, error);
            },
        };
    }

    test('a job runs the full plan, and one unavailable section makes it partial', async () => {
        const run = await newRun();
        const d = driver({
            classify: async () => ({ status: 'ok', data: { kind: 'job_posting', confidence: 0.9, companies: [], roleTitle: null, reason: '' } }),
            comp: async () => ({ status: 'unavailable', reason: 'No search provider configured' }),
        });
        await runScoutStages(run.id, d);

        expect(d.order.slice(0, 3)).toEqual(['ingest', 'classify', 'jd']);
        expect(new Set(d.order.slice(3, 9))).toEqual(new Set(['fit', 'company', 'comp', 'interviews', 'network', 'talent']));
        // The tracker row copies the verdict, so track runs strictly after fit.
        expect(d.order[9]).toBe('track');
        const fresh = await loadRun(run.id);
        expect(fresh!.kind).toBe('job_posting');
        expect(fresh!.status).toBe('partial');
    });

    test('a failed preamble stops the run with its reason', async () => {
        const run = await newRun();
        const d = driver({
            ingest: async () => ({ status: 'unavailable', reason: 'LinkedIn would not show this post without a login' }),
        });
        await runScoutStages(run.id, d);
        expect(d.order).toEqual(['ingest']);
        const fresh = await loadRun(run.id);
        expect(fresh!.status).toBe('failed');
        expect(fresh!.error).toContain('without a login');
    });

    test('knowledge posts run only the digest', async () => {
        const run = await newRun();
        const d = driver({
            classify: async () => ({ status: 'ok', data: { kind: 'knowledge', confidence: 0.8, companies: [], roleTitle: null, reason: '' } }),
        });
        await runScoutStages(run.id, d);
        expect(d.order).toEqual(['ingest', 'classify', 'digest']);
        expect((await loadRun(run.id))!.status).toBe('succeeded');
    });
});
