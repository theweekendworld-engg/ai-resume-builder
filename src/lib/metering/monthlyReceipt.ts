/**
 * `month_in_review` is charged once per (user, month), never per view.
 * See the header of `src/actions/monthInReview.ts` for the rules.
 */

import { Prisma } from '@prisma/client';
import { gateMeteredAction, isEntitlementError } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';

/** Receipt rows share `UsageQuota`, under an action no meter ever reads. */
const RECEIPT_EPOCH = new Date(0);
export function receiptAction(periodKey: string): string {
    return `receipt:month_in_review:${periodKey}`;
}

/**
 * Charge `month_in_review` the first time this month's document is opened.
 *
 * The receipt is written FIRST, under the table's unique key, so two tabs
 * opening the same month charge once; if the gate then refuses, the receipt is
 * removed so an upgrade makes the document available.
 */
export async function chargeOncePerMonth(
    userId: string,
    periodKey: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
    const action = receiptAction(periodKey);
    try {
        await prisma.usageQuota.create({
            data: { userId, periodStart: RECEIPT_EPOCH, action, used: 1, limit: 1 },
        });
    } catch (error) {
        // Already charged for this month: every later view is free.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { ok: true };
        throw error;
    }

    const refuse = async (message: string) => {
        await prisma.usageQuota.deleteMany({ where: { userId, periodStart: RECEIPT_EPOCH, action } });
        return { ok: false as const, message };
    };
    try {
        const gate = await gateMeteredAction(userId, 'month_in_review');
        if (!gate.allowed) return refuse(gate.reason ?? 'Month in Review is not included on this plan.');
        return { ok: true };
    } catch (error) {
        if (isEntitlementError(error)) return refuse(error.message);
        await prisma.usageQuota.deleteMany({ where: { userId, periodStart: RECEIPT_EPOCH, action } });
        throw error;
    }
}
