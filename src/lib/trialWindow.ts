/**
 * The free trial of the view-only features.
 *
 * ── Why these two are different ─────────────────────────────────────────────
 *
 * Most of the product is metered: a tailored resume, a review packet, a Month
 * in Review are things you RUN, they each cost tokens, and "three free" is a
 * counter. That is `MeteredLimit.trial` in `plans.ts`.
 *
 * `radar_full` and `rubric_mapping` are not runs. They are depth on a screen —
 * the whole Radar rather than the teaser, the real readiness verdict rather
 * than the locked one. A counter is the wrong unit for a screen: a page
 * refresh would burn a use, and a user who hits back twice would spend their
 * trial without learning anything. That is not a limit, it is a trap.
 *
 * So for those, "a few free uses" means a window. It starts when the account
 * does, it needs no counter, no row and no write, and it cannot be spent by
 * accident.
 *
 * Length: `ENTITLEMENT_FREE_TRIAL_DAYS`, default 14.
 */

import type { Tier } from '@prisma/client';

import { PLAN_FEATURES, freeTrialDays, type PlanFeature } from '@/lib/plans';

/** Local rather than imported from `entitlements`, which imports Prisma. */
function hasFeature(tier: Tier, feature: PlanFeature): boolean {
    return PLAN_FEATURES[tier][feature];
}

/** The capabilities a free account gets in full for the trial window. */
const WINDOWED_FEATURES: readonly PlanFeature[] = ['radar_full', 'rubric_mapping'];

export type TrialWindow = {
    /** True while a free account is still inside its window. */
    active: boolean;
    /** Whole days left, floored. Zero once the window has closed. */
    daysLeft: number;
    endsOn: Date | null;
};

export function trialWindowFor(
    accountCreatedAt: Date | null | undefined,
    now: Date = new Date(),
): TrialWindow {
    const days = freeTrialDays();
    if (!accountCreatedAt || days <= 0) return { active: false, daysLeft: 0, endsOn: null };

    const endsOn = new Date(accountCreatedAt.getTime() + days * 24 * 60 * 60 * 1000);
    const msLeft = endsOn.getTime() - now.getTime();
    if (msLeft <= 0) return { active: false, daysLeft: 0, endsOn };

    return { active: true, daysLeft: Math.ceil(msLeft / (24 * 60 * 60 * 1000)), endsOn };
}

/**
 * Does this user see the feature in full right now?
 *
 * Paid tiers are answered by the plan table and never touch the window — a
 * subscriber's access does not expire because their account is old.
 */
export function hasFeatureOrTrial(
    tier: Tier,
    feature: PlanFeature,
    window: TrialWindow,
): boolean {
    if (hasFeature(tier, feature)) return true;
    if (!WINDOWED_FEATURES.includes(feature)) return false;
    return window.active;
}

/** True when the ONLY reason they can see this is the trial. Copy hangs off it. */
export function isTrialGranted(
    tier: Tier,
    feature: PlanFeature,
    window: TrialWindow,
): boolean {
    return !hasFeature(tier, feature) && WINDOWED_FEATURES.includes(feature) && window.active;
}

/**
 * Load a user's window from their profile row.
 *
 * `UserProfile.createdAt` is the account's own age — it is written by the
 * first upsert, which onboarding always performs. A user with no profile row
 * has not started, so they get a full window rather than none.
 *
 * Prisma is imported dynamically on purpose: `hasFeatureOrTrial` above is
 * pure and reachable from client components, and a top-level `@/lib/prisma`
 * here would pull the Prisma runtime into the browser bundle — the same trap
 * `plans.ts` documents about its type-only `Tier` import.
 */
export async function loadTrialWindow(userId: string, now: Date = new Date()): Promise<TrialWindow> {
    const { prisma } = await import('@/lib/prisma');
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { createdAt: true },
    });
    return trialWindowFor(profile?.createdAt ?? now, now);
}
