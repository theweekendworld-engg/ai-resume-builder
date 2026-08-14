/**
 * Entitlements — integration tests against the live Postgres.
 *
 * What is under test here is the storage, not the policy: that two
 * subscriptions resolve to one effective tier, that the atomic consume is
 * actually atomic, that a refund cannot mint quota, and that the lifetime
 * counter is a real row that never resets.
 *
 * `.env.test` pins DATABASE_URL to the local Docker Postgres and sets
 * `ENTITLEMENTS_ENFORCE=false`; tests that need enforcement flip it and put it
 * back. Every row created here is tagged with a per-run user id and deleted in
 * `afterEach` — never assume an empty table.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Tier } from '@prisma/client';

import {
  EntitlementError,
  GRACE_PERIOD_DAYS,
  checkEntitlement,
  checkFeature,
  gateMeteredAction,
  getEntitlementSnapshot,
  getSubscriptionState,
  getUserTier,
  hasFeature,
  isEntitlementError,
  refundMeteredAction,
  requireFeature,
  __testing,
} from './entitlements';
import { METERED_ACTIONS, meteredLimit } from './plans';
import { prisma } from './prisma';
import { getCurrentBillingPeriod } from './usageTracker';

const RUN = `itest-ent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function newUser(label: string): string {
  const id = `${RUN}-${label}`;
  users.push(id);
  return id;
}

function future(days = 30): Date {
  return new Date(Date.now() + days * 86_400_000);
}

function past(days = 1): Date {
  return new Date(Date.now() - days * 86_400_000);
}

async function seedSubscription(
  userId: string,
  slot: 'career' | 'search',
  tier: Tier,
  status: string,
  currentPeriodEnd: Date | null
): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId_slot: { userId, slot } },
    create: {
      userId,
      slot,
      stripeCustomerId: `cus_${RUN}`,
      stripeSubId: `sub_${slot}_${RUN}`,
      tier,
      status,
      currentPeriodEnd,
    },
    update: { tier, status, currentPeriodEnd },
  });
}

afterEach(async () => {
  while (users.length > 0) {
    const userId = users.pop();
    if (!userId) continue;
    // One filter now covers both slots — which is the point of the change.
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.usageQuota.deleteMany({ where: { userId } });
    await prisma.funnelEvent.deleteMany({ where: { userId } });
  }
});

// ---------------------------------------------------------------------------

describe('tier resolution across two subscriptions (PRD 06 §5.2)', () => {
  test('no subscription is Free', async () => {
    const userId = newUser('none');
    expect(await getUserTier(userId)).toBe(Tier.free);
  });

  test('Career alone resolves to Career', async () => {
    const userId = newUser('career');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future());
    expect(await getUserTier(userId)).toBe(Tier.always_on);
  });

  test('Career + Search resolves to Search — max order, not last write', async () => {
    const userId = newUser('both');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future());
    await seedSubscription(userId, 'search', Tier.pro, 'active', future());

    const state = await getSubscriptionState(userId);
    expect(state.tier).toBe(Tier.pro);
    expect(state.career?.active).toBe(true);
    expect(state.search?.active).toBe(true);
    expect(state.all).toHaveLength(2);
  });

  test('Search lapsing leaves Career intact — never a drop to Free', async () => {
    const userId = newUser('search-lapse');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future());
    await seedSubscription(userId, 'search', Tier.pro, 'canceling', past());

    const state = await getSubscriptionState(userId);
    expect(state.tier).toBe(Tier.always_on);
    expect(state.search?.active).toBe(false);
    expect(state.career?.active).toBe(true);
  });

  test('Career expiring under an active Search keeps Search capability', async () => {
    const userId = newUser('career-lapse');
    await seedSubscription(userId, 'career', Tier.always_on, 'canceled', past());
    await seedSubscription(userId, 'search', Tier.pro, 'active', future());
    expect(await getUserTier(userId)).toBe(Tier.pro);
  });

  test('a cancelled-but-unexpired subscription still grants access — they paid', async () => {
    const userId = newUser('canceling');
    await seedSubscription(userId, 'career', Tier.always_on, 'canceling', future(3));
    const state = await getSubscriptionState(userId);
    expect(state.tier).toBe(Tier.always_on);
    expect(state.career?.cancelAtPeriodEnd).toBe(true);
  });

  test('both slots live under the real userId', async () => {
    // The replacement for the old row-key round-trip test. What matters now is
    // that a plain `userId` filter finds everything the user has — the exact
    // query an account deletion or a data export would write, and the one the
    // `::search` suffix used to silently half-answer.
    const userId = newUser('slots');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future(30));
    await seedSubscription(userId, 'search', Tier.pro, 'active', future(30));

    const rows = await prisma.subscription.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.slot).sort()).toEqual(['career', 'search']);
    expect(rows.every((row) => row.userId === userId)).toBe(true);
  });
});

describe('failed payment — 14 days of full access (PRD 06 §5.5)', () => {
  test('past_due inside the grace window keeps everything', async () => {
    const userId = newUser('grace');
    await seedSubscription(
      userId,
      'career',
      Tier.always_on,
      'past_due',
      new Date(Date.now() + (GRACE_PERIOD_DAYS - 1) * 86_400_000)
    );
    const state = await getSubscriptionState(userId);
    expect(state.tier).toBe(Tier.always_on);
    expect(state.career?.pastDue).toBe(true);
  });

  test('past_due after the grace window drops to Free, data untouched', async () => {
    const userId = newUser('grace-over');
    await seedSubscription(userId, 'career', Tier.always_on, 'past_due', past(1));
    expect(await getUserTier(userId)).toBe(Tier.free);
    // The row is still there — downgrade is never a delete.
    expect(await prisma.subscription.count({ where: { userId } })).toBe(1);
  });
});

describe('feature gates are a table lookup, not a query (PRD 06 §3.3)', () => {
  test('hasFeature is synchronous and needs no user', () => {
    expect(hasFeature(Tier.free, 'month_in_review')).toBe(false);
    expect(hasFeature(Tier.always_on, 'month_in_review')).toBe(true);
    expect(hasFeature(Tier.always_on, 'interview_prep')).toBe(false);
    expect(hasFeature(Tier.pro, 'interview_prep')).toBe(true);
  });

  test('checkFeature names the plan to upsell to', () => {
    const decision = checkFeature(Tier.free, 'rubric_mapping');
    expect(decision.allowed).toBe(false);
    expect(decision.requiresUpgrade).toBe(true);
    expect(decision.requiredTier).toBe(Tier.always_on);
    expect(decision.action).toBeNull();
    expect(decision.feature).toBe('rubric_mapping');
  });

  test('requireFeature throws with plan NAMES, never enum values', async () => {
    const userId = newUser('feature-enforced');
    process.env.ENTITLEMENTS_ENFORCE = 'true';
    try {
      await requireFeature(userId, 'interview_prep');
      throw new Error('expected requireFeature to throw');
    } catch (error: unknown) {
      expect(isEntitlementError(error)).toBe(true);
      const message = (error as EntitlementError).message;
      expect(message).toContain('Search');
      expect(message).not.toContain('always_on');
      expect(message).not.toContain('pro');
    } finally {
      process.env.ENTITLEMENTS_ENFORCE = 'false';
    }
  });

  test('soft mode lets the feature through and records that we did', async () => {
    const userId = newUser('feature-soft');
    const decision = await requireFeature(userId, 'month_in_review');
    expect(decision.allowed).toBe(true);

    const events = await prisma.funnelEvent.findMany({
      where: { userId, type: 'entitlement_soft_allowed' },
    });
    expect(events).toHaveLength(1);
    expect((events[0].payload as { feature: string }).feature).toBe('month_in_review');
  });
});

/*
 * The free tailored-generation cap is operator-tunable (10 by default, env
 * `ENTITLEMENT_FREE_RESUME_LIFETIME_CAP`). These tests are about consuming,
 * racing and refunding — not about the number — so they pin it to something
 * small and assert against the pinned value. Hardcoding 3 is what made them
 * fail the moment the free tier was re-shaped, which is a test measuring
 * config rather than behaviour.
 */
