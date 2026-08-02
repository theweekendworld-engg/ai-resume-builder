import { describe, test, expect } from 'bun:test';
import { registerAllHandlers } from './registry';
import { getHandler } from './runner';
import { noopHandler, parseNoopPayload, NOOP_MAX_FAN_OUT } from './handlers/noop';
import type { EnqueueFn, EnqueueOptions, JobContext, JobKind, JobResultObject } from './types';

describe('registry', () => {
    test('the noop handler is wired up on import', () => {
        expect(getHandler('noop')).toBe(noopHandler);
    });

    test('registerAllHandlers is idempotent', () => {
        const first = registerAllHandlers();
        const second = registerAllHandlers();
        expect(second).toEqual(first);
        expect(getHandler('noop')).toBe(noopHandler);
    });

    test('every kind the cron can enqueue has a handler', () => {
        // A registered JobKind with no handler dies on UnknownJobKindError at
        // run time, not at build time — so this assertion is the only thing
        // standing between "we shipped a new job" and "it silently goes dead".
        const wired: JobKind[] = [
            'noop',
            'embed_win',
            'capture_sync',
            'draft_wins',
            'proactive_downgrade',
            'month_in_review',
            'weekly_digest',
        ];
        for (const kind of wired) {
            expect(getHandler(kind)).toBeDefined();
        }
    });

    test('kinds whose phase has not landed are still unregistered', () => {
        expect(getHandler('email_send')).toBeUndefined();
    });
});

type EnqueueCall = { kind: JobKind; payload: object; opts?: EnqueueOptions };

function makeContext(overrides: Partial<JobContext> = {}): {
    ctx: JobContext;
    calls: EnqueueCall[];
    logs: string[];
} {
    const calls: EnqueueCall[] = [];
    const logs: string[] = [];
    const enqueue: EnqueueFn = async (kind, payload, opts) => {
        calls.push({ kind, payload, opts });
        return { jobId: `job_${calls.length}`, deduped: false };
    };
    const ctx: JobContext = {
        jobId: 'job_parent',
        attempt: 1,
        deadline: new Date(Date.now() + 30_000),
        enqueue,
        log: (message) => logs.push(message),
        ...overrides,
    };
    return { ctx, calls, logs };
}

describe('parseNoopPayload', () => {
    test('accepts an empty payload', () => {
        expect(parseNoopPayload({})).toEqual({});
        expect(parseNoopPayload(null)).toEqual({});
        expect(parseNoopPayload(undefined)).toEqual({});
    });

    test('keeps known fields', () => {
        expect(parseNoopPayload({ echo: 'hi', fanOut: 2 })).toEqual({ echo: 'hi', fanOut: 2 });
    });

    test('never throws on garbage — a bad payload must not become a poison pill', () => {
        expect(parseNoopPayload('not-an-object')).toEqual({});
        expect(parseNoopPayload({ fanOut: 'many' })).toEqual({});
        expect(parseNoopPayload({ fanOut: NOOP_MAX_FAN_OUT + 1 })).toEqual({});
        expect(parseNoopPayload(42)).toEqual({});
    });
});

describe('noopHandler', () => {
    test('succeeds and echoes the payload back into the result', async () => {
        const { ctx, logs } = makeContext();
        const result = (await noopHandler({ echo: 'smoke' }, ctx)) as JobResultObject;
        expect(result.echo).toBe('smoke');
        expect(result.attempt).toBe(1);
        expect(result.fannedOut).toBe(0);
        expect(typeof result.ranAt).toBe('string');
        expect(logs.length).toBeGreaterThan(0);
    });

    test('throws on demand so the retry path can be smoke-tested in production', async () => {
        const { ctx } = makeContext();
        await expect(noopHandler({ failWith: 'on purpose' }, ctx)).rejects.toThrow('on purpose');
    });

    test('fans out to child jobs instead of looping inline (§P-2)', async () => {
        const { ctx, calls } = makeContext();
        const result = (await noopHandler({ fanOut: 3, echo: 'x' }, ctx)) as JobResultObject;
        expect(calls).toHaveLength(3);
        expect(result.fannedOut).toBe(3);
        expect(calls.every((call) => call.kind === 'noop')).toBe(true);
    });

    test('child dedupe keys are distinct and derived from the parent job id', async () => {
        const { ctx, calls } = makeContext();
        await noopHandler({ fanOut: 4 }, ctx);
        const keys = calls.map((call) => call.opts?.dedupeKey);
        expect(new Set(keys).size).toBe(4);
        expect(keys.every((key) => key?.startsWith('noop-child:job_parent:'))).toBe(true);
    });

    test('children never fan out again', async () => {
        const { ctx, calls } = makeContext();
        await noopHandler({ child: true, fanOut: 5 }, ctx);
        expect(calls).toHaveLength(0);
    });

    test('a deduped child is not counted as newly enqueued', async () => {
        const { ctx } = makeContext();
        const dedupedCtx: JobContext = {
            ...ctx,
            enqueue: async () => ({ jobId: 'existing', deduped: true }),
        };
        const result = (await noopHandler({ fanOut: 2 }, dedupedCtx)) as JobResultObject;
        expect(result.fannedOut).toBe(0);
    });

    test('re-running the same parent produces the same child dedupe keys (idempotent fan-out)', async () => {
        const first = makeContext();
        const second = makeContext();
        await noopHandler({ fanOut: 2 }, first.ctx);
        await noopHandler({ fanOut: 2 }, second.ctx);
        expect(first.calls.map((c) => c.opts?.dedupeKey)).toEqual(second.calls.map((c) => c.opts?.dedupeKey));
    });
});
