/**
 * The smoke-test handler (impl/01 §P0.2 "done when": a `noop` enqueued in
 * production is picked up by the next tick and lands in `succeeded` with a
 * duration).
 *
 * It also exercises the two paths that are otherwise hard to verify safely on
 * a live deployment: the retry/backoff path (`failWith`) and the fan-out rule
 * (`fanOut` — a handler enqueues children rather than looping itself, §P-2).
 */

import { z } from 'zod';
import type { JobHandler, JobResultObject } from '../types';
import { buildDedupeKey } from '../runner';

export const NOOP_MAX_FAN_OUT = 10;

const NoopPayloadSchema = z.object({
    /** Echoed back into `Job.result`, so a smoke test can assert round-tripping. */
    echo: z.string().max(500).optional(),
    /** Force a throw, to exercise attempts/backoff/dead. */
    failWith: z.string().max(200).optional(),
    /** Enqueue this many child `noop` jobs instead of doing work inline. */
    fanOut: z.number().int().min(0).max(NOOP_MAX_FAN_OUT).optional(),
    /** Set on children so they never fan out again. */
    child: z.boolean().optional(),
});

export type NoopPayload = z.infer<typeof NoopPayloadSchema>;

export function parseNoopPayload(payload: unknown): NoopPayload {
    const parsed = NoopPayloadSchema.safeParse(payload ?? {});
    return parsed.success ? parsed.data : {};
}

export const noopHandler: JobHandler = async (payload, ctx) => {
    const input = parseNoopPayload(payload);
    ctx.log('noop start', { attempt: ctx.attempt, deadline: ctx.deadline.toISOString() });

    if (input.failWith) {
        throw new Error(`noop deliberate failure: ${input.failWith}`);
    }

    let fannedOut = 0;
    if (!input.child && input.fanOut && input.fanOut > 0) {
        for (let index = 0; index < input.fanOut; index += 1) {
            const { deduped } = await ctx.enqueue(
                'noop',
                { child: true, echo: input.echo ?? null },
                { dedupeKey: buildDedupeKey('noop-child', [ctx.jobId, index]) },
            );
            if (!deduped) fannedOut += 1;
        }
    }

    const result: JobResultObject = {
        echo: input.echo ?? null,
        attempt: ctx.attempt,
        fannedOut,
        ranAt: new Date().toISOString(),
    };
    ctx.log('noop done', result);
    return result;
};
