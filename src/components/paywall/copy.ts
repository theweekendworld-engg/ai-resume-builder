import type { Tier } from '@prisma/client';
import { CAREER_PLAN, SEARCH_PLAN, headlinePrice, priceFor, type PriceKey } from '@/lib/plans';

/**
 * Paywall copy (PRD 06 §4).
 *
 * A paywall converts when it appears at peak intent, shows the user's **own**
 * data, and states a specific price. All three are structural here rather than
 * left to the caller:
 *
 *   - Every builder takes the user's real numbers as required arguments.
 *   - Every builder returns `hasOwnData`, and the renderer returns `null` when
 *     it is false. A user with nothing of their own to show never sees a
 *     paywall — that is the anti-pattern the PRD bans, alongside countdown
 *     timers, fake scarcity, and interstitials before someone has produced
 *     anything.
 *   - The price string comes from `PLAN_CATALOG`, so it cannot drift from what
 *     Stripe actually charges.
 *
 * The copy below is the spec's copy. Change it in the PRD first.
 */

export type PaywallCode = 'PW1' | 'PW2' | 'PW3' | 'PW4' | 'PW5' | 'PW6' | 'PW7';

export interface PaywallContent {
  code: PaywallCode;
  /** The line that states their situation, in their numbers. */
  headline: string;
  /** The offer. Always names the plan and the price. */
  body: string;
  ctaLabel: string;
  /** What the CTA buys. */
  targetTier: Tier;
  priceKey: PriceKey;
  /**
   * False when we could not find real data of the user's own. The renderer
   * must not show the paywall — this is a hard rule, not a preference.
   */
  hasOwnData: boolean;
  /** Non-blocking surfaces sit inline and never take the screen. */
  tone: 'inline' | 'banner';
}

const CAREER = headlinePrice(CAREER_PLAN.tier)?.label ?? '$99/year';
const SEARCH = priceFor('search_monthly').label;

// ---------------------------------------------------------------------------
// PW1 — brag doc, greyed competency section
// ---------------------------------------------------------------------------

export function pw1GapsAnalysis(input: {
  winCount: number;
  /** The level they're being measured against: "Staff". */
  targetLevel: string | null;
}): PaywallContent {
  const level = input.targetLevel?.trim() || null;
  return {
    code: 'PW1',
    headline: `You have ${input.winCount} wins and no gaps analysis.`,
    body: level
      ? `See what's missing for ${level} — ${CAREER_PLAN.name}, ${CAREER}.`
      : `See what's missing for your next level — ${CAREER_PLAN.name}, ${CAREER}.`,
    ctaLabel: `Get ${CAREER_PLAN.name}`,
    targetTier: CAREER_PLAN.tier,
    priceKey: 'career_annual',
    hasOwnData: input.winCount > 0,
    tone: 'inline',
  };
}

// ---------------------------------------------------------------------------
// PW2 — log hits 90 days
// ---------------------------------------------------------------------------

/**
 * Note what this never says: nothing about deletion. The wins are *saved*.
 * Threatening a user's record to sell them a plan would be a lie and would cost
 * more than the subscription is worth.
 */
export function pw2HiddenHistory(input: { hiddenWinCount: number }): PaywallContent {
  return {
    code: 'PW2',
    headline: `+${input.hiddenWinCount} older wins are saved but hidden.`,
    body: `Unlock your full record — ${CAREER_PLAN.name}, ${CAREER}.`,
    ctaLabel: 'Unlock your full record',
    targetTier: CAREER_PLAN.tier,
    priceKey: 'career_annual',
    hasOwnData: input.hiddenWinCount > 0,
    tone: 'inline',
  };
}

// ---------------------------------------------------------------------------
// PW3 — free tailored generations exhausted
// ---------------------------------------------------------------------------

export function pw3TailoredExhausted(input: { limit: number; used: number }): PaywallContent {
  return {
    code: 'PW3',
    headline: `You've used your ${input.limit} free tailored resumes.`,
    body: `The next role you actually care about — let's make it perfect. ${CAREER_PLAN.name}, ${CAREER}.`,
    ctaLabel: `Get ${CAREER_PLAN.name}`,
    targetTier: CAREER_PLAN.tier,
    priceKey: 'career_annual',
    hasOwnData: input.used > 0,
    tone: 'inline',
  };
}

