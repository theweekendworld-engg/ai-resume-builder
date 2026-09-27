import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { GRACE_PERIOD_DAYS } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { planName } from '@/lib/plans';
import {
  getStripe,
  localSubscriptionStatus,
  primaryPriceId,
  priceIdToTier,
  resolvePeriodEnd,
  slotForStripePriceId,
  stripeKeyConfigured,
  stripeCustomerId,
} from '@/lib/stripe';
import { track } from '@/lib/track';

// Stripe requires the raw, unparsed request body for signature verification.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Find the Patronus user behind a Stripe customer.
 *
 * Both of a user's slots carry the same customer id, so either row answers the
 * question. This used to have to unwrap a `::search` suffix out of `userId`;
 * now the column means what it says.
 */
async function userIdForCustomer(customerId: string): Promise<string | undefined> {
  const row = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return row?.userId;
}

/** Upsert the Subscription row for a Stripe subscription, in its own slot. */
async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId = stripeCustomerId(subscription.customer);
  const priceId = primaryPriceId(subscription);
  const tier = priceIdToTier(priceId);
  const slot = slotForStripePriceId(priceId);

  const userId =
    (subscription.metadata?.userId as string | undefined) ??
    (await userIdForCustomer(customerId));

  // Nothing we can attribute this to — safe to ignore.
  if (!userId) return;

  const previous = await prisma.subscription.findUnique({
    where: { userId_slot: { userId, slot } },
    select: { tier: true, status: true },
  });

  const data = {
    stripeCustomerId: customerId,
    stripeSubId: subscription.id,
    tier,
    status: localSubscriptionStatus(subscription),
    currentPeriodEnd: resolvePeriodEnd(subscription),
  };

  await prisma.subscription.upsert({
    where: { userId_slot: { userId, slot } },
    create: { userId, slot, ...data },
    update: data,
  });

  if (!previous || previous.tier !== tier || previous.status !== data.status) {
    await track(userId, 'plan_changed', {
      slot,
      from: previous ? planName(previous.tier) : planName(tier),
      to: planName(tier),
      status: data.status,
      reason: reasonFor(previous?.status, data.status),
    });
  }
}

function reasonFor(from: string | undefined, to: string): string {
  if (to === 'canceling' || to === 'canceled') return 'downgrade';
  if (to === 'past_due') return 'failed_payment';
  if (from === 'past_due' && to === 'active') return 'recovered';
  return 'upgrade';
}

/**
 * PRD 06 §5.5 — a failed card is not a churn decision. Full access for 14 days.
 *
 * The grace window is expressed by parking `currentPeriodEnd` at its end, so
 * the ordinary period-end check in `getUserTier` closes it on day 14 with no
 * cron, no sweep, and nothing to forget to run.
 */
async function applyPaymentFailure(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer ? stripeCustomerId(invoice.customer) : null;
  if (!customerId) return;

  const subId = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const subscriptionId = typeof subId === 'string' ? subId : subId?.id;

  const rows = await prisma.subscription.findMany({
    where: subscriptionId
      ? { stripeCustomerId: customerId, stripeSubId: subscriptionId }
      : { stripeCustomerId: customerId },
    select: { id: true, userId: true, slot: true, tier: true },
  });
  if (rows.length === 0) return;

  const graceEnd = new Date(Date.now() + GRACE_PERIOD_DAYS * 86_400_000);
  // By row id, not by userId. Under the old `::search` keying those were the
  // same thing; now a user's two slots share a userId, so `WHERE userId IN
  // (...)` would put BOTH subscriptions into grace when only one card failed —
  // handing out free Search on a failed Career payment.
  await prisma.subscription.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: 'past_due', currentPeriodEnd: graceEnd },
  });

  for (const row of rows) {
    await track(row.userId, 'plan_changed', {
      slot: row.slot,
      from: planName(row.tier),
      to: planName(row.tier),
      reason: 'failed_payment',
      graceEndsAt: graceEnd.toISOString(),
    });
  }
}

export async function POST(req: NextRequest) {
  if (!stripeKeyConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid signature';
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subId);
          // Stamp userId onto the subscription so future events self-attribute.
          const userId = session.client_reference_id ?? subscription.metadata?.userId;
          if (userId && !subscription.metadata?.userId) {
            await stripe.subscriptions.update(subId, { metadata: { userId } });
            subscription.metadata = { ...subscription.metadata, userId };
          }
          await syncSubscription(subscription);
          if (userId) {
            await track(userId, 'checkout_completed', {
              tier: planName(priceIdToTier(primaryPriceId(subscription))),
              amount: session.amount_total ?? undefined,
            });
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        await applyPaymentFailure(event.data.object as Stripe.Invoice);
        break;
      }
      case 'invoice.payment_succeeded': {
        // Recovery from `past_due`: re-read the subscription so the real period
        // end replaces the grace-window date we parked there.
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as unknown as { subscription?: string | { id: string } })
          .subscription;
        const subscriptionId = typeof subId === 'string' ? subId : subId?.id;
        if (subscriptionId) {
          await syncSubscription(await stripe.subscriptions.retrieve(subscriptionId));
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged (200) so Stripe stops retrying.
        break;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook handler error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
