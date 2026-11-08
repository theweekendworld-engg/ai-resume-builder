/**
 * Billing actions with Dodo Payments as the provider — live Postgres, Dodo
 * replaced at the client seam by `MockDodo` (docs/impl/09-payments-dodo.md).
 *
 * The claims: checkout sends a product id (never an amount) with the user's
 * own Dodo customer, stored before any payment; the launch keeps checkout to
 * admins; cancelling is at period end; the portal is Dodo's; the return
 * redirect grants only what Dodo's API confirms for this user.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Tier } from '@prisma/client';
import { installClerkMock } from '@/__mocks__/clerk';
import { MOCK_DODO_WEBHOOK_KEY, MockDodo } from '@/__mocks__/dodo';
import { refundDodoSubscription } from '@/lib/billing/dodoBilling';
import { config } from '@/lib/config';
import { __setDodoClientForTests } from '@/lib/dodo';
import { getSubscriptionState } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';

const clerk = installClerkMock();
const billing = await import('@/actions/billing');

const RUN = `itest-dodo-bill-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const CAREER = `pdt_career_${RUN}`;
const SEARCH = `pdt_search_${RUN}`;
const ADMIN = `${RUN}-admin`;
const DAY = 86_400_000;

const ENV: Record<string, string> = {
    DODO_PAYMENTS_API_KEY: 'dodo_test_not_a_real_key',
    // Built at runtime: a literal whsec_… string trips GitHub secret scanning.
    DODO_PAYMENTS_WEBHOOK_KEY: MOCK_DODO_WEBHOOK_KEY,
    DODO_PRODUCT_CAREER: CAREER,
    DODO_PRODUCT_SEARCH: SEARCH,
    ADMIN_USER_IDS: ADMIN,
    ENTITLEMENT_LAUNCH_OPEN: 'false',
};
const BLANK = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_CAREER_MONTHLY', 'DODO_PAYMENTS_ENVIRONMENT', 'DODO_PAYMENT_TEST_API_KEY'];
const before: Record<string, string | undefined> = {};

let dodo = new MockDodo(() => new Date());

beforeAll(() => {
    for (const key of [...Object.keys(ENV), ...BLANK]) before[key] = process.env[key];
    for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
    for (const key of BLANK) delete process.env[key];
    __setDodoClientForTests(dodo);
});

afterEach(() => {
    dodo = new MockDodo(() => new Date());
    __setDodoClientForTests(dodo);
    process.env.ENTITLEMENT_LAUNCH_OPEN = 'false';
});

afterAll(async () => {
    __setDodoClientForTests(null);
    for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    clerk.signOut();
    const like = { startsWith: RUN };
    await prisma.subscription.deleteMany({ where: { userId: like } });
    await prisma.billingCustomer.deleteMany({ where: { userId: like } });
    await prisma.funnelEvent.deleteMany({ where: { userId: like } });
});

function signIn(label: string): string {
    return clerk.signIn(label === 'admin' ? ADMIN : `${RUN}-${label}`);
}

function future(days: number): Date {
    return new Date(Date.now() + days * DAY);
}

/** A Dodo-billed row, as the webhook would have written it. */
async function seedDodo(userId: string, slot: 'career' | 'search', status = 'active') {
    const customer = await prisma.billingCustomer.upsert({
        where: { userId_provider: { userId, provider: 'dodo' } },
        create: { userId, provider: 'dodo', customerRef: `cus_${slot}_${userId}` },
        update: {},
    });
    const sub = dodo.seedSubscription({
        customerId: customer.customerRef,
        productId: slot === 'search' ? SEARCH : CAREER,
        nextBillingDate: future(30),
    });
    await prisma.subscription.create({
        data: {
            userId,
            slot,
            provider: 'dodo',
            customerRef: customer.customerRef,
            subscriptionRef: sub.subscription_id,
            tier: slot === 'search' ? Tier.pro : Tier.always_on,
            status,
            currentPeriodEnd: new Date(sub.next_billing_date),
        },
    });
    return sub;
}

// ---------------------------------------------------------------------------

