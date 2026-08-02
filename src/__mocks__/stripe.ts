/**
 * The Stripe mock — checkout, subscriptions, and webhook construction.
 *
 * Two things here are real rather than waved through:
 *
 *   1. **Signature verification.** `webhooks.constructEvent` computes the same
 *      HMAC the real library computes and rejects a bad signature or a stale
 *      timestamp. The webhook route's security check therefore actually runs;
 *      a mock that returned the parsed body regardless would prove nothing
 *      about the one place an attacker can reach.
 *   2. **Subscription state.** `subscriptions.update` mutates a stored object
 *      that `subscriptions.retrieve` then returns, so "cancel at period end,
 *      never an immediate cancel" is observable end to end rather than only at
 *      the call that was recorded.
 *
 * Ids are content-addressed (`shortId`), never random, so a replayed test run
 * produces byte-identical objects.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type Stripe from 'stripe';
import { shortId } from './deterministic';
import type { Recorder, StripeRecord } from './recorder';

/** The default clock for signature timestamps. Fixed, never `Date.now()`. */
export const MOCK_STRIPE_NOW_SECONDS = 1_785_000_000;

type AnyRecord = Record<string, unknown>;

/** Pinned to the SDK: Stripe accepts a string, a Buffer or a Uint8Array body. */
type ConstructEventArgs = Parameters<Stripe['webhooks']['constructEvent']>;

function decodePayload(value: string | Buffer | Uint8Array): string {
    if (typeof value === 'string') return value;
    return Buffer.from(value).toString('utf8');
}

function respond<T>(value: T): Stripe.Response<T> {
    return {
        ...(value as object),
        lastResponse: {
            headers: {},
            requestId: `req_${shortId(JSON.stringify(value))}`,
            statusCode: 200,
            apiVersion: '2025-01-01',
        },
    } as Stripe.Response<T>;
}

// ───────────────────────────────────────────────────────────── object builders

export type SeedSubscription = {
    id: string;
    customer: string;
    priceId: string;
    status?: Stripe.Subscription.Status;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: number;
    metadata?: Record<string, string>;
};

function buildSubscription(seed: SeedSubscription): Stripe.Subscription {
    return {
        id: seed.id,
        object: 'subscription',
        customer: seed.customer,
        status: seed.status ?? 'active',
        cancel_at_period_end: seed.cancelAtPeriodEnd ?? false,
        current_period_end: seed.currentPeriodEnd ?? MOCK_STRIPE_NOW_SECONDS + 30 * 86_400,
        metadata: seed.metadata ?? {},
        items: {
            object: 'list',
            has_more: false,
            url: `/v1/subscription_items?subscription=${seed.id}`,
            data: [
                {
                    id: `si_${shortId(seed.id, seed.priceId)}`,
                    object: 'subscription_item',
                    price: { id: seed.priceId, object: 'price' },
                    current_period_end: seed.currentPeriodEnd ?? MOCK_STRIPE_NOW_SECONDS + 30 * 86_400,
                },
            ],
        },
    } as unknown as Stripe.Subscription;
}

// ───────────────────────────────────────────────────────────── the mock

export class MockStripe {
    /** Subscriptions the mock knows about, by id. */
    private readonly subs = new Map<string, Stripe.Subscription>();
    private readonly sessions = new Map<string, AnyRecord>();
    private invoiceList: Stripe.Invoice[] = [];

    /** The secret `constructEvent` verifies against. */
    webhookSecret = 'whsec_mock_secret';

    constructor(private readonly recorder: Recorder) {}

    // ── recording

    private note(method: string, args: unknown[]): void {
        this.recorder.stripe.push({ method, args });
    }

    /** Every Stripe call this run. */
    get calls(): StripeRecord[] {
        return this.recorder.stripe;
    }

    callsTo(method: string): StripeRecord[] {
        return this.recorder.stripe.filter((call) => call.method === method);
    }

    // ── arrange helpers

    seedSubscription(seed: SeedSubscription): Stripe.Subscription {
        const subscription = buildSubscription(seed);
        this.subs.set(seed.id, subscription);
        return subscription;
    }

    getSubscription(id: string): Stripe.Subscription | undefined {
        return this.subs.get(id);
    }

    seedInvoices(invoices: Partial<Stripe.Invoice>[]): void {
        this.invoiceList = invoices.map(
            (invoice, index) =>
                ({
                    id: invoice.id ?? `in_${shortId('invoice', index)}`,
                    object: 'invoice',
                    ...invoice,
                }) as Stripe.Invoice,
        );
    }

