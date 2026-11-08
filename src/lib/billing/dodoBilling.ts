import { Prisma, type BillingCustomer, type Tier } from '@prisma/client';
import { applyDodoSubscription } from '@/lib/billing/dodoSync';
import { config } from '@/lib/config';
import { getDodo } from '@/lib/dodo';
import { dodoProductId, priceFor, slotForPriceKey, type PriceKey } from '@/lib/plans';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';

/**
 * The Dodo Payments half of the billing actions (docs/impl/09-payments-dodo.md).
 *
 * Plain server functions that take an already-authenticated `userId`; the
 * `'use server'` actions in `src/actions/billing.ts` own auth, input parsing,
 * the launch gate and telemetry, and pick this provider by the row's
 * `provider` column (or, for a new purchase, `billingProvider()`).
 */

/** A second click inside this window reuses the session instead of opening another. */
const CHECKOUT_REUSE_MS = 60 * 60 * 1000;

export type CheckoutIdentity = { email: string | null; name: string | null };

/**
 * Dodo's API errors read like "404 The requested resource could not be found.
 * This might be because…" (seen against the test API, 2026-11-08). That is for
 * the log, not the customer: log it, show plain copy.
 */
function dodoError(error: unknown, fallback: string): string {
    const status = (error as { status?: unknown } | null)?.status;
    console.error('[dodo] API call failed', {
        status: typeof status === 'number' ? status : null,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
    return fallback;
}

/**
 * The user's Dodo customer, created on first checkout and stored BEFORE any
 * payment. The webhook resolves the user from this customer id, so it never
 * depends on Dodo copying checkout metadata onto the subscription.
 */
export async function ensureDodoCustomer(
    userId: string,
    loadIdentity: () => Promise<CheckoutIdentity>,
): Promise<Result<BillingCustomer>> {
    const existing = await prisma.billingCustomer.findUnique({
        where: { userId_provider: { userId, provider: 'dodo' } },
    });
    if (existing) return ok(existing);

    // Only a first checkout needs the profile (one Clerk call).
    const identity = await loadIdentity();
    const email = identity.email?.trim();
    if (!email) return err('Add an email address to your account before subscribing, so the receipt has somewhere to go.', 'no_email');
    const name = identity.name?.trim() || email.split('@')[0];

    const customer = await getDodo().customers.create({ email, name, metadata: { userId } });
    try {
        const row = await prisma.billingCustomer.create({
            data: { userId, provider: 'dodo', customerRef: customer.customer_id },
        });
        return ok(row);
    } catch (error: unknown) {
        // Two tabs raced. Keep the first mapping; the second Dodo customer is
        // an empty record with no payment on it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const winner = await prisma.billingCustomer.findUnique({
                where: { userId_provider: { userId, provider: 'dodo' } },
            });
            if (winner) return ok(winner);
        }
        throw error;
    }
}

/**
 * Open a Dodo checkout for one plan.
 *
 * Sends only the product id: the charged amount is the Dodo product's price,
 * never a number from this codebase. Metadata carries `userId`, `slot` and
 * `priceKey` for the dashboard and as a third way to attribute the purchase.
 *
 * Dodo appends `subscription_id` and `status` to `return_url` (it has no
 * session-id placeholder), and the page treats them as a hint only: the
 * reconcile re-reads the subscription from the API.
 */
export async function createDodoCheckout(
    userId: string,
    plan: PriceKey,
    loadIdentity: () => Promise<CheckoutIdentity>,
    now: Date = new Date(),
): Promise<Result<{ url: string; reused: boolean }>> {
    const productId = dodoProductId(plan);
    if (!productId) return err(`No product configured for ${priceFor(plan).label}.`, 'price_unconfigured');

    try {
        const customer = await ensureDodoCustomer(userId, loadIdentity);
        if (!customer.success) return customer;
        const billing = customer.data;

        // Two devices, one subscription (PRD 06 §8). Dodo has no idempotency
        // key, so the guard is ours: the same plan inside the hour gets the
        // same single-use session back.
        if (
            billing.pendingCheckoutKey === plan &&
            billing.pendingCheckoutUrl &&
            billing.pendingCheckoutAt &&
            now.getTime() - billing.pendingCheckoutAt.getTime() < CHECKOUT_REUSE_MS
        ) {
            return ok({ url: billing.pendingCheckoutUrl, reused: true });
        }

        const session = await getDodo().checkoutSessions.create({
            product_cart: [{ product_id: productId, quantity: 1 }],
            customer: { customer_id: billing.customerRef },
            return_url: `${config.app.url}/settings/plan?checkout=dodo`,
            cancel_url: `${config.app.url}/settings/plan?checkout=cancelled`,
            metadata: { userId, slot: slotForPriceKey(plan), priceKey: plan },
        });
        if (!session.checkout_url) return err('Dodo did not return a checkout link.', 'provider_error');

        await prisma.billingCustomer.update({
            where: { id: billing.id },
            data: {
                pendingCheckoutRef: session.session_id,
                pendingCheckoutKey: plan,
                pendingCheckoutUrl: session.checkout_url,
                pendingCheckoutAt: now,
            },
        });
        return ok({ url: session.checkout_url, reused: false });
    } catch (error: unknown) {
        return err(dodoError(error, 'Failed to start checkout.'), 'provider_error');
    }
}

