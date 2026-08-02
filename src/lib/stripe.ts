import Stripe from 'stripe';
import { Tier } from '@prisma/client';
import {
  isPriceKey,
  priceKeyForStripeId,
  slotForPriceKey,
  stripePriceId,
  tierForPriceKey,
  type PriceKey,
  type SubscriptionSlot,
} from '@/lib/plans';

/**
 * Stripe integration (PRD 06 §5).
 *
 * Env-driven and fail-soft: with no keys configured {@link stripeConfigured} is
 * false and billing actions return a clear error rather than crashing, so the
 * app runs fine in dev and before the monetization launch.
 *
 * Required env for live billing:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_CAREER_ANNUAL     ($30/year  → Tier.always_on, "Career")
 *   STRIPE_PRICE_CAREER_MONTHLY    ($5/month  → Tier.always_on, "Career")
 *   STRIPE_PRICE_SEARCH_MONTHLY    ($29/month → Tier.pro,       "Search")
 *
 * Career and Search are two *separate subscriptions* on the same customer, not
 * two items on one (PRD 06 §5.2). Proration stays simple, and turning Search
 * off is a cancellation of one object rather than surgery on a line item.
 */

/** @deprecated Use {@link PriceKey}. Retained for the pre-packaging call sites. */
export type BillingPlan = PriceKey | 'always_on' | 'pro_monthly' | 'pro_annual';

const LEGACY_PLAN_ALIASES: Record<'always_on' | 'pro_monthly' | 'pro_annual', PriceKey> = {
  always_on: 'career_monthly',
  pro_monthly: 'search_monthly',
  pro_annual: 'career_annual',
};

/** Normalize a legacy plan string onto the catalog's price keys. */
export function toPriceKey(plan: BillingPlan): PriceKey | null {
  if (isPriceKey(plan)) return plan;
  return LEGACY_PLAN_ALIASES[plan as keyof typeof LEGACY_PLAN_ALIASES] ?? null;
}

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY)');
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

/** Test seam: swap the client for a stub. Never call this from app code. */
export function __setStripeClientForTests(stub: Stripe | null): void {
  client = stub;
}

/** Map a checkout selection to its configured Stripe price id. */
export function planToPriceId(plan: BillingPlan): string | undefined {
  const key = toPriceKey(plan);
  return key ? stripePriceId(key) : undefined;
}

/**
 * Resolve the entitlement {@link Tier} a Stripe price id grants. Unknown prices
 * resolve to Free — fail closed, so a mis-typed env var cannot silently hand
 * out Search.
 */
export function priceIdToTier(priceId: string | null | undefined): Tier {
  const key = priceKeyForStripeId(priceId);
  return key ? tierForPriceKey(key) : Tier.free;
}

/**
 * Which subscription slot a Stripe object belongs in. Career is the default so
 * an unrecognized price never lands in the Search row and silently survives a
 * "turn Search off".
 */
export function slotForStripePriceId(priceId: string | null | undefined): SubscriptionSlot {
  const key = priceKeyForStripeId(priceId);
  return key ? slotForPriceKey(key) : 'career';
}

/** The first price id on a subscription — we never create multi-item subs. */
export function primaryPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

/** Resolve `current_period_end` across Stripe API-version shapes (top vs item level). */
export function resolvePeriodEnd(subscription: Stripe.Subscription): Date | null {
  const top = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const item = subscription.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const unix = top ?? item?.current_period_end;
  return typeof unix === 'number' ? new Date(unix * 1000) : null;
}

/**
 * Our local status string.
 *
 * `canceling` is ours, not Stripe's: a subscription with `cancel_at_period_end`
 * is still `active` to Stripe, but the difference is the entire point of the
 * plan page ("Search ends Aug 30" vs "renews Aug 30").
 */
export function localSubscriptionStatus(subscription: Stripe.Subscription): string {
  if (subscription.status === 'active' && subscription.cancel_at_period_end) return 'canceling';
  return subscription.status;
}

/**
 * Idempotency key for checkout creation (PRD 06 §8, "two devices upgrade
 * simultaneously"). Deliberately coarse — same user, same price, same hour
 * yields one session rather than two subscriptions.
 */
export function checkoutIdempotencyKey(userId: string, key: PriceKey, now: Date = new Date()): string {
  const hour = Math.floor(now.getTime() / 3_600_000);
  return `checkout:${userId}:${key}:${hour}`;
}

export const stripeCustomerId = (
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): string => (typeof customer === 'string' ? customer : customer.id);
