/**
 * The Dodo Payments double — customers, checkout, subscriptions, payments,
 * refunds, and signed webhook deliveries.
 *
 * Implements `DodoClient` (the slice of the SDK the app calls, `src/lib/dodo.ts`)
 * with no cast, so an SDK change to any of those signatures breaks this file
 * as well as the app. Not part of `installMocks`: inject it with
 * `__setDodoClientForTests(new MockDodo())`.
 *
 * Two things are real rather than waved through:
 *   1. **Webhook signatures.** {@link MockDodo.signedDelivery} signs with the
 *      `standardwebhooks` library the route verifies with, so the route's
 *      security check actually runs.
 *   2. **Subscription state.** `subscriptions.update` mutates the stored
 *      object that `subscriptions.retrieve` returns, so "cancel at period end,
 *      never immediately" is observable end to end.
 *
 * Ids are content-addressed (`shortId`), never random. Dates come from the
 * clock passed in, because the code under test compares them with the real
 * time; signing uses the real clock because the verifier allows five minutes.
 *
 * Shapes are built from the SDK's types and checked once against the live
 * TEST API on 2026-11-08 (checkout session, customer, portal link, product);
 * subscription and payment objects have NOT been seen from the live API yet.
 */

import type DodoPayments from 'dodopayments';
import { Webhook } from 'standardwebhooks';
import type { DodoClient } from '@/lib/dodo';
import { shortId } from './deterministic';

type Subscription = DodoPayments.Subscription;
type Payment = DodoPayments.Payment;
type PaymentListResponse = DodoPayments.PaymentListResponse;
type Customer = DodoPayments.Customer;
type Refund = DodoPayments.Refund;

export type DodoCall = { method: string; args: unknown[] };

/** A valid Standard Webhooks secret (`whsec_` + base64). */
export const MOCK_DODO_WEBHOOK_KEY = `whsec_${Buffer.from('patronus-dodo-mock-webhook-key-32b').toString('base64')}`;

export type SeedDodoSubscription = {
    id?: string;
    customerId: string;
    productId: string;
    status?: DodoPayments.SubscriptionStatus;
    nextBillingDate: Date;
    cancelAtNextBillingDate?: boolean;
    metadata?: Record<string, string>;
};

const ADDRESS = { country: 'IN' as const, city: null, state: null, street: null, zipcode: null };

export class MockDodo implements DodoClient {
    readonly calls: DodoCall[] = [];
    private readonly customersById = new Map<string, Customer>();
    private readonly sessions = new Map<string, { productId: string; customerId: string; metadata: Record<string, string | number | boolean>; paymentId: string | null }>();
    private readonly subs = new Map<string, Subscription>();
    private readonly paymentsById = new Map<string, Payment>();
    private readonly failures = new Map<string, Error>();
    private counter = 0;

    constructor(private readonly clock: () => Date = () => new Date('2026-11-08T00:00:00Z')) {}

    // ── arrange / inspect

    callsTo(method: string): DodoCall[] {
        return this.calls.filter((call) => call.method === method);
    }

    /** The next call to `method` throws `error` (once). */
    failNext(method: string, error: Error = new Error('mock dodo failure')): void {
        this.failures.set(method, error);
    }

    private note(method: string, args: unknown[]): void {
        this.calls.push({ method, args });
        const failure = this.failures.get(method);
        if (failure) {
            this.failures.delete(method);
            throw failure;
        }
    }

    private nextId(prefix: string, ...parts: unknown[]): string {
        this.counter += 1;
        return `${prefix}_${shortId(prefix, this.counter, ...parts)}`;
    }

    customer(id: string, email = `${id}@example.test`): Customer {
        return { business_id: 'bus_mock', created_at: this.clock().toISOString(), customer_id: id, email, name: email.split('@')[0], metadata: {} };
    }

