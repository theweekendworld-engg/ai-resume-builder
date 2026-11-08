/**
 * The Dodo webhook against the live Postgres, with deliveries signed by the
 * real `standardwebhooks` library (docs/impl/09-payments-dodo.md §3).
 *
 * What is proven here: the signature gate, exactly-once application on
 * `webhook-id`, every event in the state table landing on the right row, user
 * resolution by stored customer id and by metadata, unknown events and
 * products ignored, and late events never overwriting newer state.
 *
 * What is NOT: that Dodo sends exactly this payload. The bodies are built from
 * the SDK's types (`dodopayments` 2.61.1), not captured from a live delivery.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { Tier } from '@prisma/client';
import { MOCK_DODO_WEBHOOK_KEY, MockDodo } from '@/__mocks__/dodo';
import { getSubscriptionState } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/dodo/webhook/route';

const RUN = `itest-dodo-wh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const CAREER = `pdt_career_${RUN}`;
const SEARCH = `pdt_search_${RUN}`;
const DAY = 86_400_000;

const ENV_KEYS = ['DODO_PAYMENTS_WEBHOOK_KEY', 'DODO_PRODUCT_CAREER', 'DODO_PRODUCT_SEARCH'] as const;
const before: Record<string, string | undefined> = {};

const dodo = new MockDodo(() => new Date());
let deliveries = 0;

beforeAll(() => {
    for (const key of ENV_KEYS) before[key] = process.env[key];
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = MOCK_DODO_WEBHOOK_KEY;
    process.env.DODO_PRODUCT_CAREER = CAREER;
    process.env.DODO_PRODUCT_SEARCH = SEARCH;
});

afterAll(async () => {
    for (const key of ENV_KEYS) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
    }
    const like = { startsWith: RUN };
    await prisma.subscription.deleteMany({ where: { userId: like } });
    await prisma.billingCustomer.deleteMany({ where: { userId: like } });
    await prisma.funnelEvent.deleteMany({ where: { userId: like } });
    await prisma.billingEvent.deleteMany({ where: { eventId: like } });
});

// ---------------------------------------------------------------------------

function userId(label: string): string {
    return `${RUN}-${label}`;
}

function future(days: number): Date {
    return new Date(Date.now() + days * DAY);
}

async function customerFor(label: string): Promise<{ userId: string; customerId: string }> {
    const id = userId(label);
    const customerId = `cus_${label}_${RUN}`;
    await prisma.billingCustomer.create({ data: { userId: id, provider: 'dodo', customerRef: customerId } });
    return { userId: id, customerId };
}

type Payload = ReturnType<MockDodo['seedSubscription']> & { past_due_ends_at?: string | null };

async function deliver(
    type: string,
    data: unknown,
    options: { id?: string; timestamp?: Date; secret?: string; signedAt?: Date } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
    deliveries += 1;
    const { body, headers } = dodo.signedDelivery(
        { type, data, timestamp: (options.timestamp ?? new Date()).toISOString() },
        { id: options.id ?? `${RUN}-evt-${deliveries}`, secret: options.secret, signedAt: options.signedAt },
    );
    const response = await POST(new NextRequest('https://patronus.test/api/dodo/webhook', { method: 'POST', headers, body }));
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function row(id: string, slot: 'career' | 'search' = 'career') {
    return prisma.subscription.findUnique({ where: { userId_slot: { userId: id, slot } } });
}

async function events(id: string, type: string) {
    return prisma.funnelEvent.findMany({ where: { userId: id, type }, orderBy: { occurredAt: 'asc' } });
}

// ---------------------------------------------------------------------------

describe('the signature gate', () => {
    test('without a webhook key the route refuses everything (503)', async () => {
        delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;
        try {
            const result = await deliver('subscription.active', {});
            expect(result.status).toBe(503);
        } finally {
            process.env.DODO_PAYMENTS_WEBHOOK_KEY = MOCK_DODO_WEBHOOK_KEY;
        }
    });

    test('missing signature headers are a 400', async () => {
        const response = await POST(
            new NextRequest('https://patronus.test/api/dodo/webhook', { method: 'POST', body: '{"type":"subscription.active"}' }),
        );
        expect(response.status).toBe(400);
    });

    test('a body signed with another key is rejected and writes nothing', async () => {
        const { userId: id, customerId } = await customerFor('forged');
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        const forgedKey = `whsec_${Buffer.from('somebody-elses-key-0123456789abcd').toString('base64')}`;
        const result = await deliver('subscription.active', sub, { secret: forgedKey });
        expect(result.status).toBe(400);
        expect(await row(id)).toBeNull();
    });

    test('a correctly signed delivery replayed after the five-minute window is rejected', async () => {
        const { userId: id, customerId } = await customerFor('replayed-late');
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        const result = await deliver('subscription.active', sub, { signedAt: new Date(Date.now() - 10 * 60_000) });
        expect(result.status).toBe(400);
        expect(await row(id)).toBeNull();
    });
});

describe('activation, and exactly once', () => {
    test('subscription.active grants Career, resolved through the stored Dodo customer', async () => {
        const { userId: id, customerId } = await customerFor('active');
        const renews = future(30);
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: renews });

        const result = await deliver('subscription.active', sub, { id: `${RUN}-active-1` });
        expect(result).toEqual({ status: 200, json: { received: true, duplicate: false, outcome: 'applied' } });

        expect(await row(id)).toMatchObject({
            provider: 'dodo',
            slot: 'career',
            tier: Tier.always_on,
            status: 'active',
            customerRef: customerId,
            subscriptionRef: sub.subscription_id,
            currentPeriodEnd: new Date(sub.next_billing_date),
        });
        const state = await getSubscriptionState(id);
        expect(state.tier).toBe(Tier.always_on);
        expect(state.career?.provider).toBe('dodo');

        expect(await events(id, 'checkout_completed')).toHaveLength(1);
        const [changed] = await events(id, 'plan_changed');
        expect(changed.payload).toMatchObject({ slot: 'career', to: 'Career', status: 'active', provider: 'dodo' });
    });

    test('the same webhook-id delivered twice applies once', async () => {
        const { userId: id, customerId } = await customerFor('replay');
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });

        const first = await deliver('subscription.active', sub, { id: `${RUN}-replay-1` });
        const second = await deliver('subscription.active', sub, { id: `${RUN}-replay-1` });
        expect(first.json.duplicate).toBe(false);
        expect(second).toEqual({ status: 200, json: { received: true, duplicate: true, outcome: 'duplicate' } });

        expect(await prisma.billingEvent.count({ where: { eventId: `${RUN}-replay-1` } })).toBe(1);
        expect(await events(id, 'checkout_completed')).toHaveLength(1);
        expect(await events(id, 'plan_changed')).toHaveLength(1);
    });

    test('with no stored customer, the userId in the subscription metadata attributes it', async () => {
        const id = userId('by-metadata');
        const sub = dodo.seedSubscription({
            customerId: `cus_unknown_${RUN}`,
            productId: CAREER,
            nextBillingDate: future(30),
            metadata: { userId: id, slot: 'career', priceKey: 'career_monthly' },
        });
        const result = await deliver('subscription.active', sub);
        expect(result.json.outcome).toBe('applied');
        expect((await row(id))?.status).toBe('active');
    });

    test('a subscription nobody can be found for is acknowledged and ignored', async () => {
        const sub = dodo.seedSubscription({ customerId: `cus_stranger_${RUN}`, productId: CAREER, nextBillingDate: future(30) });
        const result = await deliver('subscription.active', sub);
        expect(result).toMatchObject({ status: 200, json: { outcome: 'ignored:no_user' } });
        expect(await prisma.subscription.count({ where: { subscriptionRef: sub.subscription_id } })).toBe(0);
    });

    test('an unknown event type is acknowledged and ignored', async () => {
        const { userId: id, customerId } = await customerFor('payment-only');
        const result = await deliver('payment.succeeded', { payment_id: 'pay_x', customer: { customer_id: customerId } });
        expect(result).toMatchObject({ status: 200, json: { outcome: 'ignored:unhandled_type' } });
        expect(await row(id)).toBeNull();
    });

    test('a product that is not mapped to a plan never grants a tier', async () => {
        const { userId: id, customerId } = await customerFor('unknown-product');
        const sub = dodo.seedSubscription({ customerId, productId: 'pdt_nobody_mapped', nextBillingDate: future(30) });
        const result = await deliver('subscription.active', sub);
        expect(result.json.outcome).toBe('ignored:unknown_product');
        expect(await row(id)).toBeNull();
    });

    test('the Search product lands in the Search slot', async () => {
        const { userId: id, customerId } = await customerFor('search');
        const sub = dodo.seedSubscription({ customerId, productId: SEARCH, nextBillingDate: future(30) });
        await deliver('subscription.active', sub);
        expect(await row(id, 'search')).toMatchObject({ tier: Tier.pro, status: 'active', provider: 'dodo' });
        expect(await row(id, 'career')).toBeNull();
    });

    test('a paid purchase replaces an admin comp in the same slot', async () => {
        const { userId: id, customerId } = await customerFor('comped');
        await prisma.subscription.create({
            data: { userId: id, slot: 'career', provider: 'admin_grant', customerRef: `admin_grant:${id}`, tier: Tier.always_on, status: 'active' },
        });
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        await deliver('subscription.active', sub);
        expect(await row(id)).toMatchObject({ provider: 'dodo', subscriptionRef: sub.subscription_id, customerRef: customerId });
    });
});

describe('the life of one subscription', () => {
    test('each event moves the row through the state table', async () => {
        const { userId: id, customerId } = await customerFor('lifecycle');
        const firstEnd = future(30);
        const base = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: firstEnd });
        let at = Date.now() - 60_000;
        const send = (type: string, patch: Partial<Payload>) => {
            at += 1_000;
            return deliver(type, { ...base, ...patch }, { timestamp: new Date(at) });
        };

        await send('subscription.active', {});
        expect((await row(id))?.status).toBe('active');

        // Cancel at period end: still access, ends on the billing date.
        await send('subscription.updated', { cancel_at_next_billing_date: true });
        expect(await row(id)).toMatchObject({ status: 'canceling', currentPeriodEnd: firstEnd });
        expect((await getSubscriptionState(id)).career?.cancelAtPeriodEnd).toBe(true);

        // Turned back on, then renewed: access extends to the new date.
        await send('subscription.updated', { cancel_at_next_billing_date: false });
        const secondEnd = future(60);
        await send('subscription.renewed', { next_billing_date: secondEnd.toISOString() });
        expect(await row(id)).toMatchObject({ status: 'active', currentPeriodEnd: secondEnd });

        // Renewal fails: past_due until Dodo's deadline, access kept.
        const deadline = future(5);
        await send('subscription.past_due', { status: 'past_due', past_due_ends_at: deadline.toISOString() });
        expect(await row(id)).toMatchObject({ status: 'past_due', currentPeriodEnd: deadline });
        expect((await getSubscriptionState(id)).career?.active).toBe(true);

        // on_hold after it: the grace already parked is not extended.
        await send('subscription.on_hold', { status: 'on_hold', past_due_ends_at: null });
        expect(await row(id)).toMatchObject({ status: 'past_due', currentPeriodEnd: deadline });

        // Card fixed.
        await send('subscription.active', { next_billing_date: secondEnd.toISOString() });
        expect(await row(id)).toMatchObject({ status: 'active', currentPeriodEnd: secondEnd });
        const recovered = (await events(id, 'plan_changed')).map((e) => (e.payload as { reason: string }).reason);
        expect(recovered).toContain('recovered');
        expect(recovered).toContain('failed_payment');

        // Paused: no access. Unpaused: back.
        await send('subscription.paused', { status: 'paused' });
        expect((await getSubscriptionState(id)).career?.active).toBe(false);
        await send('subscription.unpaused', { status: 'active', next_billing_date: secondEnd.toISOString() });
        expect((await getSubscriptionState(id)).career?.active).toBe(true);

        // Cancelled immediately: no access, and the row (history) stays.
        await send('subscription.cancelled', { status: 'cancelled', cancelled_at: new Date().toISOString() });
        expect((await row(id))?.status).toBe('canceled');
        const state = await getSubscriptionState(id);
        expect(state.tier).toBe(Tier.free);
        expect(state.career).not.toBeNull();
        // Counted once for the subscription, not again on recovery or unpause.
        expect(await events(id, 'checkout_completed')).toHaveLength(1);
    });

    test.each([
        ['subscription.failed', 'failed'],
        ['subscription.expired', 'expired'],
    ] as const)('%s ends access', async (type, status) => {
        const { userId: id, customerId } = await customerFor(`terminal-${status}`);
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        await deliver('subscription.active', sub, { timestamp: new Date(Date.now() - 5_000) });
        await deliver(type, { ...sub, status });
        expect((await row(id))?.status).toBe('canceled');
        expect((await getSubscriptionState(id)).tier).toBe(Tier.free);
    });

    test('cancelled with the period still ahead keeps access until the period end', async () => {
        const { userId: id, customerId } = await customerFor('cancel-at-end');
        const end = future(20);
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: end });
        await deliver('subscription.active', sub, { timestamp: new Date(Date.now() - 5_000) });
        await deliver('subscription.cancelled', { ...sub, status: 'cancelled', cancel_at_next_billing_date: true });
        expect(await row(id)).toMatchObject({ status: 'canceling', currentPeriodEnd: end });
        expect((await getSubscriptionState(id)).career?.active).toBe(true);
    });

    test('an event older than the one that wrote the row is ignored', async () => {
        const { userId: id, customerId } = await customerFor('out-of-order');
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        await deliver('subscription.cancelled', { ...sub, status: 'cancelled' }, { timestamp: new Date(Date.now() - 1_000) });
        // The activation from a minute earlier arrives late (a retried delivery).
        const late = await deliver('subscription.active', sub, { timestamp: new Date(Date.now() - 60_000) });
        expect(late.json.outcome).toBe('ignored:stale');
        expect((await row(id))?.status).toBe('canceled');
    });

    test('a late event for an old subscription does not end the one that replaced it', async () => {
        const { userId: id, customerId } = await customerFor('superseded');
        const old = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(1) });
        const replacement = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        await deliver('subscription.active', old, { timestamp: new Date(Date.now() - 120_000) });
        await deliver('subscription.active', replacement, { timestamp: new Date(Date.now() - 60_000) });
        const late = await deliver('subscription.expired', { ...old, status: 'expired' });
        expect(late.json.outcome).toBe('ignored:superseded');
        expect(await row(id)).toMatchObject({ subscriptionRef: replacement.subscription_id, status: 'active' });
    });
});

describe('a failure while applying', () => {
    test('answers 500 and forgets the delivery, so the retry applies it', async () => {
        const { userId: id, customerId } = await customerFor('retry');
        const sub = dodo.seedSubscription({ customerId, productId: CAREER, nextBillingDate: future(30) });
        // Postgres rejects a NUL byte in text, so resolving this customer throws.
        const broken = { ...sub, customer: { ...sub.customer, customer_id: 'cus_\u0000broken' } };

        const failed = await deliver('subscription.active', broken, { id: `${RUN}-retry-1` });
        expect(failed.status).toBe(500);
        expect(await prisma.billingEvent.count({ where: { eventId: `${RUN}-retry-1` } })).toBe(0);

        const retried = await deliver('subscription.active', sub, { id: `${RUN}-retry-1` });
        expect(retried.json).toMatchObject({ duplicate: false, outcome: 'applied' });
        expect((await row(id))?.status).toBe('active');
    });
});