const CAP = 3;

beforeAll(() => {
  process.env.ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION = String(CAP);
});

afterAll(() => {
  delete process.env.ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION;
});

describe('metered consume', () => {
  test('consuming decrements the remainder and writes one row', async () => {
    const userId = newUser('consume');
    const first = await gateMeteredAction(userId, 'tailored_generation');
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(CAP);
    expect(first.remaining).toBe(CAP - 1);

    const check = await checkEntitlement(userId, 'tailored_generation');
    expect(check.used).toBe(1);

    const rows = await prisma.usageQuota.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
  });

  test('concurrent consumes never exceed the limit', async () => {
    const userId = newUser('race');
    process.env.ENTITLEMENTS_ENFORCE = 'true';
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => gateMeteredAction(userId, 'tailored_generation'))
      );
      const allowed = results.filter((r) => r.status === 'fulfilled').length;
      expect(allowed).toBe(CAP);

      // Free's tailored generations are a LIFETIME cap now, so the counter
      // lives at the epoch rather than at this month's start. Querying the
      // current period would find no row and quietly assert nothing.
      const row = await prisma.usageQuota.findUnique({
        where: {
          userId_periodStart_action: {
            userId,
            periodStart: __testing.LIFETIME_PERIOD_START,
            action: 'tailored_generation',
          },
        },
      });
      expect(row?.used).toBe(CAP);
    } finally {
      process.env.ENTITLEMENTS_ENFORCE = 'false';
    }
  });

  test('unavailable on this tier is an upsell, not an exhausted quota', async () => {
    const userId = newUser('upsell');
    process.env.ENTITLEMENTS_ENFORCE = 'true';
    try {
      await gateMeteredAction(userId, 'auto_apply');
      throw new Error('expected a paywall');
    } catch (error: unknown) {
      expect(isEntitlementError(error)).toBe(true);
      const decision = (error as EntitlementError).decision;
      expect(decision.requiresUpgrade).toBe(true);
      expect(decision.requiredTier).toBe(Tier.pro);
      expect((error as EntitlementError).message).toContain('Search');
    } finally {
      process.env.ENTITLEMENTS_ENFORCE = 'false';
    }
  });

  test('an unlimited action writes no quota row at all', async () => {
    const userId = newUser('unlimited');
    await seedSubscription(userId, 'search', Tier.pro, 'active', future());
    const decision = await gateMeteredAction(userId, 'tailored_generation');
    expect(decision.allowed).toBe(true);
    expect(Number.isFinite(decision.limit)).toBe(false);
    expect(await prisma.usageQuota.count({ where: { userId } })).toBe(0);
  });
});

