/**
 * Billing actions — integration tests against the live Postgres, with Stripe
 * stubbed at the client boundary.
 *
 * The claims worth testing here are the promises the PRD makes to users, not
 * the plumbing: turning Search off leaves Career standing, cancelling deletes
 * nothing, the downgrade offer is raised proactively and only once, and every
 * one of those emits the telemetry the thesis is measured with.
 *
 * Stripe is a hand-written stub injected through `__setStripeClientForTests`.
 * No network, and every call it receives is recorded so we can assert the
 * *shape* of what we would have sent — `cancel_at_period_end`, never an
 * immediate cancel.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import {
  ApplicationStatus,
  EvidenceKind,
  PacketType,
  Tier,
  WinCategory,
  WinSource,
  WinStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

import { evaluateProactiveDowngrade, subscriptionRowKey } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { __setStripeClientForTests } from '@/lib/stripe';


const clerk = installClerkMock();

const billing = await import('@/actions/billing');

// ---------------------------------------------------------------------------
// Stripe stub
// ---------------------------------------------------------------------------

type StripeCall = { method: string; args: unknown[] };
const stripeCalls: StripeCall[] = [];

function record<T>(method: string, value: T) {
  return async (...args: unknown[]): Promise<T> => {
    stripeCalls.push({ method, args });
    return value;
  };
}

function callsTo(method: string): StripeCall[] {
  return stripeCalls.filter((call) => call.method === method);
}

const stripeStub = {
  customers: { create: record('customers.create', { id: 'cus_test' }) },
  checkout: {
    sessions: {
      create: record('checkout.sessions.create', { url: 'https://stripe.test/checkout/abc' }),
    },
  },
  billingPortal: {
    sessions: { create: record('billingPortal.sessions.create', { url: 'https://stripe.test/portal' }) },
  },
  subscriptions: {
    update: record('subscriptions.update', {}),
    cancel: record('subscriptions.cancel', {}),
  },
};

const ORIGINAL_ENV = {
  key: process.env.STRIPE_SECRET_KEY,
  career: process.env.STRIPE_PRICE_CAREER_MONTHLY,
  search: process.env.STRIPE_PRICE_SEARCH_MONTHLY,
};

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
  process.env.STRIPE_PRICE_CAREER_MONTHLY = 'price_career_monthly_test';
  process.env.STRIPE_PRICE_SEARCH_MONTHLY = 'price_search_monthly_test';
  __setStripeClientForTests(stripeStub as unknown as Stripe);
});

afterAll(() => {
  __setStripeClientForTests(null);
  process.env.STRIPE_SECRET_KEY = ORIGINAL_ENV.key;
  process.env.STRIPE_PRICE_CAREER_MONTHLY = ORIGINAL_ENV.career;
  process.env.STRIPE_PRICE_SEARCH_MONTHLY = ORIGINAL_ENV.search;
  clerk.signOut();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN = `itest-bill-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function signIn(label: string): string {
  const id = `${RUN}-${label}`;
  users.push(id);
  clerk.signIn(id);
  return id;
}

function future(days = 30): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function seed(
  userId: string,
  slot: 'career' | 'search',
  tier: Tier,
  status = 'active',
  currentPeriodEnd: Date | null = future()
): Promise<void> {
  const rowKey = subscriptionRowKey(userId, slot);
  await prisma.subscription.upsert({
    where: { userId: rowKey },
    create: {
      userId: rowKey,
      stripeCustomerId: `cus_${RUN}`,
      stripeSubId: `sub_${slot}_${RUN}`,
      tier,
      status,
      currentPeriodEnd,
    },
    update: { tier, status, currentPeriodEnd },
  });
}

/** A user's record: the things cancellation must never touch. */
async function seedRecord(userId: string) {
  const win = await prisma.win.create({
    data: {
      userId,
      title: 'Cut checkout p95 latency 800ms to 180ms',
      narrative: 'Batched the pricing lookup behind a read-through cache.',
      occurredAt: new Date('2026-05-01T00:00:00Z'),
      category: WinCategory.improved,
      status: WinStatus.confirmed,
      source: WinSource.manual,
      confirmedAt: new Date(),
    },
  });
  const evidence = await prisma.evidence.create({
    data: {
      userId,
      kind: EvidenceKind.repo,
      sourceRef: 'patronus/api#482',
      excerpt: 'p95 800ms -> 180ms',
      confirmedByUser: true,
    },
  });
  const claim = await prisma.claimLink.create({
    data: {
      userId,
      claimType: 'impact_metric',
      claimRefId: win.id,
      evidenceId: evidence.id,
      groundState: 'grounded',
    },
  });
  const packet = await prisma.reviewPacket.create({
    data: {
      userId,
      type: PacketType.brag_doc,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-06-30T00:00:00Z'),
    },
  });
  return { win, evidence, claim, packet };
}

