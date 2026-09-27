/**
 * Drain the job queue now, after the response, instead of waiting for the
 * next cron tick.
 *
 * The cron is daily on Vercel Hobby. A user who connects GitHub expects drafts
 * in minutes, not tomorrow morning; confirming a win should embed it now, not
 * overnight. `kickQueue()` runs one bounded drain inside `after()`, so the
 * request returns immediately and the function stays alive to do the work.
 * The drain is the same one the cron runs (claiming with locks, retries,
 * dedupe), so a kick racing the cron is safe.
 *
 * Outside a request scope `after` throws; the drain then runs detached, which
 * is what tests and scripts want anyway.
 */

import { drain } from '@/lib/jobs/runner';
import { registerAllHandlers } from '@/lib/jobs/registry';

/** Well inside the 300s function limit, leaving room for the response. */
const KICK_BUDGET_MS = 40_000;
const KICK_BATCH = 10;

export async function kickQueue(reason: string): Promise<void> {
    // Tests drive the queue explicitly. A background drain racing a test's own
    // drain made the J1 journey flaky (2026-09-27).
    if (process.env.NODE_ENV === 'test') return;
    const work = async () => {
        try {
            registerAllHandlers();
            const result = await drain(KICK_BUDGET_MS, KICK_BATCH);
            console.info('[jobs] kick drained', { reason, claimed: result.claimed, succeeded: result.succeeded });
        } catch (error: unknown) {
            // The cron remains the backstop; a failed kick only delays the work.
            console.warn('[jobs] kick failed', { reason, error: String(error) });
        }
    };
    try {
        const { after } = await import('next/server');
        after(work);
    } catch {
        void work();
    }
}
