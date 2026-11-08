import { Prisma, Tier, type SubscriptionSlot } from '@prisma/client';
import type DodoPayments from 'dodopayments';
import type { DodoSubscription } from '@/lib/dodo';
import { GRACE_PERIOD_DAYS } from '@/lib/entitlements';
import { planName, priceKeyForDodoProduct, slotForPriceKey, tierForPriceKey } from '@/lib/plans';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';

/**
 * Dodo Payments → `Subscription` rows (docs/impl/09-payments-dodo.md §3).
 *
 * The one place a Dodo subscription becomes an entitlement. Both the webhook
 * and the post-checkout reconcile call {@link applyDodoSubscription}; neither
 * writes a row itself. Entitlements read `Subscription` only, so nothing else
 * changes when a provider is added.
 *
 * Three rules:
 *   1. **The browser is never trusted.** The webhook is signature-verified;
 *      the reconcile path re-reads the subscription from Dodo's API with our
 *      key and checks it belongs to the signed-in user's Dodo customer.
 *   2. **Unknown products fail closed.** A product id not mapped to a price in
 *      `plans.ts` never grants a paid tier.
 *   3. **Late events never win.** Webhooks retry and arrive out of order; a
 *      row remembers the timestamp of the event that produced it
 *      (`providerEventAt`) and an older event is ignored, through a
 *      conditional `updateMany` (the codebase's one concurrency pattern).
 */

/** The fields of a Dodo subscription we read. Webhook payloads carry all of them. */
export type DodoSubscriptionPayload = Pick<
    DodoSubscription,
    'subscription_id' | 'status' | 'product_id' | 'next_billing_date' | 'cancel_at_next_billing_date' | 'customer' | 'metadata'
> & {
    cancelled_at?: string | null;
    /** Webhook payloads only: the end of the provider's past-due window. */
    past_due_ends_at?: string | null;
};

type WebhookType = DodoPayments.UnwrapWebhookEvent['type'];

/** The subscription events we map onto a row. Everything else is acknowledged and ignored. */
export const DODO_SUBSCRIPTION_EVENTS = [
    'subscription.active',
    'subscription.updated',
    'subscription.renewed',
    'subscription.plan_changed',
    'subscription.on_hold',
    'subscription.past_due',
    'subscription.cancelled',
    'subscription.failed',
    'subscription.expired',
    'subscription.paused',
    'subscription.unpaused',
] as const satisfies readonly WebhookType[];

const SUBSCRIPTION_EVENT_SET: ReadonlySet<string> = new Set(DODO_SUBSCRIPTION_EVENTS);

/** Mirrors `ACCESS_STATUSES` in entitlements.ts: the statuses that grant access. */
const ACCESS = new Set(['active', 'trialing', 'canceling', 'past_due']);

export type LocalSubscriptionState = { status: string; currentPeriodEnd: Date | null };

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pure: what a Dodo subscription snapshot means for our row.
 *
 * The payload's `status` is the snapshot and decides, except that the terminal
 * events (`failed`, `expired`) always end access and `cancelled` is read for
 * whether it ends now or at the period end. `existing` is the row this same
 * subscription already wrote, if any; it only matters for the grace window,
 * which is never extended by a second failure event.
 *
 *   active                         → active   until next_billing_date
 *   active + cancel_at_next_billing_date → canceling until next_billing_date
 *   past_due / on_hold             → past_due until past_due_ends_at, else the
 *                                    grace end already parked, else now + 14 days
 *   cancelled, period still ahead and cancel_at_next_billing_date → canceling
 *   cancelled otherwise / failed / expired → canceled (no access)
 *   paused                         → paused (no access); unpaused reads `active`
 *   pending                        → incomplete (no access)
 */
