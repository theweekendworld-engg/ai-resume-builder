'use server';

import { auth, currentUser } from '@clerk/nextjs/server';
import { Tier } from '@prisma/client';
import type {
  CancelOutcome,
  CancelReason,
  ExportBundle,
  PlanPageData,
  SubscriptionView,
  TurnOffSearchOutcome,
  UsageLineView,
  Url,
} from '@/actions/billing.types';
import { z } from 'zod';
import { config } from '@/lib/config';
import { isAdminUserId } from '@/lib/adminAuth';
import {
  createDodoCheckout,
  dodoPortalLink,
  reconcileDodoReturn,
  refundDodoSubscription,
  setDodoCancelAtPeriodEnd,
} from '@/lib/billing/dodoBilling';
import {
  BILLING_UNAVAILABLE_COPY,
  billingProvider,
  checkoutAvailable,
  dodoEnvironment,
  dodoKeyConfigured,
} from '@/lib/billing/provider';
import {
  evaluateProactiveDowngrade,
  getEntitlementSnapshot,
  getSubscriptionState,
  type DowngradeTrigger,
  type SubscriptionSummary,
} from '@/lib/entitlements';
import {
  CAREER_PLAN,
  PLAN_CATALOG,
  SEARCH_PLAN,
  headlinePrice,
  isPriceKey,
  isUnlimited,
  launchOpenAccess,
  planName,
  priceFor,
  slotForPriceKey,
  stripePriceId,
  tierForPriceKey,
  type PriceKey,
  type SubscriptionSlot,
} from '@/lib/plans';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import {
  checkoutIdempotencyKey,
  getStripe,
  localSubscriptionStatus,
  primaryPriceId,
  priceIdToTier,
  resolvePeriodEnd,
  slotForStripePriceId,
  stripeKeyConfigured,
  stripeCustomerId,
  toPriceKey,
  type BillingPlan,
} from '@/lib/stripe';
import { track } from '@/lib/track';

/**
 * Billing actions (PRD 06 §5–6).
 *
 * The posture here is the product's whole argument, so it is worth stating in
 * the file that implements it: **Search is designed to be switched off.** We
 * volunteer the downgrade, we cancel in one confirm, we never delete data, and
 * the export button sits on the page where someone is thinking about leaving.
 *
 * A user who trusts they can leave comes back for the next hunt, and keeps
 * paying for Career in between. Retention theatre would poison the one
 * relationship that compounds.
 *
 * Types and constants live in `billing.types.ts` — a `'use server'` module may
 * only export async functions.
 *
 * Providers: a NEW purchase goes to `billingProvider()` (Dodo Payments when it
 * is configured, docs/impl/09-payments-dodo.md); everything that touches an
 * EXISTING subscription follows that row's `provider` column, so Stripe rows
 * keep working through the Stripe paths and admin grants touch no provider.
 */

const REFUND_WINDOW_DAYS = 14;

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Can THIS user start a purchase? A provider must be able to take money, and
 * while the launch is on (`launchOpenAccess`) only admins are offered one, so
 * the owner can run a test-mode purchase without switching everyone to paid.
 * Enforced in `startCheckout` too: the plan page is not where money is taken.
 */
function checkoutOfferedTo(userId: string): boolean {
  return checkoutAvailable() && (!launchOpenAccess() || isAdminUserId(userId));
}

/** The provider client for this row can be reached (cancel, portal, refund). */
function manageable(sub: SubscriptionSummary | null): boolean {
  if (!sub?.active || !sub.subscriptionRef) return false;
  if (sub.provider === 'dodo') return dodoKeyConfigured();
  if (sub.provider === 'stripe') return stripeKeyConfigured();
  return false;
}

async function checkoutIdentity(): Promise<{ email: string | null; name: string | null }> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null;
  return { email, name };
}

// ---------------------------------------------------------------------------
// Customer + checkout
// ---------------------------------------------------------------------------

/**
 * Ensure the user has a Stripe customer, returning its id. One customer serves
 * both subscription slots; the Career row is where we pin it.
 */