// ---------------------------------------------------------------------------
// PW4 — Radar signal worth acting on
// ---------------------------------------------------------------------------

export function pw4MarketSignal(input: {
  /** Band delta in percent, e.g. 12 for +12%. */
  bandDeltaPercent?: number | null;
  /** A specific role match, e.g. 91. */
  matchPercent?: number | null;
  roleTitle?: string | null;
  /** How many comparable salaries the band is built from. Never hide `n`. */
  bandSampleSize?: number | null;
}): PaywallContent {
  const delta = input.bandDeltaPercent ?? null;
  const match = input.matchPercent ?? null;
  const n = input.bandSampleSize ?? null;

  const headline =
    delta !== null
      ? `Your band moved ${delta > 0 ? '+' : ''}${delta}%${n ? ` across ${n} comparable roles` : ''}.`
      : match !== null
        ? `${match}% match${input.roleTitle ? ` on ${input.roleTitle}` : ''}.`
        : 'Your market moved.';

  return {
    code: 'PW4',
    headline,
    body: `Want to test the market? Turn ${SEARCH_PLAN.name} on for a month — ${SEARCH}, off whenever you stop.`,
    ctaLabel: `Turn ${SEARCH_PLAN.name} on`,
    targetTier: SEARCH_PLAN.tier,
    priceKey: 'search_monthly',
    hasOwnData: delta !== null || match !== null,
    tone: 'banner',
  };
}

// ---------------------------------------------------------------------------
// PW5 — Career user starts the "land a new role" mission
// ---------------------------------------------------------------------------

export function pw5MissionNeedsSearch(input: { missionName: string }): PaywallContent {
  return {
    code: 'PW5',
    headline: `${input.missionName} uses unlimited tailoring and apply automation.`,
    body: `Add ${SEARCH_PLAN.name} — ${SEARCH}, cancel any time.`,
    ctaLabel: `Add ${SEARCH_PLAN.name}`,
    targetTier: SEARCH_PLAN.tier,
    priceKey: 'search_monthly',
    hasOwnData: input.missionName.length > 0,
    tone: 'inline',
  };
}

// ---------------------------------------------------------------------------
// PW6 — T-90 review nudge (email; rendered by the email surface)
// ---------------------------------------------------------------------------

export function pw6ReviewNudge(input: {
  monthsToReview: number;
  /** The single largest gap, named. Without it there is no email. */
  gap: string | null;
}): PaywallContent {
  return {
    code: 'PW6',
    headline: `Your review is ${input.monthsToReview} months out.`,
    body: input.gap
      ? `Here's the one gap worth working on — ${input.gap}.`
      : 'Here is the one gap worth working on.',
    ctaLabel: 'See it',
    targetTier: CAREER_PLAN.tier,
    priceKey: 'career_annual',
    hasOwnData: Boolean(input.gap),
    tone: 'inline',
  };
}

// ---------------------------------------------------------------------------
// PW7 — connecting a second source on Free
// ---------------------------------------------------------------------------

export function pw7SourceLimit(input: {
  connectedSources: number;
  careerSourceLimit: number;
}): PaywallContent {
  return {
    code: 'PW7',
    headline: `You've connected ${input.connectedSources} of 1 source.`,
    body: `${CAREER_PLAN.name} connects up to ${input.careerSourceLimit} sources — GitHub, calendar, and your tracker. ${CAREER}.`,
    ctaLabel: `Get ${CAREER_PLAN.name}`,
    targetTier: CAREER_PLAN.tier,
    priceKey: 'career_annual',
    hasOwnData: input.connectedSources > 0,
    tone: 'inline',
  };
}

/**
 * Soft-mode note (PRD 06 §4). We are not enforcing yet, and saying so is the
 * difference between a warning and a trap.
 */
export const SOFT_MODE_NOTE =
  "You're over your limit. We're not enforcing this yet — but we will, and we'll tell you before we do.";