export function dodoLocalState(
    eventType: string,
    sub: Pick<DodoSubscriptionPayload, 'status' | 'next_billing_date' | 'cancel_at_next_billing_date' | 'cancelled_at' | 'past_due_ends_at'>,
    now: Date,
    existing: LocalSubscriptionState | null,
): LocalSubscriptionState {
    const periodEnd = parseDate(sub.next_billing_date);
    const status = String(sub.status);

    if (eventType === 'subscription.failed' || eventType === 'subscription.expired' || status === 'failed' || status === 'expired') {
        return { status: 'canceled', currentPeriodEnd: parseDate(sub.cancelled_at) ?? now };
    }

    if (eventType === 'subscription.cancelled' || status === 'cancelled') {
        if (sub.cancel_at_next_billing_date && periodEnd && periodEnd.getTime() > now.getTime()) {
            return { status: 'canceling', currentPeriodEnd: periodEnd };
        }
        return { status: 'canceled', currentPeriodEnd: parseDate(sub.cancelled_at) ?? now };
    }

    switch (status) {
        case 'active':
            return { status: sub.cancel_at_next_billing_date ? 'canceling' : 'active', currentPeriodEnd: periodEnd };
        case 'past_due':
        case 'on_hold': {
            // PRD 06 §5.5: a failed card is not a churn decision. Same grace as
            // Stripe, parked in currentPeriodEnd so the ordinary period check
            // closes it with no cron. Dodo's own deadline wins when it sends one.
            const parked = existing?.status === 'past_due' ? existing.currentPeriodEnd : null;
            const graceEnd =
                parseDate(sub.past_due_ends_at) ?? parked ?? new Date(now.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
            return { status: 'past_due', currentPeriodEnd: graceEnd };
        }
        case 'paused':
            return { status: 'paused', currentPeriodEnd: periodEnd };
        case 'pending':
            return { status: 'incomplete', currentPeriodEnd: periodEnd };
        default:
            // Not in the access set, so an unknown status grants nothing.
            return { status, currentPeriodEnd: periodEnd };
    }
}

// ---------------------------------------------------------------------------
// Who is this?
// ---------------------------------------------------------------------------

export type ResolvedUser = { userId: string; via: 'subscription' | 'customer' | 'metadata' };

function metadataUserId(metadata: Record<string, unknown> | null | undefined): string | null {
    const value = metadata?.userId;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The Patronus user behind a Dodo subscription, most reliable first:
 *   1. a row this subscription already wrote;
 *   2. the Dodo customer we created for the user at checkout start
 *      (`BillingCustomer`) — the path that does not depend on Dodo copying
 *      checkout metadata, which its docs do not promise;
 *   3. `userId` in the subscription's or the customer's metadata, which we set
 *      at checkout start and customer creation, and which arrives inside a
 *      signed payload.
 */
export async function resolveDodoUser(sub: Pick<DodoSubscriptionPayload, 'subscription_id' | 'customer' | 'metadata'>): Promise<ResolvedUser | null> {
    const row = await prisma.subscription.findFirst({
        where: { provider: 'dodo', subscriptionRef: sub.subscription_id },
        select: { userId: true },
    });
    if (row) return { userId: row.userId, via: 'subscription' };

    const customerId = sub.customer?.customer_id;
    if (customerId) {
        const customer = await prisma.billingCustomer.findUnique({
            where: { provider_customerRef: { provider: 'dodo', customerRef: customerId } },
            select: { userId: true },
        });
        if (customer) return { userId: customer.userId, via: 'customer' };
    }

    const fromMetadata = metadataUserId(sub.metadata) ?? metadataUserId(sub.customer?.metadata);
    return fromMetadata ? { userId: fromMetadata, via: 'metadata' } : null;
}

// ---------------------------------------------------------------------------
// Writing the row
// ---------------------------------------------------------------------------

export type ApplyOutcome =
    | { applied: true; userId: string; slot: SubscriptionSlot; tier: Tier; status: string; currentPeriodEnd: Date | null }
    | { applied: false; reason: 'no_user' | 'unknown_product' | 'stale' | 'superseded' };

/**
 * Write one Dodo subscription snapshot to its user's slot row.
 *
 * `eventAt` is the webhook's own timestamp. The reconcile path passes null: it
 * has just read the live subscription, so it is never stale, and it leaves
 * `providerEventAt` alone so a real event a moment later still applies.
 */
export async function applyDodoSubscription(input: {
    sub: DodoSubscriptionPayload;
    eventType: string;
    eventAt: Date | null;
    /** Already resolved (the reconcile path, after an ownership check). */
    userId?: string;
    now?: Date;
    /** Internal: set on the one retry after a create race. */
    retried?: boolean;
}): Promise<ApplyOutcome> {
    const { sub, eventType, eventAt } = input;
    const now = input.now ?? new Date();

    const userId = input.userId ?? (await resolveDodoUser(sub))?.userId;
    if (!userId) return { applied: false, reason: 'no_user' };

    const priceKey = priceKeyForDodoProduct(sub.product_id);
    const known = await prisma.subscription.findFirst({
        where: { provider: 'dodo', subscriptionRef: sub.subscription_id, userId },
        select: { slot: true },
    });
    if (!priceKey && !known) return { applied: false, reason: 'unknown_product' };

    const slot: SubscriptionSlot = priceKey ? slotForPriceKey(priceKey) : known!.slot;
    // Fail closed: a product nobody mapped (renamed env var, deleted product)
    // keeps the row but grants nothing.
    const tier: Tier = priceKey ? tierForPriceKey(priceKey) : Tier.free;

    const previous = await prisma.subscription.findUnique({
        where: { userId_slot: { userId, slot } },
        select: { id: true, provider: true, subscriptionRef: true, tier: true, status: true, currentPeriodEnd: true, providerEventAt: true },
    });
    const sameSubscription = previous?.provider === 'dodo' && previous.subscriptionRef === sub.subscription_id;

    const state = dodoLocalState(eventType, sub, now, sameSubscription ? previous : null);
    const grants = ACCESS.has(state.status);

    // A late event for an OLD Dodo subscription must not end the live one that
    // replaced it in the same slot.
    if (previous && previous.provider === 'dodo' && !sameSubscription && previous.subscriptionRef && ACCESS.has(previous.status) && !grants) {
        return { applied: false, reason: 'superseded' };
    }

    const data = {
        provider: 'dodo' as const,
        customerRef: sub.customer.customer_id,
        subscriptionRef: sub.subscription_id,
        tier,
        status: state.status,
        currentPeriodEnd: state.currentPeriodEnd,
        ...(eventAt ? { providerEventAt: eventAt } : {}),
    };

    if (!previous) {
        try {
            await prisma.subscription.create({ data: { userId, slot, ...data } });
        } catch (error: unknown) {
            // The reconcile and the webhook raced to create the row. Go round
            // once more: the row exists now, so this takes the update path and
            // its freshness check.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && !input.retried) {
                return applyDodoSubscription({ ...input, userId, now, retried: true });
            }
            throw error;
        }
    } else {
        const fresherOnly =
            sameSubscription && eventAt
                ? { OR: [{ providerEventAt: null }, { providerEventAt: { lte: eventAt } }] }
                : {};
        const { count } = await prisma.subscription.updateMany({
            where: { id: previous.id, ...fresherOnly },
            data,
        });
        if (count === 0) return { applied: false, reason: 'stale' };
    }

    // This subscription has never written a row before (or only an unpaid one).
    const firstGrant = grants && (!sameSubscription || previous?.status === 'incomplete');
    if (!previous || previous.tier !== tier || previous.status !== state.status || !sameSubscription) {
        await track(userId, 'plan_changed', {
            slot,
            provider: 'dodo',
            from: previous ? planName(previous.tier) : planName(Tier.free),
            to: planName(tier),
            status: state.status,
            reason: reasonFor(previous?.status, state.status),
            ...(state.status === 'past_due' && state.currentPeriodEnd
                ? { graceEndsAt: state.currentPeriodEnd.toISOString() }
                : {}),
        });
    }
    if (firstGrant) {
        // Once per subscription, whichever path (webhook or return) saw it first.
        await track(userId, 'checkout_completed', { tier: planName(tier), slot, provider: 'dodo' });
        await prisma.billingCustomer.updateMany({
            where: { userId, provider: 'dodo' },
            data: { pendingCheckoutUrl: null, pendingCheckoutKey: null },
        });
    }

    return { applied: true, userId, slot, tier, status: state.status, currentPeriodEnd: state.currentPeriodEnd };
}

function reasonFor(from: string | undefined, to: string): string {
    if (to === 'canceling' || to === 'canceled') return 'downgrade';
    if (to === 'past_due') return 'failed_payment';
    if (to === 'paused') return 'paused';
    if (from === 'past_due' && to === 'active') return 'recovered';
    return 'upgrade';
}

// ---------------------------------------------------------------------------
// The webhook, minus HTTP
// ---------------------------------------------------------------------------

export type DodoWebhookEvent = {
    type: string;
    /** When the event happened (not the delivery attempt). */
    timestamp?: string;
    data?: unknown;
};

export type WebhookResult = { duplicate: boolean; outcome: string };

function isSubscriptionPayload(data: unknown): data is DodoSubscriptionPayload {
    if (!data || typeof data !== 'object') return false;
    const candidate = data as Partial<DodoSubscriptionPayload>;
    return typeof candidate.subscription_id === 'string' && typeof candidate.customer?.customer_id === 'string';
}

/**
 * Apply one verified webhook delivery, exactly once.
 *
 * `BillingEvent(provider, eventId)` is unique: the insert IS the dedupe, so a
 * double delivery (or two at once) applies once. If applying throws, the row is
 * removed again and the error propagates, so the route answers 500 and Dodo
 * retries instead of the event being lost.
 */
export async function handleDodoWebhook(eventId: string, event: DodoWebhookEvent, now: Date = new Date()): Promise<WebhookResult> {
    try {
        await prisma.billingEvent.create({ data: { provider: 'dodo', eventId, type: event.type.slice(0, 120) } });
    } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { duplicate: true, outcome: 'duplicate' };
        }
        throw error;
    }

    let outcome: string;
    try {
        outcome = await dispatch(event, now);
    } catch (error: unknown) {
        await prisma.billingEvent
            .delete({ where: { provider_eventId: { provider: 'dodo', eventId } } })
            .catch(() => undefined);
        throw error;
    }

    await prisma.billingEvent
        .update({ where: { provider_eventId: { provider: 'dodo', eventId } }, data: { outcome } })
        .catch(() => undefined);
    return { duplicate: false, outcome };
}

async function dispatch(event: DodoWebhookEvent, now: Date): Promise<string> {
    if (!SUBSCRIPTION_EVENT_SET.has(event.type)) return 'ignored:unhandled_type';
    if (!isSubscriptionPayload(event.data)) return 'ignored:no_subscription';
    const result = await applyDodoSubscription({
        sub: event.data,
        eventType: event.type,
        eventAt: parseDate(event.timestamp),
        now,
    });
    return result.applied ? 'applied' : `ignored:${result.reason}`;
}