async function ensureStripeCustomer(userId: string): Promise<string> {
  const existing = await prisma.subscription.findFirst({
    // Either slot will do — both rows carry the same Stripe customer. Scoped to
    // Stripe: an admin grant's `admin_grant:` id or a Dodo customer is not one.
    where: { userId, provider: 'stripe', customerRef: { not: '' } },
    select: { customerRef: true },
  });
  if (existing?.customerRef) return existing.customerRef;

  const stripe = getStripe();
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;

  const customer = await stripe.customers.create({ email, metadata: { userId } });

  // Seed the Career row so the customer id has a home. The webhook upgrades
  // tier/status once checkout completes.
  await prisma.subscription.upsert({
    where: { userId_slot: { userId, slot: 'career' } },
    create: { userId, slot: 'career', provider: 'stripe', customerRef: customer.id, status: 'incomplete' },
    update: { provider: 'stripe', customerRef: customer.id },
  });

  return customer.id;
}

/**
 * Start checkout for one plan, with whichever provider is configured (Dodo
 * Payments first, then Stripe).
 *
 * Adding Search to an active Career account creates a *second* subscription on
 * the same customer — deliberate (PRD 06 §5.2), and what makes "turn Search
 * off" a cancellation rather than surgery on a line item.
 */
export async function startCheckout(
  plan: PriceKey,
  options: { paywallCode?: string } = {}
): Promise<Result<Url>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  if (!isPriceKey(plan)) return err('Unknown plan.', 'bad_plan');
  if (!checkoutOfferedTo(userId)) return err(BILLING_UNAVAILABLE_COPY, 'billing_unavailable');

  const price = priceFor(plan);
  const tier = tierForPriceKey(plan);
  const provider = billingProvider();

  // Search sits ON TOP of Career — both the pricing page and the plan screen
  // say so in those words — and nothing enforced it.
  //
  // `PLAN_FEATURES.pro` is a strict superset of `PLAN_FEATURES.always_on`, and
  // the effective tier is `maxTier` over active subscriptions. So a customer
  // who bought Search alone for $2 received every Career capability plus
  // unlimited generations, for $3 less than Career. The cheapest paid plan was
  // the best one, and the upsell ladder ran downhill.
  //
  // Enforced here rather than in the UI because the UI is not where money is
  // taken. A checkout URL is reachable by anyone who can call a server action.
  const state = await getSubscriptionState(userId);
  if (slotForPriceKey(plan) === 'search') {
    if (!state.career?.active) {
      return err(
        `${SEARCH_PLAN.name} sits on top of ${CAREER_PLAN.name} — add ${CAREER_PLAN.name} first, then turn ${SEARCH_PLAN.name} on for as long as you are looking.`,
        'career_required'
      );
    }
  }

  // Never sell a slot that is already paid for. A comp (admin grant) does not
  // count: buying over it is how the owner tests a real purchase.
  const current = slotForPriceKey(plan) === 'search' ? state.search : state.career;
  if (current?.active && current.provider !== 'admin_grant') {
    return err(`You already have ${planName(current.tier)}.`, 'already_subscribed');
  }

  if (provider === 'dodo') {
    const checkout = await createDodoCheckout(userId, plan, checkoutIdentity);
    if (!checkout.success) return checkout;
    if (!checkout.data.reused) {
      await track(userId, 'checkout_started', {
        tier: planName(tier),
        interval: price.interval,
        amount: price.amountCents,
        paywall: options.paywallCode,
        provider: 'dodo',
      });
    }
    return ok({ url: checkout.data.url });
  }

  const priceId = stripePriceId(plan);
  if (!priceId) {
    return err(`No price configured for ${price.label}.`, 'price_unconfigured');
  }

  try {
    const customerId = await ensureStripeCustomer(userId);
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        client_reference_id: userId,
        subscription_data: { metadata: { userId, slot: slotForPriceKey(plan) } },
        metadata: { userId, priceKey: plan },
        success_url: `${config.app.url}/settings/plan?checkout={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.app.url}/settings/plan?checkout=cancelled`,
      },
      // Two devices, one subscription (PRD 06 §8).
      { idempotencyKey: checkoutIdempotencyKey(userId, plan) }
    );

    if (!session.url) return err('Stripe did not return a checkout URL.', 'stripe_error');

    await track(userId, 'checkout_started', {
      tier: planName(tier),
      interval: price.interval,
      amount: price.amountCents,
      paywall: options.paywallCode,
    });

    return ok({ url: session.url });
  } catch (error: unknown) {
    return err(error instanceof Error ? error.message : 'Failed to start checkout.', 'stripe_error');
  }
}

