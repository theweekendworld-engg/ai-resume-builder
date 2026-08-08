'use server';

/**
 * The Month in Review read path (design/02 §E — `/log/review/[yyyy-mm]`).
 *
 * Follows impl/00 §P-3: Clerk `auth()` -> zod parse -> work -> `Result<T>`.
 * There is no metered action here on purpose. Re-reading a review you have
 * already been sent is not a billable event, and the one branch that would
 * cost money (composing a paragraph on demand) is deliberately not taken —
 * see `source` below.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { err, ok, type Result } from '@/lib/result';
import { gateMeteredAction } from '@/lib/entitlements';
import {
    buildMonthInReview,
    formatPeriodKey,
    loadPersistedReview,
    mixForWinIds,
    parsePeriodKey,
    periodLabel,
    visibleMixRows,
} from '@/services/monthInReview';

export type MonthInReviewMixRow = { category: string; count: number };

/** Exactly the five blocks of §E, flat and serializable. */
export type MonthInReviewView = {
    periodKey: string;
    /** "July 2026" */
    label: string;
    /** "8 wins, 5 with hard numbers" */
    headline: string;
    winCount: number;
    quantifiedCount: number;
    mix: MonthInReviewMixRow[];
    mixSentence: string;
    /** Null when the entity or digit check dropped it. Never a placeholder. */
    paragraph: string | null;
    /** Null when there was no specific observation to make. Never a filler line. */
    observation: string | null;
    receipt: string;
    /** Null when the review was composed but never emailed. */
    sentAt: Date | null;
    /**
     * `sent`     — the `MonthlyReview` row, and the email went out. The page and
     *              the inbox say the same thing, forever.
     * `composed` — the same row, never emailed (opted out, no address, a
     *              provider outage). Renders in full, paragraph included.
     * `computed` — no row: a month that predates this feature. Every block is
     *              real except the paragraph, which is absent rather than
     *              rewritten — a document that changes wording on refresh is not
     *              something anyone can screenshot.
     */
    source: 'sent' | 'composed' | 'computed';
};

const PeriodKeySchema = z.string().trim().regex(/^\d{4}-\d{2}$/, 'expected a yyyy-mm period');

export async function getMonthInReview(periodKey: string): Promise<Result<MonthInReviewView>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    // `month_in_review` has carried a limit since packaging shipped —
    // `period(0)` on Free, unlimited on Career — and was never passed to
    // `gateMeteredAction` anywhere. It is the flagship Career differentiator in
    // the comparison table, so the day the `work_log` flag turns on, every free
    // user would have had it. A declared limit with no call site is not a
    // limit; it is documentation.
    const gate = await gateMeteredAction(userId, 'month_in_review');
    if (!gate.allowed) {
        return err(gate.reason ?? 'Month in Review is not included on this plan', 'entitlement');
    }

    const parsedKey = PeriodKeySchema.safeParse(periodKey);
    if (!parsedKey.success) return err('Invalid month', 'invalid_input');

    const period = parsePeriodKey(parsedKey.data);
    if (!period) return err('Invalid month', 'invalid_input');

    const now = new Date();
    const currentKey = formatPeriodKey({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
    // A month that has not finished has no review. Say so rather than rendering
    // a half month as though it were the whole thing.
    if (parsedKey.data >= currentKey) return err('That month is not over yet', 'not_found');

    const stored = await loadPersistedReview(userId, parsedKey.data);
    if (stored) {
        // The bars are the one thing the row does not carry, so they are derived
        // from the win ids it does — the same wins, not a fresh read of the month.
        const mix = await mixForWinIds(userId, stored.winIds);
        return ok({
            periodKey: stored.period,
            label: periodLabel(period),
            headline: stored.headline,
            winCount: stored.winCount,
            quantifiedCount: stored.quantifiedCount,
            mix: visibleMixRows(
                mix.map((entry) => ({ category: String(entry.category), count: entry.count })),
            ),
            mixSentence: stored.mixSentence ?? '',
            paragraph: stored.paragraph,
            observation: stored.observation,
            receipt: stored.receipt,
            sentAt: stored.sentAt,
            source: stored.sentAt ? 'sent' : 'composed',
        });
    }

    const review = await buildMonthInReview({ userId, period, now, compose: false });
    if (!review) {
        return err(`No confirmed wins in ${periodLabel(period)}`, 'not_found');
    }

    return ok({
        periodKey: review.periodKey,
        label: review.label,
        headline: review.headline,
        winCount: review.winCount,
        quantifiedCount: review.quantifiedCount,
        mix: visibleMixRows(
            review.mix.map((entry) => ({ category: String(entry.category), count: entry.count })),
        ),
        mixSentence: review.mixSentence,
        paragraph: null,
        observation: review.observation?.text ?? null,
        receipt: review.receipt,
        sentAt: null,
        source: 'computed',
    });
}