describe('checkout through Dodo', () => {
    test('creates the Dodo customer first, then a session for the product, with metadata and the return URL', async () => {
        const userId = signIn('checkout');
        const result = await billing.startCheckout('career_monthly', { paywallCode: 'PW1' });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.url).toStartWith('https://test.checkout.dodopayments.com/session/');

        const [customerCall] = dodo.callsTo('customers.create');
        expect(customerCall.args[0]).toMatchObject({ email: `${userId}@example.test`, metadata: { userId } });
        const stored = await prisma.billingCustomer.findUniqueOrThrow({ where: { userId_provider: { userId, provider: 'dodo' } } });

        const [sessionCall] = dodo.callsTo('checkoutSessions.create');
        const params = sessionCall.args[0] as Record<string, unknown>;
        expect(params.product_cart).toEqual([{ product_id: CAREER, quantity: 1 }]);
        // The amount is the product's, never ours.
        expect(JSON.stringify(params.product_cart)).not.toContain('amount');
        expect(params.customer).toEqual({ customer_id: stored.customerRef });
        expect(params.metadata).toEqual({ userId, slot: 'career', priceKey: 'career_monthly' });
        expect(params.return_url).toBe(`${config.app.url}/settings/plan?checkout=dodo`);
        expect(String(params.cancel_url)).toEndWith('/settings/plan?checkout=cancelled');

        // The pending session is kept for the return reconcile.
        expect(stored.pendingCheckoutKey).toBe('career_monthly');
        expect(stored.pendingCheckoutUrl).toBe(result.data.url);
        expect(stored.pendingCheckoutRef).toStartWith('cks_');

        const started = await prisma.funnelEvent.findMany({ where: { userId, type: 'checkout_started' } });
        expect(started).toHaveLength(1);
        expect(started[0].payload).toMatchObject({ tier: 'Career', provider: 'dodo', paywall: 'PW1' });
    });

    test('a second click inside the hour reuses the session: two devices, one subscription', async () => {
        signIn('double-click');
        const first = await billing.startCheckout('career_monthly');
        const second = await billing.startCheckout('career_monthly');
        expect(first.success && second.success && first.data.url === second.data.url).toBe(true);
        expect(dodo.callsTo('checkoutSessions.create')).toHaveLength(1);
        expect(dodo.callsTo('customers.create')).toHaveLength(1);
    });

    test('Search reuses the Dodo customer, and still requires Career first', async () => {
        const userId = signIn('search');
        const refused = await billing.startCheckout('search_monthly');
        expect(refused.success).toBe(false);
        if (!refused.success) expect(refused.code).toBe('career_required');

        await seedDodo(userId, 'career');
        const result = await billing.startCheckout('search_monthly');
        expect(result.success).toBe(true);
        expect(dodo.callsTo('customers.create')).toHaveLength(0);
        const params = dodo.callsTo('checkoutSessions.create')[0].args[0] as { product_cart: unknown; metadata: unknown };
        expect(params.product_cart).toEqual([{ product_id: SEARCH, quantity: 1 }]);
        expect(params.metadata).toMatchObject({ slot: 'search', priceKey: 'search_monthly' });
    });

    test('a slot already paid for through Dodo is not sold again', async () => {
        const userId = signIn('already');
        await seedDodo(userId, 'career');
        const result = await billing.startCheckout('career_monthly');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('already_subscribed');
    });

    test('a provider failure is a value with plain copy, never a throw', async () => {
        signIn('provider-down');
        dodo.failNext('checkoutSessions.create', Object.assign(new Error('500 upstream exploded'), { status: 500 }));
        const result = await billing.startCheckout('career_monthly');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.code).toBe('provider_error');
            expect(result.error).not.toContain('upstream');
        }
    });
});