/** @deprecated Legacy entry point. Use {@link startCheckout} with a `PriceKey`. */
export async function createCheckoutSession(plan: BillingPlan): Promise<Result<Url>> {
  const key = toPriceKey(plan);
  if (!key) return err(`Unknown plan "${plan}".`, 'bad_plan');
  return startCheckout(key);
}

/**
 * Reconcile immediately on the post-checkout redirect (PRD 06 §5.1).
 *
 * Someone who just paid must not sit behind a webhook. We read the session,
 * grant optimistically, and the webhook later writes the same row with the same
 * values — the upsert on a slot-keyed row is the idempotency guard.
 */
export async function reconcileCheckout(sessionId: string): Promise<Result<{ planName: string }>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  if (!stripeKeyConfigured()) return err('Billing is not available yet.', 'stripe_unconfigured');
  if (!sessionId || sessionId === 'cancelled') return err('No checkout to reconcile.', 'no_session');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id && session.client_reference_id !== userId) {
      return err('That checkout belongs to another account.', 'forbidden');
    }
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return err('Checkout has no subscription yet.', 'pending');

    const subscription = await stripe.subscriptions.retrieve(subId);
    const priceId = primaryPriceId(subscription);
    const tier = priceIdToTier(priceId);
    const slot = slotForStripePriceId(priceId);

    const data = {
      provider: 'stripe' as const,
      customerRef: stripeCustomerId(subscription.customer),
      subscriptionRef: subscription.id,
      tier,
      status: localSubscriptionStatus(subscription),
      currentPeriodEnd: resolvePeriodEnd(subscription),
    };
    await prisma.subscription.upsert({
      where: { userId_slot: { userId, slot } },
      create: { userId, slot, ...data },
      update: data,
    });

    return ok({ planName: planName(tier) });
  } catch (error: unknown) {
    return err(
      error instanceof Error ? error.message : 'Could not confirm your plan.',
      'stripe_error'
    );
  }
}

const DodoReturnSchema = z.object({
  // Dodo ids are short opaque tokens (`sub_…`). Anything else is not one.
  subscriptionId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullish(),
});

/**
 * The Dodo return redirect (`/settings/plan?checkout=dodo&subscription_id=…`).
 * The query string is a hint: `reconcileDodoReturn` reads the subscription
 * from Dodo and checks it is this user's before granting anything.
 */
export async function reconcileDodoCheckout(input: {
  subscriptionId?: string | null;
}): Promise<Result<{ planName: string }>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  const parsed = DodoReturnSchema.safeParse(input);
  if (!parsed.success) return err('No checkout to reconcile.', 'no_session');
  if (!dodoKeyConfigured()) return err('Billing is not available yet.', 'provider_unconfigured');

  const result = await reconcileDodoReturn(userId, parsed.data.subscriptionId ?? null);
  if (!result.success) return result;
  return ok({ planName: planName(result.data.tier) });
}

/**
 * Open the provider's billing portal (payment method, invoices). Follows the
 * live subscription's provider; a Dodo customer with nothing live can still
 * open theirs to read past invoices.
 */
export async function createBillingPortalSession(): Promise<Result<Url>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const { career, search } = await getSubscriptionState(userId);
  const live = [career, search].find((sub) => manageable(sub)) ?? null;

  if (live?.provider === 'dodo' || (!live && dodoKeyConfigured())) {
    const customerRef =
      live?.customerRef ??
      (
        await prisma.billingCustomer.findUnique({
          where: { userId_provider: { userId, provider: 'dodo' } },
          select: { customerRef: true },
        })
      )?.customerRef;
    if (customerRef) return dodoPortalLink(customerRef);
    if (live) return err('No billing account found.', 'no_customer');
  }

  if (!stripeKeyConfigured()) return err('Billing is not available yet.', 'stripe_unconfigured');

  const sub = await prisma.subscription.findFirst({
    where: { userId, provider: 'stripe', customerRef: { not: '' } },
    select: { customerRef: true },
  });
  if (!sub?.customerRef) return err('No billing account found.', 'no_customer');

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.customerRef,
      return_url: `${config.app.url}/settings/plan`,
    });
    return ok({ url: session.url });
  } catch (error: unknown) {
    return err(
      error instanceof Error ? error.message : 'Failed to open billing portal.',
      'stripe_error'
    );
  }
}

