/**
 * The global notification budget (PRD 05 §7).
 *
 * > Global budget: 3 outbound messages per user per week, across all features.
 * > A priority queue enforces it: mission nudge > log digest > radar > product
 * > announcements. If the budget is exceeded, drop the lowest priority
 * > silently. Implement this as a shared service **before three features are
 * > independently emailing the same person**.
 *
 * That condition is now met exactly: the weekly digest, the Radar digest and
 * mission nudges are three features, each with its own cron, each convinced
 * its message is the important one. Nobody set out to send someone five emails
 * a week; it is what three reasonable cadences add up to.
 *
 * ── Where this is enforced, and why there ───────────────────────────────────
 *
 * Inside `sendEmail`, not at each call site. A budget that every feature has
 * to remember to check is a budget that the next feature forgets, and the
 * failure is invisible — nothing errors, the user just quietly gets too much
 * mail and stops opening any of it. Putting it at the one place every message
 * already passes through makes it structural.
 *
 * ── What does not count ─────────────────────────────────────────────────────
 *
 * `transactional` is exempt. A magic link is not a notification: rate-limiting
 * someone's login email to protect them from marketing would be an outage
 * dressed as a courtesy. The same goes for "your GitHub connection broke" —
 * operational mail the user needs in order to use the thing they paid for.
 *
 * The rule is: if a category has an unsubscribe preference, it competes for
 * the budget. If it does not, it is not a notification.
 */

import type { EmailCategory } from '@/lib/email/templates/transactional';

/** §7. Three, not four, because four is where people start filtering you. */
export const WEEKLY_NOTIFICATION_BUDGET = 3;

/**
 * Priority order, highest first.
 *
 * §7 names four of these explicitly — "mission nudge > log digest > radar >
 * product announcements". Month in Review is not in that list; it sits below
 * the weekly digest and above Radar because it is a ritual the user opted into
 * about their OWN record, where Radar is about the market. When a week is
 * crowded, news about you outranks news about everyone else.
 */
export const NOTIFICATION_PRIORITY: readonly EmailCategory[] = [
    'transactional',
    'missionNudges',
    'weeklyDigest',
    'monthlyReview',
    'radarDigest',
    'productUpdates',
];

/** Lower is more important. Unknown categories sort last rather than crash. */
export function priorityOf(category: EmailCategory): number {
    const index = NOTIFICATION_PRIORITY.indexOf(category);
    return index === -1 ? NOTIFICATION_PRIORITY.length : index;
}

/** Categories that do not consume budget — see the note above. */
export function isExemptFromBudget(category: EmailCategory): boolean {
    return category === 'transactional';
}

/**
 * The start of the budget week, in UTC.
 *
 * Monday, matching the weekly digest's own week so a Friday digest and a
 * Monday nudge are never accounted to different weeks in a way that lets four
 * messages through across a weekend.
 */
export function weekStart(now: Date): Date {
    const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
    const dayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayOffset);
    return date;
}

export type BudgetDecision =
    | { allowed: true; remaining: number }
    | { allowed: false; reason: 'budget_exhausted'; spent: number };

/**
 * How much of the week's budget each category may spend.
 *
 * An explicit table rather than arithmetic over the priority index. The first
 * version derived the ceiling from rank — each step down reserving one more
 * slot — and it collapsed: with three slots and five competing categories,
 * everything below the weekly digest saturated at the same number, so "radar
 * outranks announcements" was true in the ordering and meaningless in effect.
 * Five numbers that each have to be defended beats one formula that quietly
 * stops discriminating.
 *
 * The rule these encode: priority is spent as HEADROOM, because the competing
 * messages are crons hours or days apart and there is nothing to reorder
 * against at decision time. A category with a ceiling below the budget cannot
 * take the last slots of the week, so they are still there on Thursday when
 * something more important wants one.
 *
 *   missionNudges  3  The mission is the thing the user committed to. If they
 *                     get one message this week it should be this.
 *   weeklyDigest   3  The core ritual and the product's heartbeat. A digest
 *                     suppressed for being third is a broken promise.
 *   monthlyReview  2  Monthly, so it competes rarely — but it must not be the
 *                     message that crowds out a nudge.
 *   radarDigest    2  Monthly and about the market rather than about them.
 *   productUpdates 1  Ours, not theirs. Never takes more than the first slot.
 */
const CATEGORY_CEILING: Record<EmailCategory, number> = {
    transactional: Number.POSITIVE_INFINITY,
    missionNudges: WEEKLY_NOTIFICATION_BUDGET,
    weeklyDigest: WEEKLY_NOTIFICATION_BUDGET,
    monthlyReview: 2,
    radarDigest: 2,
    productUpdates: 1,
};

export function ceilingFor(category: EmailCategory): number {
    return CATEGORY_CEILING[category] ?? 1;
}

/**
 * Pure. Given what has already gone out this week, may this send proceed?
 *
 * Deliberately NOT a queue that reorders. §7 says "drop the lowest priority
 * silently", and by the time we are here the message is already being sent —
 * there is nothing to reorder against, because the competing messages are
 * other crons that ran hours ago or will run tomorrow.
 */
export function decideSend(input: {
    category: EmailCategory;
    /** Non-exempt messages already sent to this user this week. */
    spentThisWeek: number;
}): BudgetDecision {
    if (isExemptFromBudget(input.category)) {
        return { allowed: true, remaining: Number.POSITIVE_INFINITY };
    }

    const ceiling = Math.min(ceilingFor(input.category), WEEKLY_NOTIFICATION_BUDGET);
    if (input.spentThisWeek >= ceiling) {
        return { allowed: false, reason: 'budget_exhausted', spent: input.spentThisWeek };
    }
    return { allowed: true, remaining: ceiling - input.spentThisWeek };
}