    reset(): void {
        this.subs.clear();
        this.sessions.clear();
        this.invoiceList = [];
        this.webhookSecret = 'whsec_mock_secret';
        this.recorder.stripe.length = 0;
    }

    // ── webhook signing, so a test can produce a signature the route accepts

    /**
     * The `Stripe-Signature` header value for `payload`. Same scheme the real
     * library verifies: `t=<unix>,v1=<hex hmac of "t.payload">`.
     */
    signature(payload: string, atSeconds: number = MOCK_STRIPE_NOW_SECONDS, secret = this.webhookSecret): string {
        const signed = createHmac('sha256', secret).update(`${atSeconds}.${payload}`).digest('hex');
        return `t=${atSeconds},v1=${signed}`;
    }

    /** A serialized event plus a matching signature — the two things a route needs. */
    event(
        type: string,
        object: unknown,
        options: { id?: string; atSeconds?: number } = {},
    ): { payload: string; signature: string; event: Stripe.Event } {
        const at = options.atSeconds ?? MOCK_STRIPE_NOW_SECONDS;
        const event = {
            id: options.id ?? `evt_${shortId(type, JSON.stringify(object))}`,
            object: 'event',
            api_version: '2025-01-01',
            created: at,
            livemode: false,
            pending_webhooks: 0,
            request: { id: null, idempotency_key: null },
            type,
            data: { object },
        } as unknown as Stripe.Event;

        const payload = JSON.stringify(event);
        return { payload, signature: this.signature(payload, at), event };
    }

    // ── the SDK surface

    readonly customers: Pick<Stripe['customers'], 'create'> = {
        create: (async (params?: Stripe.CustomerCreateParams) => {
            this.note('customers.create', [params]);
            return respond({
                id: `cus_${shortId(params?.email ?? '', JSON.stringify(params?.metadata ?? {}))}`,
                object: 'customer',
                email: params?.email ?? null,
                metadata: params?.metadata ?? {},
            } as unknown as Stripe.Customer);
        }),
    };

    readonly checkout: {
        sessions: Pick<Stripe['checkout']['sessions'], 'create' | 'retrieve'>;
    } = {
        sessions: {
            create: (async (params?: Stripe.Checkout.SessionCreateParams) => {
                this.note('checkout.sessions.create', [params]);
                const id = `cs_${shortId(JSON.stringify(params ?? {}))}`;
                const priceId = params?.line_items?.[0]?.price ?? null;
                const session = {
                    id,
                    object: 'checkout.session',
                    url: `https://checkout.stripe.test/${id}`,
                    mode: params?.mode ?? 'subscription',
                    customer: params?.customer ?? null,
                    client_reference_id: params?.client_reference_id ?? null,
                    metadata: params?.metadata ?? {},
                    // A completed session points at a subscription; tests that
                    // exercise the return-from-checkout path retrieve it.
                    subscription: `sub_${shortId(id)}`,
                    payment_status: 'paid',
                    status: 'complete',
                    line_items: { object: 'list', data: [{ price: { id: priceId } }] },
                };
                this.sessions.set(id, session);
                if (typeof priceId === 'string') {
                    this.seedSubscription({
                        id: session.subscription,
                        customer: String(params?.customer ?? 'cus_mock'),
                        priceId,
                        metadata: (params?.metadata as Record<string, string>) ?? {},
                    });
                }
                return respond(session as unknown as Stripe.Checkout.Session);
            }),

            retrieve: (async (id: string) => {
                this.note('checkout.sessions.retrieve', [id]);
                const session = this.sessions.get(id);
                if (!session) throw new Error(`No such checkout.session: ${id}`);
                return respond(session as unknown as Stripe.Checkout.Session);
            }),
        },
    };

    readonly billingPortal: {
        sessions: Pick<Stripe['billingPortal']['sessions'], 'create'>;
    } = {
        sessions: {
            create: (async (params?: Stripe.BillingPortal.SessionCreateParams) => {
                this.note('billingPortal.sessions.create', [params]);
                const id = `bps_${shortId(JSON.stringify(params ?? {}))}`;
                return respond({
                    id,
                    object: 'billing_portal.session',
                    url: `https://portal.stripe.test/${id}`,
                    customer: params?.customer ?? '',
                    return_url: params?.return_url ?? null,
                } as unknown as Stripe.BillingPortal.Session);
            }),
        },
    };