// ---------------------------------------------------------------------------
// The plan surface
// ---------------------------------------------------------------------------

function toSubscriptionView(sub: SubscriptionSummary | null): SubscriptionView | null {
  if (!sub) return null;
  return {
    slot: sub.slot,
    planName: planName(sub.tier),
    priceLabel: headlinePrice(sub.tier)?.label ?? null,
    status: sub.status,
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    active: sub.active,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    pastDue: sub.pastDue,
  };
}

/**
 * Read model for `/settings/plan`.
 *
 * Deliberately takes no `userId`: a server action is a public endpoint, and one
 * that accepted a user id would hand anyone else's plan and usage to whoever
 * asked. The identity comes from the session, always.
 *
 * Every metered action is listed, including the ones this plan doesn't include
 * and the ones the user has never touched. Nobody should discover a limit by
 * hitting it (PRD 06 §6).
 */
export async function getPlanPageData(): Promise<Result<PlanPageData>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const snapshot = await getEntitlementSnapshot(userId);
  const { tier, career, search } = snapshot.subscriptions;
  const offer = await evaluateProactiveDowngrade(userId);

  const usage: UsageLineView[] = snapshot.usage.map((line) => ({
    action: line.action,
    label: line.label,
    used: line.used,
    limit: isUnlimited(line.limit) ? null : line.limit,
    remaining: isUnlimited(line.remaining) ? null : line.remaining,
    scope: line.scope,
    resetsOn: iso(line.resetsOn),
    available: line.available,
  }));

  return ok({
    tier,
    planName: planName(tier),
    planBlurb: PLAN_CATALOG[tier].blurb,
    priceLabel: headlinePrice(tier)?.label ?? null,
    usage,
    career: toSubscriptionView(career),
    search: toSubscriptionView(search),
    enforced: snapshot.enforced,
    billingConfigured: checkoutOfferedTo(userId),
    // While the launch is on, only admins get here with a live checkout: say
    // so on the page, and say whether a real card would be charged.
    adminCheckoutPreview: launchOpenAccess() && checkoutAvailable() && isAdminUserId(userId),
    checkoutTestMode: billingProvider() === 'dodo' && dodoEnvironment() === 'test_mode',
    // The portal needs the live subscription's provider to be reachable. An
    // admin grant has no provider, so it has no portal.
    portalAvailable: manageable(career) || manageable(search),
    downgradeOffer: offer,
    refundEligibleUntil: iso(refundWindowEnd(career)),
    // Search sits on top of Career (enforced in startCheckout). Offering it to
    // someone without Career only produced a guaranteed rejection.
    canAddSearch: Boolean(career?.active) && !search?.active,
    launchOpen: launchOpenAccess(),
  });
}

/**
 * PRD 06 §5.6 — 14-day no-questions refund on annual Career. Self-serve,
 * because the support cost of a manual policy exceeds the refund cost.
 */
function refundWindowEnd(career: SubscriptionSummary | null): Date | null {
  if (!career || career.tier !== Tier.always_on || !career.active) return null;
  const period = career.currentPeriodEnd;
  if (!period) return null;
  // Annual only: a monthly plan is already a 30-day commitment.
  const start = new Date(period.getTime() - 365 * 86_400_000);
  const end = new Date(start.getTime() + REFUND_WINDOW_DAYS * 86_400_000);
  return end.getTime() > Date.now() ? end : null;
}

// ---------------------------------------------------------------------------
// Turning Search off — the trust-building flow (PRD 06 §5.3)
// ---------------------------------------------------------------------------

/**
 * Record that the offer was shown. Separate from computing it so a page render
 * the user never saw doesn't burn the once-a-month ask.
 */
export async function recordDowngradeOffered(trigger: DowngradeTrigger): Promise<Result<null>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  await track(userId, 'proactive_downgrade_offered', { trigger });
  return ok(null);
}

export async function declineDowngradeOffer(trigger: DowngradeTrigger): Promise<Result<null>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  await track(userId, 'proactive_downgrade_declined', { trigger });
  return ok(null);
}