describe('the launch switch', () => {
    test('while the launch is open a member is not offered checkout and the page says free', async () => {
        process.env.ENTITLEMENT_LAUNCH_OPEN = 'true';
        signIn('member-during-launch');
        const page = await billing.getPlanPageData();
        expect(page.success && page.data).toMatchObject({ launchOpen: true, billingConfigured: false, adminCheckoutPreview: false });

        const result = await billing.startCheckout('career_monthly');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('billing_unavailable');
        expect(dodo.calls).toHaveLength(0);
    });

    test('while the launch is open an admin can run a test-mode purchase', async () => {
        process.env.ENTITLEMENT_LAUNCH_OPEN = 'true';
        signIn('admin');
        const page = await billing.getPlanPageData();
        expect(page.success && page.data).toMatchObject({
            launchOpen: true,
            billingConfigured: true,
            adminCheckoutPreview: true,
            checkoutTestMode: true,
        });
        const result = await billing.startCheckout('career_monthly');
        expect(result.success).toBe(true);
        expect(dodo.callsTo('checkoutSessions.create')).toHaveLength(1);
    });

    test('an admin with a comped plan can still buy over it', async () => {
        process.env.ENTITLEMENT_LAUNCH_OPEN = 'true';
        const userId = signIn('admin');
        await prisma.subscription.upsert({
            where: { userId_slot: { userId, slot: 'career' } },
            create: { userId, slot: 'career', provider: 'admin_grant', customerRef: `admin_grant:${userId}`, tier: Tier.always_on, status: 'active' },
            update: { provider: 'admin_grant', status: 'active' },
        });
        const result = await billing.startCheckout('career_monthly');
        expect(result.success).toBe(true);
        await prisma.subscription.deleteMany({ where: { userId } });
        await prisma.billingCustomer.deleteMany({ where: { userId } });
    });

    test('after the launch everyone is offered checkout, in live mode when asked', async () => {
        process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
        try {
            signIn('member-after-launch');
            const page = await billing.getPlanPageData();
            expect(page.success && page.data).toMatchObject({
                launchOpen: false,
                billingConfigured: true,
                adminCheckoutPreview: false,
                checkoutTestMode: false,
            });
        } finally {
            delete process.env.DODO_PAYMENTS_ENVIRONMENT;
        }
    });
});

describe('managing a Dodo subscription', () => {
    test('cancel is cancel_at_next_billing_date, never an immediate cancel, and access stays to the period end', async () => {
        const userId = signIn('cancel');
        const sub = await seedDodo(userId, 'career');
        const result = await billing.cancelPlan({ slot: 'career', reason: 'got_the_job' });
        expect(result.success).toBe(true);

        expect(dodo.callsTo('subscriptions.update').map((call) => call.args)).toEqual([
            [sub.subscription_id, { cancel_at_next_billing_date: true }],
        ]);
        expect(dodo.getSubscription(sub.subscription_id)?.status).toBe('active');
        const state = await getSubscriptionState(userId);
        expect(state.career).toMatchObject({ status: 'canceling', active: true, cancelAtPeriodEnd: true });
    });

    test('turning Search off and back on flips cancel_at_next_billing_date and leaves Career alone', async () => {
        const userId = signIn('search-toggle');
        const career = await seedDodo(userId, 'career');
        const search = await seedDodo(userId, 'search');

        expect((await billing.turnOffSearch()).success).toBe(true);
        expect((await billing.reactivateSearch()).success).toBe(true);

        expect(dodo.callsTo('subscriptions.update').map((call) => call.args)).toEqual([
            [search.subscription_id, { cancel_at_next_billing_date: true }],
            [search.subscription_id, { cancel_at_next_billing_date: false }],
        ]);
        expect(dodo.callsTo('subscriptions.update').some((call) => call.args[0] === career.subscription_id)).toBe(false);
        expect((await getSubscriptionState(userId)).search?.status).toBe('active');
    });

    test("the portal is Dodo's customer portal for the user's own customer", async () => {
        const userId = signIn('portal');
        await seedDodo(userId, 'career');
        const page = await billing.getPlanPageData();
        expect(page.success && page.data.portalAvailable).toBe(true);

        const result = await billing.createBillingPortalSession();
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.url).toStartWith('https://test.customer.dodopayments.com/');
        const [call] = dodo.callsTo('customers.customerPortal.create');
        expect(call.args[0]).toBe(`cus_career_${userId}`);
        expect(String((call.args[1] as { return_url: string }).return_url)).toEndWith('/settings/plan');
    });

    test('an admin comp has no portal (there is no provider behind it)', async () => {
        const userId = signIn('comp-portal');
        await prisma.subscription.create({
            data: { userId, slot: 'career', provider: 'admin_grant', customerRef: `admin_grant:${userId}`, tier: Tier.always_on, status: 'active' },
        });
        const page = await billing.getPlanPageData();
        expect(page.success && page.data.portalAvailable).toBe(false);
    });

    test('a refund refunds the latest successful payment and ends the subscription now', async () => {
        const userId = signIn('refund');
        const sub = await seedDodo(userId, 'career');
        const payment = dodo.seedPayment(sub.subscription_id);
        const result = await refundDodoSubscription(sub.subscription_id);
        expect(result).toEqual({ success: true, data: { paymentId: payment.payment_id } });
        expect(dodo.callsTo('refunds.create')[0].args[0]).toMatchObject({ payment_id: payment.payment_id });
        expect(dodo.getSubscription(sub.subscription_id)?.status).toBe('cancelled');
    });

    test('with no payment to refund it says so instead of guessing', async () => {
        const userId = signIn('refund-none');
        const sub = await seedDodo(userId, 'career');
        const result = await refundDodoSubscription(sub.subscription_id);
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('no_payment');
        expect(dodo.callsTo('refunds.create')).toHaveLength(0);
    });
});