afterEach(async () => {
  stripeCalls.length = 0;
  while (users.length > 0) {
    const userId = users.pop();
    if (!userId) continue;
    await prisma.subscription.deleteMany({
      where: { userId: { in: [userId, subscriptionRowKey(userId, 'search')] } },
    });
    await prisma.usageQuota.deleteMany({ where: { userId } });
    await prisma.claimLink.deleteMany({ where: { userId } });
    await prisma.evidence.deleteMany({ where: { userId } });
    await prisma.reviewPacket.deleteMany({ where: { userId } });
    await prisma.win.deleteMany({ where: { userId } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId } });
    await prisma.funnelEvent.deleteMany({ where: { userId } });
  }
  clerk.signOut();
});

/** The plan page read model for whoever is currently signed in. */
async function planPageData() {
  const result = await billing.getPlanPageData();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function events(userId: string, type: string) {
  return prisma.funnelEvent.findMany({ where: { userId, type }, orderBy: { occurredAt: 'asc' } });
}

// ---------------------------------------------------------------------------

describe('checkout', () => {
  test('unauthenticated is a value, never a throw', async () => {
    clerk.signOut();
    const result = await billing.startCheckout('career_monthly');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('unauthenticated');
  });

  test('creates a session, carries an idempotency key, and records the funnel', async () => {
    const userId = signIn('checkout');
    const result = await billing.startCheckout('career_monthly', { paywallCode: 'PW1' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.url).toContain('stripe.test');

    const [call] = callsTo('checkout.sessions.create');
    const [params, options] = call.args as [Stripe.Checkout.SessionCreateParams, { idempotencyKey: string }];
    expect(params.mode).toBe('subscription');
    expect(params.line_items?.[0].price).toBe('price_career_monthly_test');
    expect(options.idempotencyKey).toContain(userId);

    const started = await events(userId, 'checkout_started');
    expect(started).toHaveLength(1);
    expect((started[0].payload as { tier: string }).tier).toBe('Career');
    expect((started[0].payload as { paywall: string }).paywall).toBe('PW1');
  });

  test('adding Search creates a second subscription on the same customer', async () => {
    const userId = signIn('add-search');
    await seed(userId, 'career', Tier.always_on);

    const result = await billing.startCheckout('search_monthly');
    expect(result.success).toBe(true);

    const [call] = callsTo('checkout.sessions.create');
    const [params] = call.args as [Stripe.Checkout.SessionCreateParams];
    expect(params.customer).toBe(`cus_${RUN}`);
    expect(params.line_items?.[0].price).toBe('price_search_monthly_test');
    expect(
      (params.subscription_data?.metadata as Record<string, string> | undefined)?.slot
    ).toBe('search');
    // No customer was created — we reused the one on the Career row.
    expect(callsTo('customers.create')).toHaveLength(0);
  });
});

describe('turning Search off leaves Career intact (PRD 06 §5.3)', () => {
  test('cancels at period end and the user stays on Career', async () => {
    const userId = signIn('turn-off');
    await seed(userId, 'career', Tier.always_on);
    await seed(userId, 'search', Tier.pro);

    const result = await billing.turnOffSearch();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.remainingPlan).toBe('Career');

    const [call] = callsTo('subscriptions.update');
    const [subId, params] = call.args as [string, Stripe.SubscriptionUpdateParams];
    expect(subId).toBe(`sub_search_${RUN}`);
    expect(params.cancel_at_period_end).toBe(true);
    expect((params.metadata as Record<string, string>).winBack).toBe('1');
    // Never an immediate cancel: they paid for the period.
    expect(callsTo('subscriptions.cancel')).toHaveLength(0);

    // The Career row was not touched.
    const career = await prisma.subscription.findUnique({ where: { userId } });
    expect(career?.tier).toBe(Tier.always_on);
    expect(career?.status).toBe('active');

    // And once the Search period lapses, they land on Career, not Free.
    await prisma.subscription.update({
      where: { userId: subscriptionRowKey(userId, 'search') },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    const data = await planPageData();
    expect(data.planName).toBe('Career');
  });

  test('a proactive turn-off records accepted + plan_changed(proactive)', async () => {
    const userId = signIn('turn-off-proactive');
    await seed(userId, 'career', Tier.always_on);
    await seed(userId, 'search', Tier.pro);

    await billing.turnOffSearch({ trigger: 'offer_received' });

    const accepted = await events(userId, 'proactive_downgrade_accepted');
    expect(accepted).toHaveLength(1);
    expect((accepted[0].payload as { trigger: string }).trigger).toBe('offer_received');

    const changed = await events(userId, 'plan_changed');
    expect((changed[0].payload as { reason: string }).reason).toBe('proactive');
    expect((changed[0].payload as { to: string }).to).toBe('Career');
  });

  test('turning it back on inside the period costs nothing and is measured', async () => {
    const userId = signIn('reactivate');
    await seed(userId, 'career', Tier.always_on);
    await seed(userId, 'search', Tier.pro);
    await billing.turnOffSearch({ trigger: 'offer_received' });
    stripeCalls.length = 0;

    const result = await billing.reactivateSearch();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.url).toBeNull();

    const [call] = callsTo('subscriptions.update');
    const [, params] = call.args as [string, Stripe.SubscriptionUpdateParams];
    expect(params.cancel_at_period_end).toBe(false);
    expect(callsTo('checkout.sessions.create')).toHaveLength(0);

    const reactivated = await events(userId, 'search_reactivated');
    expect(reactivated).toHaveLength(1);
    expect((reactivated[0].payload as { daysSinceOff: number }).daysSinceOff).toBe(0);
  });

  test('turning off Search when it is not on is a value, not a throw', async () => {
    const userId = signIn('turn-off-none');
    await seed(userId, 'career', Tier.always_on);
    const result = await billing.turnOffSearch();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('not_subscribed');
  });
});

describe('the proactive downgrade offer', () => {
  test('an application at offer stage raises it, in their own words', async () => {
    const userId = signIn('offer');
    await seed(userId, 'search', Tier.pro);
    await prisma.applicationWorkspace.create({
      data: {
        userId,
        sourceUrl: `https://jobs.example.com/${RUN}`,
        companyName: 'Northwind',
        roleTitle: 'Staff Engineer',
        applicationStatus: ApplicationStatus.offer,
      },
    });

    const offer = await evaluateProactiveDowngrade(userId);
    expect(offer).not.toBeNull();
    expect(offer?.trigger).toBe('offer_received');
    expect(offer?.headline).toBe('Congratulations.');
    expect(offer?.detail).toContain('Staff Engineer');
    expect(offer?.detail).toContain('Northwind');
    expect(offer?.keeps).toContain('Career');
  });

  test('30 days of silence raises it too', async () => {
    const userId = signIn('inactive');
    await seed(userId, 'search', Tier.pro);
    const offer = await evaluateProactiveDowngrade(userId);
    expect(offer?.trigger).toBe('inactivity_30d');
  });

  test('recent activity does not', async () => {
    const userId = signIn('active');
    await seed(userId, 'search', Tier.pro);
    await prisma.applicationWorkspace.create({
      data: {
        userId,
        sourceUrl: `https://jobs.example.com/active-${RUN}`,
        applicationStatus: ApplicationStatus.in_progress,
      },
    });
    expect(await evaluateProactiveDowngrade(userId)).toBeNull();
  });

  test('we ask at most once a month — declining buys 30 days of quiet', async () => {
    const userId = signIn('cooldown');
    await seed(userId, 'search', Tier.pro);
    expect(await evaluateProactiveDowngrade(userId)).not.toBeNull();

    await billing.recordDowngradeOffered('inactivity_30d');
    expect(await evaluateProactiveDowngrade(userId)).toBeNull();

    const offered = await events(userId, 'proactive_downgrade_offered');
    expect(offered).toHaveLength(1);
  });

  test('declining is recorded, and is not a conversion failure', async () => {
    const userId = signIn('declined');
    await seed(userId, 'search', Tier.pro);
    const result = await billing.declineDowngradeOffer('offer_received');
    expect(result.success).toBe(true);
    expect(await events(userId, 'proactive_downgrade_declined')).toHaveLength(1);
  });

  test('no Search subscription means no offer, ever', async () => {
    const userId = signIn('no-search');
    await seed(userId, 'career', Tier.always_on);
    expect(await evaluateProactiveDowngrade(userId)).toBeNull();
  });
});

describe('cancellation deletes nothing (PRD 06 §5.4, §9)', () => {
  test('not one Win, Evidence, ClaimLink or packet is removed', async () => {
    const userId = signIn('cancel-keeps-data');
    await seed(userId, 'career', Tier.always_on);
    const seeded = await seedRecord(userId);

    const result = await billing.cancelPlan({ reason: 'got_the_job', exportedFirst: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dataRetained).toBe(true);

    // Every row still exists, unchanged.
    const win = await prisma.win.findUnique({ where: { id: seeded.win.id } });
    const evidence = await prisma.evidence.findUnique({ where: { id: seeded.evidence.id } });
    const claim = await prisma.claimLink.findUnique({ where: { id: seeded.claim.id } });
    const packet = await prisma.reviewPacket.findUnique({ where: { id: seeded.packet.id } });

    expect(win?.title).toBe(seeded.win.title);
    expect(win?.status).toBe(WinStatus.confirmed);
    expect(evidence?.confirmedByUser).toBe(true);
    expect(claim?.groundState).toBe('grounded');
    expect(packet?.type).toBe(PacketType.brag_doc);

    expect(await prisma.win.count({ where: { userId } })).toBe(1);
    expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
    expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);
    expect(await prisma.reviewPacket.count({ where: { userId } })).toBe(1);

    // Nor is the subscription row deleted — it winds down.
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.status).toBe('canceling');
  });

  test('one confirm, at period end, and the reason is optional', async () => {
    const userId = signIn('cancel-shape');
    await seed(userId, 'career', Tier.always_on);

    const result = await billing.cancelPlan({});
    expect(result.success).toBe(true);

    const [call] = callsTo('subscriptions.update');
    const [, params] = call.args as [string, Stripe.SubscriptionUpdateParams];
    expect(params.cancel_at_period_end).toBe(true);
    expect(callsTo('subscriptions.cancel')).toHaveLength(0);

    const completed = await events(userId, 'cancel_flow_completed');
    expect((completed[0].payload as { reason: string | null }).reason).toBeNull();
  });

  test('the cancel flow records whether they exported first', async () => {
    const userId = signIn('cancel-export');
    await seed(userId, 'career', Tier.always_on);
    await billing.enterCancelFlow();
    await billing.cancelPlan({ exportedFirst: true });

    expect(await events(userId, 'cancel_flow_entered')).toHaveLength(1);
    const completed = await events(userId, 'cancel_flow_completed');
    expect((completed[0].payload as { exportedFirst: boolean }).exportedFirst).toBe(true);
  });

  test('cancelling Search does not cancel Career', async () => {
    const userId = signIn('cancel-search-slot');
    await seed(userId, 'career', Tier.always_on);
    await seed(userId, 'search', Tier.pro);

    await billing.cancelPlan({ slot: 'search' });

    const career = await prisma.subscription.findUnique({ where: { userId } });
    const search = await prisma.subscription.findUnique({
      where: { userId: subscriptionRowKey(userId, 'search') },
    });
    expect(career?.status).toBe('active');
    expect(search?.status).toBe('canceling');
  });
});

describe('export', () => {
  test('returns the whole record as JSON and counts it', async () => {
    const userId = signIn('export');
    const seeded = await seedRecord(userId);

    const result = await billing.exportEverything();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.filename).toContain('patronus-export-');
    const parsed = JSON.parse(result.data.json) as {
      schema: string;
      wins: { id: string }[];
      reviewPackets: { id: string }[];
    };
    expect(parsed.schema).toBe('patronus.export.v1');
    expect(parsed.wins.map((w) => w.id)).toContain(seeded.win.id);
    expect(parsed.reviewPackets.map((p) => p.id)).toContain(seeded.packet.id);

    expect(await events(userId, 'data_exported')).toHaveLength(1);
  });
});

