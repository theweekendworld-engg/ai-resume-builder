/**
 * Proactive downgrade sweep (PRD 06 §5.3).
 *
 * We offer to turn Search off before the user asks. Triggers: they marked an
 * application as an offer, or thirty days passed with no apply activity on a
 * Search subscription.
 *
 * This is deliberate product posture, not a courtesy. A user who trusts they
 * can leave comes back for the next hunt and keeps paying for Career in
 * between — so the bet is that volunteering the downgrade *increases* lifetime
 * revenue. `search_reactivated` is the number that proves or kills it, which is
 * why this runs on a schedule rather than only when someone happens to open
 * the billing page.
 *
 * Two modes, distinguished by payload, following §P-2's fan-out rule:
 *   `{}`                dispatch — enqueue one child per Search subscriber
 *   `{ userId }`        evaluate one user
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { evaluateProactiveDowngrade } from '@/lib/entitlements';
import { track } from '@/lib/track';
import type { JobHandler, JobResult } from '../types';

/** Keeps one tick from enqueueing a child per subscriber on a large base. */
const DISPATCH_LIMIT = 2_000;

const PayloadSchema = z.object({ userId: z.string().min(1).optional() });

/**
 * Candidates are resolved by live subscription rows rather than by tier. Cheap
 * filter here, authoritative decision in the child.
 *
 * This used to strip a `::search` suffix out of `userId` by hand — the second
 * implementation of a convention that was supposed to live behind helpers in
 * `entitlements.ts`, and the reason `Subscription.slot` is now a real column.
 * `distinct` does the de-duplication the string surgery was doing.
 */
async function dispatch(enqueue: Parameters<JobHandler>[1]['enqueue']): Promise<JobResult> {
    const rows = await prisma.subscription.findMany({
        where: { status: { in: ['active', 'trialing'] } },
        select: { userId: true },
        distinct: ['userId'],
        take: DISPATCH_LIMIT,
    });

    const userIds = rows.map((row) => row.userId);

    const day = new Date().toISOString().slice(0, 10);
    let enqueued = 0;
    for (const userId of userIds) {
        const { deduped } = await enqueue(
            'proactive_downgrade',
            { userId },
            // One evaluation per user per day, however many times the tick runs.
            { dedupeKey: `downgrade:${userId}:${day}` },
        );
        if (!deduped) enqueued += 1;
    }

    return { mode: 'dispatch', candidates: userIds.length, enqueued };
}

export const proactiveDowngradeHandler: JobHandler = async (payload, ctx): Promise<JobResult> => {
    const input = PayloadSchema.parse(payload ?? {});
    if (!input.userId) return dispatch(ctx.enqueue);

    const offer = await evaluateProactiveDowngrade(input.userId);
    if (!offer) return { mode: 'evaluate', offered: false };

    // The offer surfaces on the billing page; this records that it became
    // available, so the offered→accepted funnel is measurable from the sweep
    // rather than only from a page view.
    await track(input.userId, 'proactive_downgrade_offered', {
        feature: 'billing',
        trigger: offer.trigger,
        source: 'scheduled_sweep',
    });

    ctx.log('proactive downgrade offered', { userId: input.userId, trigger: offer.trigger });
    return { mode: 'evaluate', offered: true, trigger: offer.trigger };
};