/**
 * Turn Search off. Career survives — that is the entire point.
 *
 * Cancels at period end, never mid-period: they paid for the month. Stamps a
 * `winBack` marker on the Stripe subscription so the next hunt is one click
 * with their configuration intact.
 */
export async function turnOffSearch(
  options: { trigger?: DowngradeTrigger } = {}
): Promise<Result<TurnOffSearchOutcome>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const trigger: DowngradeTrigger = options.trigger ?? 'user_initiated';
  const state = await getSubscriptionState(userId);
  if (!state.search?.active) return err('Search is not switched on.', 'not_subscribed');
  if (state.search.cancelAtPeriodEnd) {
    return ok({
      endsOn: iso(state.search.currentPeriodEnd),
      remainingPlan: planName(state.career?.active ? state.career.tier : Tier.free),
    });
  }

  if (state.search.provider === 'dodo' && state.search.subscriptionRef) {
    if (!dodoKeyConfigured()) return err('Billing is not available right now. Nothing was changed.', 'provider_unconfigured');
    const cancelled = await setDodoCancelAtPeriodEnd(state.search.subscriptionRef, true);
    if (!cancelled.success) return cancelled;
  } else if (state.search.subscriptionRef && stripeKeyConfigured()) {
    try {
      const stripe = getStripe();
      await stripe.subscriptions.update(state.search.subscriptionRef, {
        cancel_at_period_end: true,
        metadata: { userId, winBack: '1', winBackAt: new Date().toISOString() },
      });
    } catch (error: unknown) {
      return err(
        error instanceof Error ? error.message : 'Could not turn Search off.',
        'stripe_error'
      );
    }
  }

  await prisma.subscription.update({
    where: { userId_slot: { userId, slot: 'search' } },
    data: { status: 'canceling' },
  });

  // Career is untouched by construction — a different row and a different
  // Stripe subscription. Resolve what's left rather than assuming it.
  const after = await getSubscriptionState(userId);
  const remaining = after.career?.active ? after.career.tier : Tier.free;

  if (trigger !== 'user_initiated') {
    await track(userId, 'proactive_downgrade_accepted', { trigger });
  }
  await track(userId, 'plan_changed', {
    from: planName(Tier.pro),
    to: planName(remaining),
    reason: trigger === 'user_initiated' ? 'downgrade' : 'proactive',
  });

  return ok({
    endsOn: iso(state.search.currentPeriodEnd),
    remainingPlan: planName(remaining),
  });
}

/**
 * Turn Search back on.
 *
 * Inside the paid period this is a metadata flip: no charge, nothing lost.
 * After it lapsed it is a fresh checkout. Either way `search_reactivated`
 * fires — it is the thesis metric for §1, the number that decides whether
 * volunteering downgrades was right.
 */
export async function reactivateSearch(): Promise<Result<{ url: string | null }>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const state = await getSubscriptionState(userId);
  const daysSinceOff = await daysSinceSearchOff(userId);

  if (state.search?.cancelAtPeriodEnd && state.search.subscriptionRef) {
    if (state.search.provider === 'dodo') {
      if (!dodoKeyConfigured()) return err('Billing is not available right now. Nothing was changed.', 'provider_unconfigured');
      const resumed = await setDodoCancelAtPeriodEnd(state.search.subscriptionRef, false);
      if (!resumed.success) return resumed;
    } else if (stripeKeyConfigured()) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.update(state.search.subscriptionRef, {
          cancel_at_period_end: false,
        });
      } catch (error: unknown) {
        return err(
          error instanceof Error ? error.message : 'Could not turn Search back on.',
          'stripe_error'
        );
      }
    }
    await prisma.subscription.update({
      where: { userId_slot: { userId, slot: 'search' } },
      data: { status: 'active' },
    });
    await track(userId, 'search_reactivated', { daysSinceOff, resumed: true });
    return ok({ url: null });
  }

  const checkout = await startCheckout('search_monthly');
  if (!checkout.success) return checkout;
  await track(userId, 'search_reactivated', { daysSinceOff, resumed: false });
  return ok({ url: checkout.data.url });
}