describe('the plan page read model', () => {
  test('shows every metered action with the plan name, never the enum', async () => {
    const userId = signIn('plan-page');
    await seed(userId, 'career', Tier.always_on);

    const data = await planPageData();
    expect(data.planName).toBe('Career');
    expect(data.priceLabel).toBe('$5/month');
    expect(data.usage.length).toBeGreaterThan(0);
    expect(data.career?.planName).toBe('Career');
    expect(data.canAddSearch).toBe(true);

    // Wire-safe: unlimited is null, dates are strings.
    for (const line of data.usage) {
      expect(line.limit === null || Number.isFinite(line.limit)).toBe(true);
      expect(line.resetsOn === null || typeof line.resetsOn === 'string').toBe(true);
    }
  });

  test('a Search subscriber cannot be sold Search again', async () => {
    const userId = signIn('plan-page-pro');
    await seed(userId, 'career', Tier.always_on);
    await seed(userId, 'search', Tier.pro);

    const data = await planPageData();
    expect(data.planName).toBe('Search');
    expect(data.canAddSearch).toBe(false);
  });

  test('soft mode is stated on the page rather than hidden', async () => {
    signIn('plan-page-soft');
    const data = await planPageData();
    expect(data.enforced).toBe(false);
    expect(data.planName).toBe('Free');
  });
});

describe('paywall telemetry', () => {
  test('paywall_shown carries the code, the plan name and hasOwnData', async () => {
    const userId = signIn('paywall');
    await billing.recordPaywallShown({ code: 'PW1', hasOwnData: true });

    const [event] = await events(userId, 'paywall_shown');
    const payload = event.payload as { code: string; tier: string; hasOwnData: boolean };
    expect(payload.code).toBe('PW1');
    expect(payload.tier).toBe('Free');
    expect(payload.hasOwnData).toBe(true);
  });

  test('the CTA records the plan it sells, by name', async () => {
    const userId = signIn('paywall-cta');
    await billing.recordPaywallCta({ code: 'PW4', targetTier: Tier.pro });

    const [event] = await events(userId, 'paywall_cta_clicked');
    expect((event.payload as { targetTier: string }).targetTier).toBe('Search');
  });
});