/**
 * Grant immediately on the way back from checkout (PRD 06 §5.1), without
 * trusting the redirect: the subscription is read from Dodo's API and must
 * belong to this user's Dodo customer. With no `subscription_id` on the URL
 * the last session this user started is followed instead
 * (session → payment → subscription). The webhook later writes the same row.
 */
export async function reconcileDodoReturn(
    userId: string,
    subscriptionId: string | null,
): Promise<Result<{ tier: Tier; status: string }>> {
    const billing = await prisma.billingCustomer.findUnique({
        where: { userId_provider: { userId, provider: 'dodo' } },
    });
    if (!billing) return err('No checkout to reconcile.', 'no_customer');

    try {
        const dodo = getDodo();
        let subId = subscriptionId;
        if (!subId && billing.pendingCheckoutRef) {
            const session = await dodo.checkoutSessions.retrieve(billing.pendingCheckoutRef);
            if (session.payment_id) {
                const payment = await dodo.payments.retrieve(session.payment_id);
                subId = payment.subscription_id ?? payment.subscription_ids?.[0] ?? null;
            }
        }
        if (!subId) return err('Checkout has no subscription yet.', 'pending');

        const subscription = await dodo.subscriptions.retrieve(subId);
        if (subscription.customer?.customer_id !== billing.customerRef) {
            return err('That checkout belongs to another account.', 'forbidden');
        }

        const applied = await applyDodoSubscription({ sub: subscription, eventType: 'reconcile', eventAt: null, userId });
        if (!applied.applied) return err('Your plan is not confirmed yet.', 'pending');
        if (!['active', 'canceling', 'trialing'].includes(applied.status)) {
            return err('Your payment is not confirmed yet.', 'pending');
        }
        return ok({ tier: applied.tier, status: applied.status });
    } catch (error: unknown) {
        return err(dodoError(error, 'Could not confirm your plan.'), 'provider_error');
    }
}

/** Dodo's hosted customer portal: payment method, invoices, cancel. */
export async function dodoPortalLink(customerRef: string): Promise<Result<{ url: string }>> {
    try {
        const session = await getDodo().customers.customerPortal.create(customerRef, {
            return_url: `${config.app.url}/settings/plan`,
        });
        return ok({ url: session.link });
    } catch (error: unknown) {
        return err(dodoError(error, 'Failed to open billing portal.'), 'provider_error');
    }
}

/**
 * Cancel at the end of the paid period (or undo that). Never an immediate
 * cancel: they paid for the month.
 */
export async function setDodoCancelAtPeriodEnd(subscriptionRef: string, cancel: boolean): Promise<Result<null>> {
    try {
        await getDodo().subscriptions.update(subscriptionRef, { cancel_at_next_billing_date: cancel });
        return ok(null);
    } catch (error: unknown) {
        return err(dodoError(error, cancel ? 'Could not cancel your plan.' : 'Could not turn it back on.'), 'provider_error');
    }
}

/**
 * Refund the latest successful payment on a subscription and end it now.
 * Dodo is the Merchant of Record, so the refund is theirs to issue through
 * `refunds.create`; ending the subscription immediately is ours (keeping it
 * running would be a way of keeping the money).
 */
export async function refundDodoSubscription(subscriptionRef: string): Promise<Result<{ paymentId: string }>> {
    try {
        const dodo = getDodo();
        const page = await dodo.payments.list({ subscription_id: subscriptionRef, status: 'succeeded', page_size: 10 });
        const latest = [...page.items].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (!latest) return err('No payment found to refund.', 'no_payment');

        await dodo.refunds.create({ payment_id: latest.payment_id, reason: 'Self-serve refund inside the refund window' });
        await dodo.subscriptions.update(subscriptionRef, { status: 'cancelled', cancel_reason: 'cancelled_by_customer' });
        return ok({ paymentId: latest.payment_id });
    } catch (error: unknown) {
        return err(dodoError(error, 'Could not process the refund. Write to support and we will sort it out.'), 'provider_error');
    }
}