async function daysSinceSearchOff(userId: string): Promise<number | null> {
  const event = await prisma.funnelEvent.findFirst({
    where: { userId, type: 'proactive_downgrade_accepted' },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  if (!event) return null;
  return Math.max(0, Math.round((Date.now() - event.occurredAt.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Cancellation (PRD 06 §5.4)
// ---------------------------------------------------------------------------

/** Entering the cancel flow is not a conversion event. We just count it. */
export async function enterCancelFlow(): Promise<Result<null>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  const { tier } = await getSubscriptionState(userId);
  await track(userId, 'cancel_flow_entered', { tier: planName(tier) });
  return ok(null);
}

/**
 * Cancel a subscription. **One confirm. No retention modal, no discount
 * ambush, no "are you sure" chain.**
 *
 * Effective at period end, and it deletes nothing: Wins, Evidence, packets and
 * resumes all stay exactly where they are. Free hides history past 90 days; it
 * never removes it. There is an integration test on that sentence.
 */
export async function cancelPlan(input: {
  slot?: SubscriptionSlot;
  reason?: CancelReason;
  reasonText?: string;
  exportedFirst?: boolean;
}): Promise<Result<CancelOutcome>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const slot = input.slot ?? 'career';
  const state = await getSubscriptionState(userId);
  const target = slot === 'search' ? state.search : state.career;
  if (!target?.active) return err('There is nothing to cancel.', 'not_subscribed');

  if (target.provider === 'dodo' && target.subscriptionRef) {
    // Dodo: `cancel_at_next_billing_date`, the same at-period-end posture.
    if (!dodoKeyConfigured()) return err('Billing is not available right now. Nothing was changed.', 'provider_unconfigured');
    const cancelled = await setDodoCancelAtPeriodEnd(target.subscriptionRef, true);
    if (!cancelled.success) return cancelled;
  } else if (target.subscriptionRef && stripeKeyConfigured()) {
    try {
      const stripe = getStripe();
      await stripe.subscriptions.update(target.subscriptionRef, { cancel_at_period_end: true });
    } catch (error: unknown) {
      return err(
        error instanceof Error ? error.message : 'Could not cancel your plan.',
        'stripe_error'
      );
    }
  }

  await prisma.subscription.update({
    where: { userId_slot: { userId, slot } },
    data: { status: 'canceling' },
  });

  await track(userId, 'cancel_flow_completed', {
    tier: planName(target.tier),
    slot,
    reason: input.reason ?? null,
    reasonText: input.reasonText?.slice(0, 500) ?? null,
    exportedFirst: Boolean(input.exportedFirst),
  });
  await track(userId, 'plan_changed', {
    from: planName(target.tier),
    to: planName(Tier.free),
    reason: 'downgrade',
  });

  return ok({ accessUntil: iso(target.currentPeriodEnd), dataRetained: true });
}

/**
 * PRD 06 §5.6. Self-serve refund inside 14 days on annual Career, no questions.
 * Refunding also ends the subscription immediately — keeping it running would
 * be a way of keeping the money, which is the thing we said we wouldn't do.
 */
export async function requestRefund(): Promise<Result<{ refunded: boolean }>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  const { career } = await getSubscriptionState(userId);
  if (!career?.active || !career.subscriptionRef) return err('Nothing to refund.', 'not_subscribed');
  if (!refundWindowEnd(career)) return err('The 14-day refund window has passed.', 'window_closed');

  if (career.provider === 'dodo') {
    if (!dodoKeyConfigured()) return err('Billing is not available right now. Write to support for the refund.', 'provider_unconfigured');
    const refunded = await refundDodoSubscription(career.subscriptionRef);
    if (!refunded.success) return refunded;
    await prisma.subscription.update({
      where: { userId_slot: { userId, slot: 'career' } },
      data: { status: 'canceled', currentPeriodEnd: new Date() },
    });
    await track(userId, 'plan_changed', {
      from: planName(career.tier),
      to: planName(Tier.free),
      reason: 'refund',
      provider: 'dodo',
    });
    return ok({ refunded: true });
  }

  if (!stripeKeyConfigured()) return err('Billing is not available yet.', 'stripe_unconfigured');

  try {
    const stripe = getStripe();
    const invoices = await stripe.invoices.list({
      customer: career.customerRef ?? undefined,
      limit: 1,
    });
    const invoice = invoices.data[0];
    const paymentIntent = (invoice as unknown as { payment_intent?: string | { id: string } })
      ?.payment_intent;
    const intentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
    if (!intentId) return err('No payment found to refund.', 'no_payment');

    await stripe.refunds.create({ payment_intent: intentId });
    await stripe.subscriptions.cancel(career.subscriptionRef);
    await prisma.subscription.update({
      where: { userId_slot: { userId, slot: 'career' } },
      data: { status: 'canceled', currentPeriodEnd: new Date() },
    });
    await track(userId, 'plan_changed', {
      from: planName(career.tier),
      to: planName(Tier.free),
      reason: 'refund',
    });
    return ok({ refunded: true });
  } catch (error: unknown) {
    return err(
      error instanceof Error ? error.message : 'Could not process the refund.',
      'stripe_error'
    );
  }
}

// ---------------------------------------------------------------------------
// Export (PRD 06 §6) — on the plan page on purpose
// ---------------------------------------------------------------------------

/**
 * Everything the user has, as JSON, in one click.
 *
 * On the plan page and inside the cancel flow deliberately: an export that only
 * exists after you've emailed support is not an export. It is also the honest
 * counterpart to "we never delete your data" — you can always take it with you.
 */
export async function exportEverything(): Promise<Result<ExportBundle>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');

  // Everything we hold, read from the schema so a new table is never left
  // out (launch audit 2026-10-02: chat, jobs, channels, contacts, insights,
  // capture data and agent runs were missing). Secrets are not data about
  // you: token, hash and secret fields are redacted, and vectors are skipped.
  const { userOwnedModels } = await import('@/services/accountDeletion');
  const SKIP = new Set(['vectorPoint', 'channelLinkToken', 'rateLimitHit']);
  const SECRET = /(token|secret|hash|verifier|password)/i;
  const redact = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, SECRET.test(key) ? '[redacted]' : value]));

  const tables: Record<string, unknown[]> = {};
  for (const model of userOwnedModels()) {
    if (SKIP.has(model)) continue;
    const delegate = (prisma as unknown as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]> }>)[model];
    tables[model] = (await delegate.findMany({ where: { userId }, take: 20_000 })).map(redact);
  }

  const bundle = {
    schema: 'patronus.export.v2',
    exportedAt: new Date().toISOString(),
    // v1's keys, kept so anything that read a v1 export still works.
    profile: tables.userProfile?.[0] ?? null,
    wins: tables.win ?? [],
    evidence: tables.evidence ?? [],
    claimLinks: tables.claimLink ?? [],
    impactMetrics: tables.impactMetric ?? [],
    reviewPackets: tables.reviewPacket ?? [],
    resumes: tables.resume ?? [],
    experiences: tables.userExperience ?? [],
    projects: tables.userProject ?? [],
    tables,
  };
  const wins = tables.win ?? [];
  const packets = tables.reviewPacket ?? [];

  await track(userId, 'data_exported', { wins: wins.length, packets: packets.length });

  const stamp = new Date().toISOString().slice(0, 10);
  return ok({
    filename: `patronus-export-${stamp}.json`,
    json: JSON.stringify(bundle, null, 2),
  });
}

// ---------------------------------------------------------------------------
// Paywall telemetry
// ---------------------------------------------------------------------------

/**
 * `paywall_shown` is recorded server-side because the payload carries
 * `hasOwnData`, and that is the field we most need to be able to audit: a
 * paywall shown to someone with nothing of their own to show is the
 * anti-pattern PRD 06 §4 bans.
 */
export async function recordPaywallShown(input: {
  code: string;
  feature?: string;
  hasOwnData: boolean;
}): Promise<Result<null>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  const { tier } = await getSubscriptionState(userId);
  await track(userId, 'paywall_shown', {
    code: input.code,
    tier: planName(tier),
    feature: input.feature ?? null,
    hasOwnData: input.hasOwnData,
  });
  return ok(null);
}

export async function recordPaywallCta(input: {
  code: string;
  targetTier: Tier;
}): Promise<Result<null>> {
  const { userId } = await auth();
  if (!userId) return err('Not authenticated', 'unauthenticated');
  await track(userId, 'paywall_cta_clicked', {
    code: input.code,
    targetTier: planName(input.targetTier),
  });
  return ok(null);
}