describe('soft mode (PRD 06 §4)', () => {
  test('over quota still completes, records the overage, and says by how much', async () => {
    const userId = newUser('soft');
    for (let i = 0; i < CAP; i += 1) await gateMeteredAction(userId, 'tailored_generation');

    const fourth = await gateMeteredAction(userId, 'tailored_generation');
    expect(fourth.allowed).toBe(true);
    expect(fourth.used).toBe(CAP + 1);
    expect(fourth.limit).toBe(CAP);

    const events = await prisma.funnelEvent.findMany({
      where: { userId, type: 'entitlement_soft_allowed' },
    });
    expect(events).toHaveLength(1);
    expect((events[0].payload as { overBy: number }).overBy).toBe(1);
  });

  test('enforcement records quota_exhausted instead of allowing', async () => {
    const userId = newUser('hard');
    process.env.ENTITLEMENTS_ENFORCE = 'true';
    try {
      for (let i = 0; i < CAP; i += 1) await gateMeteredAction(userId, 'tailored_generation');
      await expect(gateMeteredAction(userId, 'tailored_generation')).rejects.toThrow();

      const events = await prisma.funnelEvent.findMany({
        where: { userId, type: 'quota_exhausted' },
      });
      expect(events).toHaveLength(1);
    } finally {
      process.env.ENTITLEMENTS_ENFORCE = 'false';
    }
  });
});

describe('refundMeteredAction (PRD 06 §8)', () => {
  test('a terminal failure gives the unit back', async () => {
    const userId = newUser('refund');
    const consumed = await gateMeteredAction(userId, 'tailored_generation');
    expect(consumed.remaining).toBe(CAP - 1);

    const refunded = await refundMeteredAction(userId, 'tailored_generation');
    expect(refunded).toBe(true);

    const after = await checkEntitlement(userId, 'tailored_generation');
    expect(after.used).toBe(0);
    expect(after.remaining).toBe(CAP);
  });

  test('a double refund cannot mint quota', async () => {
    const userId = newUser('refund-twice');
    await gateMeteredAction(userId, 'tailored_generation');
    expect(await refundMeteredAction(userId, 'tailored_generation')).toBe(true);
    expect(await refundMeteredAction(userId, 'tailored_generation')).toBe(false);

    const after = await checkEntitlement(userId, 'tailored_generation');
    expect(after.used).toBe(0);
  });

  test('refunding without a prior consume creates nothing', async () => {
    const userId = newUser('refund-empty');
    expect(await refundMeteredAction(userId, 'tailored_generation')).toBe(false);
    expect(await prisma.usageQuota.count({ where: { userId } })).toBe(0);
  });

  test('refunding an unmetered action is a no-op', async () => {
    const userId = newUser('refund-unlimited');
    await seedSubscription(userId, 'search', Tier.pro, 'active', future());
    expect(await refundMeteredAction(userId, 'tailored_generation')).toBe(false);
  });

  test('the refunded unit is spendable again, and enforcement agrees', async () => {
    const userId = newUser('refund-respend');
    process.env.ENTITLEMENTS_ENFORCE = 'true';
    try {
      for (let i = 0; i < CAP; i += 1) await gateMeteredAction(userId, 'tailored_generation');
      await expect(gateMeteredAction(userId, 'tailored_generation')).rejects.toThrow();

      await refundMeteredAction(userId, 'tailored_generation');
      const retry = await gateMeteredAction(userId, 'tailored_generation');
      expect(retry.allowed).toBe(true);
    } finally {
      process.env.ENTITLEMENTS_ENFORCE = 'false';
    }
  });
});

