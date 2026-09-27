import type { Tier } from '@prisma/client';
import type { DowngradeOffer } from '@/lib/entitlements';
import type { MeteredAction, QuotaScope, SubscriptionSlot } from '@/lib/plans';

/**
 * The billing action contract (PRD 06 §5–6).
 *
 * Split out of `billing.ts` because a `'use server'` module may only export
 * async functions — types and constants have to live next door.
 *
 * Everything here is a **wire type**: it crosses the server/client boundary, so
 * dates are ISO strings and "unlimited" is `null` rather than `Infinity`, which
 * does not survive serialization.
 */

export type Url = { url: string };

// ---------------------------------------------------------------------------
// Plan surface
// ---------------------------------------------------------------------------

export interface UsageLineView {
  action: MeteredAction;
  label: string;
  used: number;
  /** `null` means unlimited on this plan. */
  limit: number | null;
  remaining: number | null;
  scope: QuotaScope;
  /** ISO date, or `null` for lifetime quotas — they never reset. */
  resetsOn: string | null;
  /** False when the action isn't part of this plan at all. */
  available: boolean;
}

export interface SubscriptionView {
  slot: SubscriptionSlot;
  /** Display name. Never render the tier itself (CLAUDE.md rule 4). */
  planName: string;
  priceLabel: string | null;
  status: string;
  /** ISO date. Renewal date, or the end date when winding down. */
  currentPeriodEnd: string | null;
  active: boolean;
  cancelAtPeriodEnd: boolean;
  pastDue: boolean;
}

export interface PlanPageData {
  tier: Tier;
  planName: string;
  planBlurb: string;
  priceLabel: string | null;
  usage: UsageLineView[];
  career: SubscriptionView | null;
  search: SubscriptionView | null;
  /** True once `ENTITLEMENTS_ENFORCE=true`. Soft mode says so out loud. */
  enforced: boolean;
  /** A purchase can be started today (a provider with a working checkout). */
  billingConfigured: boolean;
  /** An existing subscription can be managed (portal, cancel, refund). */
  portalAvailable: boolean;
  downgradeOffer: DowngradeOffer | null;
  /** ISO date; present only inside the 14-day annual refund window. */
  refundEligibleUntil: string | null;
  /** Whether adding Search on top is the sensible next step. */
  canAddSearch: boolean;
}

// ---------------------------------------------------------------------------
// The trust-building downgrade (PRD 06 §5.3)
// ---------------------------------------------------------------------------

/**
 * Defined in the entitlement layer so a scheduled handler can evaluate the
 * trigger without importing a `'use server'` module; re-exported here because
 * this is the contract the UI reads.
 */
export type { DowngradeOffer, DowngradeTrigger } from '@/lib/entitlements';

export interface TurnOffSearchOutcome {
  /** ISO date. Access continues to here — cancelling is never mid-period. */
  endsOn: string | null;
  /** The plan that remains. Never Free unless they were never on Career. */
  remainingPlan: string;
}

// ---------------------------------------------------------------------------
// Cancellation (PRD 06 §5.4)
// ---------------------------------------------------------------------------

/**
 * One optional question, five options plus free text, skippable in one click.
 * There is no sixth screen after this and there is no discount offer.
 */
export const CANCEL_REASONS = [
  'got_the_job',
  'not_using_it',
  'too_expensive',
  'missing_something',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  got_the_job: 'I got the job',
  not_using_it: "I'm not using it",
  too_expensive: "It's too expensive",
  missing_something: "It's missing something I need",
  other: 'Something else',
};

export interface CancelOutcome {
  /** ISO date. Paid access continues to here. */
  accessUntil: string | null;
  /** Always true, and asserted by an integration test rather than promised. */
  dataRetained: true;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportBundle {
  filename: string;
  json: string;
}