    seedSubscription(seed: SeedDodoSubscription): Subscription {
        const now = this.clock().toISOString();
        const id = seed.id ?? this.nextId('sub', seed.customerId, seed.productId);
        const known = this.customersById.get(seed.customerId) ?? this.customer(seed.customerId);
        const subscription: Subscription = {
            addons: [],
            billing: ADDRESS,
            brand_id: 'bnd_mock',
            cancel_at_next_billing_date: seed.cancelAtNextBillingDate ?? false,
            created_at: now,
            credit_entitlement_cart: [],
            currency: 'USD',
            customer: { customer_id: known.customer_id, email: known.email, name: known.name, metadata: known.metadata },
            has_payment_method: true,
            metadata: seed.metadata ?? {},
            meter_credit_entitlement_cart: [],
            meters: [],
            next_billing_date: seed.nextBillingDate.toISOString(),
            on_demand: false,
            payment_frequency_count: 1,
            payment_frequency_interval: 'Month',
            previous_billing_date: now,
            product_id: seed.productId,
            quantity: 1,
            recurring_pre_tax_amount: 100,
            status: seed.status ?? 'active',
            subscription_id: id,
            subscription_period_count: 20,
            subscription_period_interval: 'Year',
            tax_inclusive: false,
            trial_period_days: 0,
        };
        this.subs.set(id, subscription);
        return subscription;
    }

    getSubscription(id: string): Subscription | undefined {
        return this.subs.get(id);
    }