describe('lifetime quotas — the Free brag doc', () => {
  test('the counter lives at the epoch, so a new month does not reset it', async () => {
    const userId = newUser('lifetime');
    const first = await gateMeteredAction(userId, 'review_packet');
    expect(first.allowed).toBe(true);
    expect(first.scope).toBe('lifetime');
    expect(first.resetsOn).toBeNull();

    const row = await prisma.usageQuota.findFirst({
      where: { userId, action: 'review_packet' },
    });
    expect(row?.periodStart.getTime()).toBe(__testing.LIFETIME_PERIOD_START.getTime());

    // Free gets a trial of three packets rather than the single lifetime one
    // it used to, so exhausting it takes the whole allowance.
    const trialSize = meteredLimit(Tier.free, 'review_packet').limit;
    for (let i = 1; i < trialSize; i += 1) await gateMeteredAction(userId, 'review_packet');

    const spent = await checkEntitlement(userId, 'review_packet');
    expect(spent.allowed).toBe(false);
    expect(spent.reason).toBe('quota exhausted');
    // And it reads as an upsell, because a lifetime trial has no next period.
    expect(spent.requiresUpgrade).toBe(true);
    expect(spent.requiredTier).toBe(Tier.always_on);
  });

  test('on Career the same action is a per-period quota of 4', async () => {
    const userId = newUser('packet-career');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future());
    const decision = await gateMeteredAction(userId, 'review_packet');
    expect(decision.scope).toBe('period');
    expect(decision.limit).toBe(4);
    expect(decision.resetsOn).not.toBeNull();
  });
});

describe('getEntitlementSnapshot — the plan page read model', () => {
  test('lists every metered action, used or not, available or not', async () => {
    const userId = newUser('snapshot');
    await gateMeteredAction(userId, 'tailored_generation');

    const snapshot = await getEntitlementSnapshot(userId);
    expect(snapshot.usage).toHaveLength(METERED_ACTIONS.length);
    expect(snapshot.tier).toBe(Tier.free);
    expect(snapshot.enforced).toBe(false);

    const tailored = snapshot.usage.find((u) => u.action === 'tailored_generation');
    expect(tailored?.used).toBe(1);
    expect(tailored?.limit).toBe(CAP);
    expect(tailored?.remaining).toBe(CAP - 1);
    // Null, and that is the point: a lifetime cap never resets, so the plan
    // page must not print a date implying it will.
    expect(tailored?.scope).toBe('lifetime');
    expect(tailored?.resetsOn).toBeNull();

    const autoApply = snapshot.usage.find((u) => u.action === 'auto_apply');
    expect(autoApply?.available).toBe(false);
  });

  test('lifetime usage is read from the epoch row, not the current month', async () => {
    const userId = newUser('snapshot-lifetime');
    await gateMeteredAction(userId, 'review_packet');

    const snapshot = await getEntitlementSnapshot(userId);
    const packet = snapshot.usage.find((u) => u.action === 'review_packet');
    expect(packet?.used).toBe(1);
    expect(packet?.scope).toBe('lifetime');
    expect(packet?.resetsOn).toBeNull();
  });

  test('a Search subscriber sees unlimited where the catalog says unlimited', async () => {
    const userId = newUser('snapshot-pro');
    await seedSubscription(userId, 'career', Tier.always_on, 'active', future());
    await seedSubscription(userId, 'search', Tier.pro, 'active', future());

    const snapshot = await getEntitlementSnapshot(userId);
    expect(snapshot.tier).toBe(Tier.pro);
    const tailored = snapshot.usage.find((u) => u.action === 'tailored_generation');
    expect(tailored?.unlimited).toBe(true);
  });
});
