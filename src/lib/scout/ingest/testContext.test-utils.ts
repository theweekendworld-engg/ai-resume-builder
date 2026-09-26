/**
 * A fake `SectionContext` for section unit tests: real `SourceSet`, a
 * scripted `ai`, no database, no harness. Records every model call so tests
 * can assert "no model was called" as well as what was asked.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceSet } from '@/lib/agent/sources';
import type { StepContext } from '@/lib/agent/run';
import type { SectionContext } from '@/lib/scout/section';
import type { ScoutInput, ScoutSections } from '@/lib/scout/types';

export type AiCall = { task: string; system: string; prompt: string; guard?: unknown };

export function fixture(name: string): string {
    return readFileSync(join(import.meta.dir, '__fixtures__', name), 'utf8');
}

export function fakeContext(params: {
    input?: Partial<ScoutInput>;
    sections?: ScoutSections;
    answers?: Record<string, string>;
    /** Returned as `data` for each `ai` call, in order. */
    aiResponses?: unknown[];
    userId?: string;
    runId?: string;
}): { ctx: SectionContext; aiCalls: AiCall[]; sources: SourceSet } {
    const sources = new SourceSet();
    const aiCalls: AiCall[] = [];
    const responses = [...(params.aiResponses ?? [])];
    const step: StepContext = {
        runId: params.runId ?? 'run_test',
        userId: params.userId ?? 'user_test',
        stepName: 'test',
        sources,
        signal: new AbortController().signal,
        ai: (async (opts: { task: string; system: string; prompt: string; guard?: unknown; schema: { parse: (v: unknown) => unknown } }) => {
            aiCalls.push({ task: opts.task, system: opts.system, prompt: opts.prompt, guard: opts.guard });
            if (responses.length === 0) throw new Error('unexpected model call');
            const data = opts.schema.parse(responses.shift());
            return {
                data,
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 1, latencyMs: 0 },
                degraded: false,
                guardViolations: [],
            };
        }) as unknown as StepContext['ai'],
        addCost: () => undefined,
        log: () => undefined,
    };
    const ctx: SectionContext = {
        runId: step.runId,
        userId: step.userId,
        input: { url: null, text: null, source: 'dashboard', ...params.input },
        answers: params.answers ?? {},
        sections: params.sections ?? {},
        step,
    };
    return { ctx, aiCalls, sources };
}

/** A fetch that serves canned responses by URL substring, and records calls. */
export function fakeFetch(routes: Record<string, { status?: number; body: string; headers?: Record<string, string> }>) {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        calls.push(url);
        const key = Object.keys(routes).find((pattern) => url.includes(pattern));
        if (key === undefined) return new Response('not found', { status: 404 });
        const route = routes[key];
        return new Response(route.body, { status: route.status ?? 200, headers: { 'content-type': 'text/html', ...route.headers } });
    }) as typeof fetch;
    return { impl, calls };
}

/** Every host resolves to a public address. */
export const publicResolver = async () => ['93.184.216.34'];