    readonly subscriptions: Pick<Stripe['subscriptions'], 'retrieve' | 'update' | 'cancel'> = {
        retrieve: (async (id: string) => {
            this.note('subscriptions.retrieve', [id]);
            const existing = this.subs.get(id);
            if (!existing) throw new Error(`No such subscription: ${id}`);
            return respond(existing);
        }),

        update: (async (id: string, params?: Stripe.SubscriptionUpdateParams) => {
            this.note('subscriptions.update', [id, params]);
            const existing =
                this.subs.get(id) ??
                this.seedSubscription({ id, customer: 'cus_mock', priceId: 'price_mock' });
            const updated = {
                ...existing,
                ...(params?.cancel_at_period_end === undefined
                    ? {}
                    : { cancel_at_period_end: params.cancel_at_period_end }),
                ...(params?.metadata
                    ? { metadata: { ...existing.metadata, ...(params.metadata as Record<string, string>) } }
                    : {}),
            } as Stripe.Subscription;
            this.subs.set(id, updated);
            return respond(updated);
        }),

        cancel: (async (id: string) => {
            this.note('subscriptions.cancel', [id]);
            const existing =
                this.subs.get(id) ??
                this.seedSubscription({ id, customer: 'cus_mock', priceId: 'price_mock' });
            const canceled = { ...existing, status: 'canceled' } as Stripe.Subscription;
            this.subs.set(id, canceled);
            return respond(canceled);
        }),
    };

    readonly invoices: Pick<Stripe['invoices'], 'list'> = {
        list: ((params?: Stripe.InvoiceListParams) => {
            this.note('invoices.list', [params]);
            const page = {
                object: 'list',
                has_more: false,
                url: '/v1/invoices',
                data: this.invoiceList,
            };
            return Promise.resolve(respond(page)) as unknown as ReturnType<Stripe['invoices']['list']>;
        }),
    };

    readonly refunds: Pick<Stripe['refunds'], 'create'> = {
        create: (async (params?: Stripe.RefundCreateParams) => {
            this.note('refunds.create', [params]);
            return respond({
                id: `re_${shortId(JSON.stringify(params ?? {}))}`,
                object: 'refund',
                payment_intent: params?.payment_intent ?? null,
                status: 'succeeded',
            } as unknown as Stripe.Refund);
        }),
    };

    readonly webhooks: Pick<Stripe['webhooks'], 'constructEvent'> = {
        constructEvent: (
            payload: ConstructEventArgs[0],
            header: ConstructEventArgs[1],
            secret: string,
            tolerance?: number,
            cryptoProvider?: ConstructEventArgs[4],
            receivedAt?: number,
        ): Stripe.Event => {
            void cryptoProvider;
            this.note('webhooks.constructEvent', [secret]);

            const body = decodePayload(payload);
            const headerValue = Array.isArray(header)
                ? header.join(',')
                : typeof header === 'string'
                  ? header
                  : decodePayload(header);

            const parts = new Map<string, string[]>();
            for (const entry of headerValue.split(',')) {
                const [key, value] = entry.split('=');
                if (!key || !value) continue;
                parts.set(key.trim(), [...(parts.get(key.trim()) ?? []), value.trim()]);
            }

            const timestamp = Number(parts.get('t')?.[0]);
            if (!Number.isFinite(timestamp)) {
                throw new Error('Unable to extract timestamp and signatures from header');
            }

            const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
            const expectedBuffer = Buffer.from(expected);
            const provided = parts.get('v1') ?? [];
            const ok = provided.some((candidate) => {
                const buffer = Buffer.from(candidate);
                return buffer.length === expectedBuffer.length && timingSafeEqual(buffer, expectedBuffer);
            });
            if (!ok) {
                throw new Error('No signatures found matching the expected signature for payload');
            }

            // Replay window, same as the real library's default of 300s.
            if (tolerance && tolerance > 0) {
                const now = receivedAt ?? MOCK_STRIPE_NOW_SECONDS;
                if (Math.abs(now - timestamp) > tolerance) {
                    throw new Error('Timestamp outside the tolerance zone');
                }
            }

            return JSON.parse(body) as Stripe.Event;
        },
    };

    /** The single cast in the billing path. */
    asStripe(): Stripe {
        return this as unknown as Stripe;
    }
}
