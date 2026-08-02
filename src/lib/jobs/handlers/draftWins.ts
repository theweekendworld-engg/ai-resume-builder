/**
 * `draft_wins` — turn stored signals into Win drafts.
 *
 * The expensive half of capture, deliberately separated from the pull so the
 * two fail independently (see `captureSync.ts`).
 *
 * Idempotency is the signal claim in `runDrafting`, not this handler: the
 * runner's deadline is soft, so a retry can start while an abandoned attempt is
 * still mid-flight. A double-run therefore claims nothing and returns
 * `drafted: 0` rather than paying twice for the same PR.
 */

import { z } from 'zod';
import type { JobHandler, JobResultObject } from '@/lib/jobs/types';
import { runDrafting } from '@/lib/capture/draftRun';

export const DRAFT_WINS_JOB_KIND = 'draft_wins' as const;

const DraftWinsPayloadSchema = z.object({
    userId: z.string().min(1).max(64),
    sourceId: z.string().min(1).max(64),
    runId: z.string().min(1).max(64).nullable().default(null),
    trigger: z.enum(['initial', 'scheduled', 'manual']).default('scheduled'),
});

export type DraftWinsPayload = z.infer<typeof DraftWinsPayloadSchema>;

export const draftWinsHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = DraftWinsPayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(`draft_wins: invalid payload — ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }

    const summary = await runDrafting({
        userId: parsed.data.userId,
        sourceId: parsed.data.sourceId,
        runId: parsed.data.runId,
        trigger: parsed.data.trigger,
    });

    ctx.log('drafting finished', {
        sourceId: parsed.data.sourceId,
        candidates: summary.candidates,
        drafted: summary.drafted,
        skipped: summary.skipped,
        status: summary.status,
    });

    return {
        // Copied onto `Job.costUsd` by the runner, so per-feature roll-ups work
        // without a second write (§P-5).
        costUsd: summary.costUsd,
        candidates: summary.candidates,
        drafted: summary.drafted,
        skipped: summary.skipped,
        modelCalls: summary.modelCalls,
        status: summary.status,
        winIds: summary.winIds,
    };
};
