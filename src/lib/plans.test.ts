/**
 * The plan catalog — pure unit tests.
 *
 * These guard the two properties that packaging bugs actually come from:
 * a display name drifting from the PRD, and a limit that says one thing in the
 * comparison table and another in the code that enforces it.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Tier } from '@prisma/client';

import {
  CAREER_PLAN,
  COMPARISON_PLANS,
  FREE_PLAN,
  METERED_ACTIONS,
  METERED_ACTION_LABELS,
  PLAN_CATALOG,
  PLAN_COMPARISON,
  PLAN_FEATURES,
  SEARCH_PLAN,
  formatUsd,
  headlinePrice,
  isPriceKey,
  isUnlimited,
  logHistoryDays,
  masterResumeLimit,
  maxTier,
  meteredLimit,
  planName,
  planOrder,
  priceFor,
  priceKeyForStripeId,
  slotForPriceKey,
  sourceLimit,
  stripePriceId,
  tierForPriceKey,
  tierRequiredFor,
  tierRequiredForAction,
} from './plans';

const ENV_KEYS = [
  'ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION',
  'ENTITLEMENT_FREE_TAILORED_PER_MONTH',
  'ENTITLEMENT_SOURCE_LIMIT_FREE',
  'STRIPE_PRICE_CAREER_ANNUAL',
  'STRIPE_PRICE_SEARCH_MONTHLY',
  'STRIPE_PRICE_ALWAYS_ON',
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('display names (CLAUDE.md rule 4)', () => {
  test('the enum never leaks: always_on is "Career", pro is "Search"', () => {
    expect(planName(Tier.always_on)).toBe('Career');
    expect(planName(Tier.pro)).toBe('Search');
    expect(planName(Tier.free)).toBe('Free');
  });

  test('no plan name is an enum value', () => {
    const enumValues = new Set<string>(Object.values(Tier));
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(enumValues.has(plan.name)).toBe(false);
      expect(plan.name).not.toContain('_');
    }
  });

  test('named handles point at the right tiers', () => {
    expect(FREE_PLAN.tier).toBe(Tier.free);
    expect(CAREER_PLAN.tier).toBe(Tier.always_on);
    expect(SEARCH_PLAN.tier).toBe(Tier.pro);
  });
});

describe('prices', () => {
  test('the PRD numbers, exactly', () => {
    expect(priceFor('career_annual').amountCents).toBe(3000);
    expect(priceFor('career_monthly').amountCents).toBe(500);
    expect(priceFor('search_monthly').amountCents).toBe(2900);
  });

  test('labels are derived from the amounts, so they cannot drift', () => {
    expect(formatUsd(3000)).toBe('$30');
    expect(formatUsd(1550)).toBe('$15.50');
    expect(priceFor('career_annual').label).toContain(formatUsd(3000));
  });

  test('annual is the steered choice on Career', () => {
    expect(headlinePrice(Tier.always_on)?.key).toBe('career_annual');
    expect(headlinePrice(Tier.free)).toBeNull();
  });

  test('Search is its own subscription slot', () => {
    expect(slotForPriceKey('search_monthly')).toBe('search');
    expect(slotForPriceKey('career_annual')).toBe('career');
    expect(slotForPriceKey('career_monthly')).toBe('career');
  });

  test('price keys map to the tier they grant', () => {
    expect(tierForPriceKey('career_annual')).toBe(Tier.always_on);
    expect(tierForPriceKey('career_monthly')).toBe(Tier.always_on);
    expect(tierForPriceKey('search_monthly')).toBe(Tier.pro);
    expect(isPriceKey('career_annual')).toBe(true);
    expect(isPriceKey('nonsense')).toBe(false);
  });

  test('stripe ids come from env, with the pre-rename var as a fallback', () => {
    expect(stripePriceId('career_annual')).toBeUndefined();

    process.env.STRIPE_PRICE_CAREER_ANNUAL = 'price_annual_123';
    expect(stripePriceId('career_annual')).toBe('price_annual_123');
    expect(priceKeyForStripeId('price_annual_123')).toBe('career_annual');
    expect(priceKeyForStripeId('price_unknown')).toBeNull();
    expect(priceKeyForStripeId(null)).toBeNull();

    // Legacy: an environment configured before the packaging rename.
    process.env.STRIPE_PRICE_ALWAYS_ON = 'price_legacy_always_on';
    expect(stripePriceId('career_monthly')).toBe('price_legacy_always_on');
  });
});

describe('ordering — effective tier is max order', () => {
  test('order is Free < Career < Search < Teams', () => {
    expect(planOrder(Tier.free)).toBeLessThan(planOrder(Tier.always_on));
    expect(planOrder(Tier.always_on)).toBeLessThan(planOrder(Tier.pro));
    expect(planOrder(Tier.pro)).toBeLessThan(planOrder(Tier.team));
  });

  test('Career + Search resolves to Search, in either order', () => {
    expect(maxTier([Tier.always_on, Tier.pro])).toBe(Tier.pro);
    expect(maxTier([Tier.pro, Tier.always_on])).toBe(Tier.pro);
  });

  test('nothing active is Free', () => {
    expect(maxTier([])).toBe(Tier.free);
  });
});

describe('features — Search includes Career', () => {
  test('every capability Career has, Search has', () => {
    for (const [feature, enabled] of Object.entries(PLAN_FEATURES[Tier.always_on])) {
      if (!enabled) continue;
      expect(PLAN_FEATURES[Tier.pro][feature as keyof typeof PLAN_FEATURES.pro]).toBe(true);
    }
  });

  test('Free has no paid capability', () => {
    expect(Object.values(PLAN_FEATURES[Tier.free]).some(Boolean)).toBe(false);
  });

  test('hunt capabilities are Search-only', () => {
    expect(PLAN_FEATURES[Tier.always_on].apply_orchestration).toBe(false);
    expect(PLAN_FEATURES[Tier.always_on].interview_prep).toBe(false);
    expect(PLAN_FEATURES[Tier.pro].apply_orchestration).toBe(true);
  });

  test('tierRequiredFor names the cheapest plan that includes it', () => {
    expect(tierRequiredFor('month_in_review')).toBe(Tier.always_on);
    expect(tierRequiredFor('negotiation_mission')).toBe(Tier.pro);
  });
});

describe('numeric attributes', () => {
  test('the PRD table, in code', () => {
    expect(sourceLimit(Tier.free)).toBe(1);
    expect(sourceLimit(Tier.always_on)).toBe(3);
    expect(logHistoryDays(Tier.free)).toBe(90);
    expect(isUnlimited(logHistoryDays(Tier.always_on))).toBe(true);
    expect(masterResumeLimit(Tier.free)).toBe(1);
    expect(masterResumeLimit(Tier.always_on)).toBe(3);
    expect(isUnlimited(masterResumeLimit(Tier.pro))).toBe(true);
  });

  test('every limit is tunable without a deploy', () => {
    process.env.ENTITLEMENT_SOURCE_LIMIT_FREE = '2';
    expect(sourceLimit(Tier.free)).toBe(2);
  });

  test('a garbage env value is ignored rather than obeyed', () => {
    process.env.ENTITLEMENT_SOURCE_LIMIT_FREE = 'lots';
    expect(sourceLimit(Tier.free)).toBe(1);
  });
});

describe('metered limits', () => {
  test('the PRD allotments', () => {
    expect(meteredLimit(Tier.free, 'tailored_generation').limit).toBe(3);
    expect(meteredLimit(Tier.always_on, 'tailored_generation').limit).toBe(15);
    expect(isUnlimited(meteredLimit(Tier.pro, 'tailored_generation').limit)).toBe(true);
    expect(meteredLimit(Tier.always_on, 'cover_letter').limit).toBe(3);
    expect(isUnlimited(meteredLimit(Tier.pro, 'cover_letter').limit)).toBe(true);
  });

  test('the Free brag doc is one LIFETIME packet, not one a month', () => {
    const free = meteredLimit(Tier.free, 'review_packet');
    expect(free).toEqual({ limit: 1, scope: 'lifetime' });
    expect(meteredLimit(Tier.always_on, 'review_packet')).toEqual({ limit: 4, scope: 'period' });
  });

  test('capture is never metered — gating it would starve the graph', () => {
    expect(METERED_ACTIONS).not.toContain('capture' as never);
    expect(METERED_ACTIONS).not.toContain('win_confirm' as never);
  });

  test('the legacy env override still works, and the generic one wins', () => {
    process.env.ENTITLEMENT_FREE_TAILORED_PER_MONTH = '5';
    expect(meteredLimit(Tier.free, 'tailored_generation').limit).toBe(5);

    process.env.ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION = '7';
    expect(meteredLimit(Tier.free, 'tailored_generation').limit).toBe(7);
  });

  test('every action has a label and a required tier', () => {
    for (const action of METERED_ACTIONS) {
      expect(METERED_ACTION_LABELS[action].length).toBeGreaterThan(0);
      expect(planOrder(tierRequiredForAction(action))).toBeGreaterThanOrEqual(0);
    }
  });

  test('paid tiers are never stingier than Free', () => {
    for (const action of METERED_ACTIONS) {
      const free = meteredLimit(Tier.free, action).limit;
      const pro = meteredLimit(Tier.pro, action).limit;
      expect(pro).toBeGreaterThanOrEqual(free);
    }
  });
});

describe('comparison table', () => {
  test('one cell per plan, in COMPARISON_PLANS order', () => {
    expect(COMPARISON_PLANS.map((p) => p.name)).toEqual(['Free', 'Career', 'Search']);
    for (const row of PLAN_COMPARISON) {
      expect(row.values).toHaveLength(COMPARISON_PLANS.length);
    }
  });

  test('the quantities in the table match the code that enforces them', () => {
    const byLabel = new Map(PLAN_COMPARISON.map((row) => [row.label, row.values]));
    expect(byLabel.get('Tailored generations')?.[0]).toContain(
      String(meteredLimit(Tier.free, 'tailored_generation').limit)
    );
    expect(byLabel.get('Tailored generations')?.[1]).toContain(
      String(meteredLimit(Tier.always_on, 'tailored_generation').limit)
    );
    expect(byLabel.get('Connected sources')?.[0]).toBe(String(sourceLimit(Tier.free)));
    expect(byLabel.get('Connected sources')?.[1]).toBe(String(sourceLimit(Tier.always_on)));
    expect(byLabel.get('Log history')?.[0]).toContain(String(logHistoryDays(Tier.free)));
  });
});