    /**
     * The customer pays: the session gets a payment and a live subscription,
     * the way Dodo's hosted checkout leaves them.
     */
    completeCheckout(sessionId: string, nextBillingDate: Date): { subscription: Subscription; payment: Payment } {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`mock dodo: no session ${sessionId}`);
        const subscription = this.seedSubscription({
            customerId: session.customerId,
            productId: session.productId,
            nextBillingDate,
        });
        const payment = this.buildPayment(subscription, sessionId);
        session.paymentId = payment.payment_id;
        return { subscription, payment };
    }

    private buildPayment(subscription: Subscription, sessionId: string | null): Payment {
        const payment: Payment = {
            billing: ADDRESS,
            brand_id: 'bnd_mock',
            business_id: 'bus_mock',
            created_at: this.clock().toISOString(),
            currency: 'USD',
            customer: subscription.customer,
            digital_products_delivered: false,
            disputes: [],
            includes_usage: false,
            is_multi_subscription: false,
            is_update_payment_method: false,
            metadata: {},
            payment_id: this.nextId('pay', subscription.subscription_id),
            payment_provider: 'dodo',
            refunds: [],
            retry_attempt: 0,
            service_periods: [],
            settlement_amount: 100,
            settlement_currency: 'USD',
            subscription_ids: [subscription.subscription_id],
            total_amount: 100,
            checkout_session_id: sessionId,
            status: 'succeeded',
            subscription_id: subscription.subscription_id,
        };
        this.paymentsById.set(payment.payment_id, payment);
        return payment;
    }

    /** A payment on an existing subscription (a renewal), for refund tests. */
    seedPayment(subscriptionId: string): Payment {
        const subscription = this.subs.get(subscriptionId);
        if (!subscription) throw new Error(`mock dodo: no subscription ${subscriptionId}`);
        return this.buildPayment(subscription, null);
    }

    // ── webhook deliveries

    /**
     * A signed delivery the route will accept: the JSON body and the three
     * Standard Webhooks headers. `secret` lets a test sign with the wrong key.
     */
    signedDelivery(
        event: { type: string; data: unknown; timestamp?: string },
        options: { id?: string; secret?: string; signedAt?: Date } = {},
    ): { body: string; headers: Record<string, string> } {
        const body = JSON.stringify({
            business_id: 'bus_mock',
            type: event.type,
            timestamp: event.timestamp ?? this.clock().toISOString(),
            data: event.data,
        });
        const id = options.id ?? `msg_${shortId(body)}`;
        const signedAt = options.signedAt ?? new Date();
        const signature = new Webhook(options.secret ?? MOCK_DODO_WEBHOOK_KEY).sign(id, signedAt, body);
        return {
            body,
            headers: {
                'content-type': 'application/json',
                'webhook-id': id,
                'webhook-timestamp': String(Math.floor(signedAt.getTime() / 1000)),
                'webhook-signature': signature,
            },
        };
    }

    // ── the DodoClient surface

    customers: DodoClient['customers'] = {
        create: async (body) => {
            this.note('customers.create', [body]);
            const customer: Customer = {
                ...this.customer(this.nextId('cus', body.email), body.email),
                name: body.name,
                metadata: body.metadata ?? {},
            };
            this.customersById.set(customer.customer_id, customer);
            return customer;
        },
        customerPortal: {
            create: async (customerId, params) => {
                this.note('customers.customerPortal.create', [customerId, params]);
                return { link: `https://test.customer.dodopayments.com/session/${shortId('portal', customerId)}` };
            },
        },
    };

    checkoutSessions: DodoClient['checkoutSessions'] = {
        create: async (body) => {
            this.note('checkoutSessions.create', [body]);
            const customer = body.customer && 'customer_id' in body.customer ? body.customer.customer_id : 'cus_anonymous';
            const productId = body.product_cart[0]?.product_id ?? 'pdt_none';
            const sessionId = this.nextId('cks', customer, productId);
            this.sessions.set(sessionId, { productId, customerId: customer, metadata: body.metadata ?? {}, paymentId: null });
            return { session_id: sessionId, checkout_url: `https://test.checkout.dodopayments.com/session/${sessionId}` };
        },
        retrieve: async (id) => {
            this.note('checkoutSessions.retrieve', [id]);
            const session = this.sessions.get(id);
            const payment = session?.paymentId ? this.paymentsById.get(session.paymentId) : undefined;
            return {
                id,
                created_at: this.clock().toISOString(),
                payment_id: session?.paymentId ?? null,
                payment_status: payment?.status ?? null,
            };
        },
    };

    subscriptions: DodoClient['subscriptions'] = {
        retrieve: async (id) => {
            this.note('subscriptions.retrieve', [id]);
            const subscription = this.subs.get(id);
            if (!subscription) throw Object.assign(new Error('404 The requested resource could not be found.'), { status: 404 });
            return subscription;
        },
        update: async (id, body) => {
            this.note('subscriptions.update', [id, body]);
            const subscription = this.subs.get(id);
            if (!subscription) throw Object.assign(new Error('404 The requested resource could not be found.'), { status: 404 });
            const next: Subscription = {
                ...subscription,
                ...(typeof body.cancel_at_next_billing_date === 'boolean'
                    ? { cancel_at_next_billing_date: body.cancel_at_next_billing_date }
                    : {}),
                ...(body.status ? { status: body.status, cancelled_at: body.status === 'cancelled' ? this.clock().toISOString() : null } : {}),
            };
            this.subs.set(id, next);
            return next;
        },
    };

    payments: DodoClient['payments'] = {
        retrieve: async (id) => {
            this.note('payments.retrieve', [id]);
            const payment = this.paymentsById.get(id);
            if (!payment) throw Object.assign(new Error('404 The requested resource could not be found.'), { status: 404 });
            return payment;
        },
        list: async (params) => {
            this.note('payments.list', [params]);
            const items: PaymentListResponse[] = [...this.paymentsById.values()]
                .filter((payment) => !params.subscription_id || payment.subscription_ids.includes(params.subscription_id))
                .filter((payment) => !params.status || payment.status === params.status)
                .map((payment) => ({
                    brand_id: payment.brand_id,
                    created_at: payment.created_at,
                    currency: payment.currency,
                    customer: payment.customer,
                    digital_products_delivered: payment.digital_products_delivered,
                    has_license_key: false,
                    includes_usage: payment.includes_usage,
                    is_multi_subscription: payment.is_multi_subscription,
                    metadata: payment.metadata,
                    payment_id: payment.payment_id,
                    payment_provider: payment.payment_provider,
                    retry_attempt: payment.retry_attempt,
                    service_periods: payment.service_periods,
                    subscription_ids: payment.subscription_ids,
                    total_amount: payment.total_amount,
                    status: payment.status,
                    subscription_id: payment.subscription_id,
                }));
            return { items };
        },
    };

    refunds: DodoClient['refunds'] = {
        create: async (body) => {
            this.note('refunds.create', [body]);
            const payment = this.paymentsById.get(body.payment_id);
            if (!payment) throw Object.assign(new Error('404 The requested resource could not be found.'), { status: 404 });
            const refund: Refund = {
                brand_id: payment.brand_id,
                business_id: payment.business_id,
                created_at: this.clock().toISOString(),
                customer: payment.customer,
                is_partial: false,
                metadata: body.metadata ?? {},
                payment_id: payment.payment_id,
                refund_id: this.nextId('ref', payment.payment_id),
                status: 'succeeded',
                amount: payment.total_amount,
                currency: payment.currency,
                reason: body.reason ?? null,
            };
            return refund;
        },
    };
}