describe('the return redirect', () => {
    test('grants what Dodo confirms for the subscription on the URL', async () => {
        const userId = signIn('return');
        const started = await billing.startCheckout('career_monthly');
        expect(started.success).toBe(true);
        const sessionId = (await prisma.billingCustomer.findUniqueOrThrow({ where: { userId_provider: { userId, provider: 'dodo' } } }))
            .pendingCheckoutRef!;
        const { subscription } = dodo.completeCheckout(sessionId, future(30));

        const result = await billing.reconcileDodoCheckout({ subscriptionId: subscription.subscription_id });
        expect(result).toEqual({ success: true, data: { planName: 'Career' } });
        expect((await getSubscriptionState(userId)).career).toMatchObject({ provider: 'dodo', active: true });
        // The used checkout link is not handed out again.
        const after = await prisma.billingCustomer.findUniqueOrThrow({ where: { userId_provider: { userId, provider: 'dodo' } } });
        expect(after.pendingCheckoutUrl).toBeNull();
    });

    test('with no subscription_id on the URL it follows the pending session to its payment', async () => {
        const userId = signIn('return-session');
        await billing.startCheckout('career_monthly');
        const sessionId = (await prisma.billingCustomer.findUniqueOrThrow({ where: { userId_provider: { userId, provider: 'dodo' } } }))
            .pendingCheckoutRef!;
        dodo.completeCheckout(sessionId, future(30));

        const result = await billing.reconcileDodoCheckout({});
        expect(result.success).toBe(true);
        expect(dodo.callsTo('payments.retrieve')).toHaveLength(1);
    });

    test("someone else's subscription id on the URL grants nothing", async () => {
        signIn('victim');
        await billing.startCheckout('career_monthly');
        const victimSession = dodo.callsTo('checkoutSessions.create')[0];
        expect(victimSession).toBeDefined();
        const victimCustomer = (victimSession.args[0] as { customer: { customer_id: string } }).customer.customer_id;
        const theirs = dodo.seedSubscription({ customerId: victimCustomer, productId: CAREER, nextBillingDate: future(30) });

        const attacker = signIn('attacker');
        await billing.startCheckout('career_monthly');
        const result = await billing.reconcileDodoCheckout({ subscriptionId: theirs.subscription_id });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('forbidden');
        expect((await getSubscriptionState(attacker)).tier).toBe(Tier.free);
    });

    test('an unpaid checkout grants nothing yet', async () => {
        signIn('return-unpaid');
        await billing.startCheckout('career_monthly');
        const result = await billing.reconcileDodoCheckout({});
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('pending');
    });

    test('a malformed id is refused before any API call', async () => {
        signIn('return-junk');
        const result = await billing.reconcileDodoCheckout({ subscriptionId: '../../etc/passwd' });
        expect(result.success).toBe(false);
        expect(dodo.calls).toHaveLength(0);
    });
});
