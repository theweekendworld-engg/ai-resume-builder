/**
 * The plan catalog — pure unit tests.
 *
 * These guard the two properties that packaging bugs actually come from:
 * a display name drifting from the PRD, and a limit that says one thing in the
 * comparison table and another in the code that enforces it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Tier } from '@prisma/client';

import type { PriceKey } from '@/lib/plans';
import {
  CAREER_PLAN,
  COMPARISON_PLANS,
  FREE_PLAN,
  LAUNCH_ALLOWANCE,
  METERED_ACTIONS,
  METERED_ACTION_LABELS,
  PLAN_CATALOG,
  PLAN_COMPARISON,
  PLAN_FEATURES,
  PRICES,
  SEARCH_PLAN,
  formatUsd,
  headlinePrice,
  isPriceKey,
  isTrialLimit,
  isUnlimited,
  jobWatchCompanyLimit,
  jobWatchNightlyScoreLimit,
  launchOpenAccess,
  logHistoryDays,
  masterResumeLimit,
  maxTier,
  meteredLimit,
  planHasFeature,
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
  'ENTITLEMENT_LIMIT_FREE_COVER_LETTER',
  'ENTITLEMENT_FREE_TAILORED_PER_MONTH',
  'ENTITLEMENT_SOURCE_LIMIT_FREE',
  'STRIPE_PRICE_CAREER_ANNUAL',
  'STRIPE_PRICE_SEARCH_MONTHLY',
  'STRIPE_PRICE_ALWAYS_ON',
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

/**
 * Most of this file tests the PAID packaging: what each plan includes once
 * paid plans return. During the launch (2026-11-07) every account gets
 * everything (`launchOpenAccess`), so those blocks switch the launch off to
 * keep proving the machinery that comes back. The launch itself is the last
 * describe in the file.
 */
function afterTheLaunch(): void {
  beforeAll(() => {
    process.env.ENTITLEMENT_LAUNCH_OPEN = 'false';
  });
  afterAll(() => {
    delete process.env.ENTITLEMENT_LAUNCH_OPEN;
  });
}

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
  test('the current numbers, exactly', () => {
    expect(priceFor('career_monthly').amountCents).toBe(500);
    expect(priceFor('search_monthly').amountCents).toBe(200);
  });

  test('every price is monthly — annual billing was retired', () => {
    for (const key of Object.keys(PRICES) as PriceKey[]) {
      expect(priceFor(key).interval).toBe('month');
    }
  });

  test('the retired annual key no longer resolves', () => {
    // Subscriptions on the old annual price still exist in the wild, so this
    // has to be a clean `false` rather than a stale price.
    expect(isPriceKey('career_annual')).toBe(false);
  });

  test('labels are derived from the amounts, so they cannot drift', () => {
    expect(formatUsd(500)).toBe('$5');
    expect(formatUsd(1550)).toBe('$15.50');
    expect(priceFor('career_monthly').label).toContain(formatUsd(500));
  });

  test('each plan steers to its only price', () => {
    expect(headlinePrice(Tier.always_on)?.key).toBe('career_monthly');
    expect(headlinePrice(Tier.pro)?.key).toBe('search_monthly');
    expect(headlinePrice(Tier.free)).toBeNull();
  });

  /**
   * Search is an ADD-ON bought on top of Career (PRD 06 §5.2), not a rung
   * above it, so it is priced below the base rather than above. Asserted
   * because "the cheaper plan grants more" would be a real inversion if the
   * two ever became alternatives.
   */
  test('Search is priced as an add-on, under the base it sits on', () => {
    expect(priceFor('search_monthly').amountCents).toBeLessThan(
      priceFor('career_monthly').amountCents
    );
  });

  test('Search is its own subscription slot', () => {
    expect(slotForPriceKey('search_monthly')).toBe('search');
    expect(slotForPriceKey('career_monthly')).toBe('career');
  });

  test('price keys map to the tier they grant', () => {
    expect(tierForPriceKey('career_monthly')).toBe(Tier.always_on);
    expect(tierForPriceKey('search_monthly')).toBe(Tier.pro);
    expect(isPriceKey('career_monthly')).toBe(true);
    expect(isPriceKey('nonsense')).toBe(false);
  });

  test('stripe ids come from env, with the pre-rename var as a fallback', () => {
    expect(stripePriceId('search_monthly')).toBeUndefined();

    process.env.STRIPE_PRICE_SEARCH_MONTHLY = 'price_search_123';
    expect(stripePriceId('search_monthly')).toBe('price_search_123');
    expect(priceKeyForStripeId('price_search_123')).toBe('search_monthly');
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

describe('features — Search includes Career (after the launch)', () => {
  afterTheLaunch();
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

describe('numeric attributes (after the launch)', () => {
  afterTheLaunch();
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

describe('metered limits (after the launch)', () => {
  afterTheLaunch();
  test('the allotments', () => {
    // Free's tailored generations became 10 LIFETIME rather than 3 a month.
    // Three a month forever is a worse deal for us and a weaker prompt to
    // upgrade than ten now — someone who has made ten is in a job search,
    // which is exactly when Search is worth $2. See `freeResumeCap`.
    expect(meteredLimit(Tier.free, 'tailored_generation').limit).toBe(10);
    expect(meteredLimit(Tier.free, 'tailored_generation').scope).toBe('lifetime');
    expect(meteredLimit(Tier.always_on, 'tailored_generation').limit).toBe(15);
    expect(isUnlimited(meteredLimit(Tier.pro, 'tailored_generation').limit)).toBe(true);
    expect(meteredLimit(Tier.always_on, 'cover_letter').limit).toBe(3);
    expect(isUnlimited(meteredLimit(Tier.pro, 'cover_letter').limit)).toBe(true);
  });

  test('the Free packet allowance is lifetime, and now a trial of three', () => {
    // Was `lifetime(1)`. Free is a trial of the whole product now, so the
    // number moved with every other trial — but the SCOPE is the part that
    // matters and has not: a lifetime counter never refills, which is what
    // makes it an upgrade prompt rather than a wait.
    const free = meteredLimit(Tier.free, 'review_packet');
    expect(free).toEqual({ limit: 3, scope: 'lifetime', trial: true });
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

describe('comparison table (the paid packaging record)', () => {
  afterTheLaunch();
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
    expect(byLabel.get('Cover letters and outreach')?.[0]).toContain(
      String(meteredLimit(Tier.free, 'cover_letter').limit)
    );
    expect(byLabel.get('Cover letters and outreach')?.[1]).toContain(
      String(meteredLimit(Tier.always_on, 'cover_letter').limit)
    );
  });
});

/**
 * The launch (owner decision, 2026-11-07): every feature on every account,
 * generous monthly allowances, and the $5 cost ceiling as abuse protection.
 * These replaced the old free numbers as what a new account actually gets;
 * the old ones are asserted above, with the launch switched off.
 */
describe('during the launch, every feature is on for every account', () => {
  test('the launch is on by default', () => {
    delete process.env.ENTITLEMENT_LAUNCH_OPEN;
    expect(launchOpenAccess()).toBe(true);
  });

  test('Free has every capability, so no gate, badge or paywall can lock one', () => {
    for (const tier of Object.keys(PLAN_CATALOG) as Tier[]) {
      for (const feature of Object.keys(PLAN_FEATURES.free) as (keyof typeof PLAN_FEATURES.free)[]) {
        expect(planHasFeature(tier, feature)).toBe(true);
      }
    }
    expect(tierRequiredFor('month_in_review')).toBe(Tier.free);
    expect(tierRequiredFor('apply_orchestration')).toBe(Tier.free);
  });

  test('the new free allowances, monthly and not trials', () => {
    // Was 10 tailored resumes lifetime and 3 outreach drafts lifetime: enough
    // to taste, not enough for a job search, and nothing to upgrade to.
    expect(meteredLimit(Tier.free, 'tailored_generation')).toEqual({ limit: 100, scope: 'period' });
    expect(meteredLimit(Tier.free, 'cover_letter')).toEqual({ limit: 300, scope: 'period' });
    expect(meteredLimit(Tier.free, 'link_analysis')).toEqual({ limit: 150, scope: 'period' });
    expect(meteredLimit(Tier.free, 'win_draft').limit).toBe(300);
    expect(meteredLimit(Tier.free, 'review_packet')).toEqual({ limit: 10, scope: 'period' });
    for (const action of METERED_ACTIONS) {
      expect(isTrialLimit(Tier.free, action)).toBe(false);
      expect(meteredLimit(Tier.free, action).limit).toBe(LAUNCH_ALLOWANCE.metered[action]);
    }
  });

  test('every built action resolves to Free, so no message names a plan to buy', () => {
    for (const action of ['tailored_generation', 'cover_letter', 'link_analysis', 'review_packet', 'month_in_review'] as const) {
      expect(tierRequiredForAction(action)).toBe(Tier.free);
    }
  });

  test('the unbuilt actions stay closed: there is nothing behind them', () => {
    expect(meteredLimit(Tier.free, 'auto_apply').limit).toBe(0);
    expect(meteredLimit(Tier.free, 'radar_refresh').limit).toBe(0);
  });

  test('numeric allowances: full history, every source, more resumes and watched companies', () => {
    expect(isUnlimited(logHistoryDays(Tier.free))).toBe(true);
    expect(sourceLimit(Tier.free)).toBe(3);
    expect(masterResumeLimit(Tier.free)).toBe(10);
    expect(jobWatchCompanyLimit(Tier.free)).toBe(30);
    expect(jobWatchNightlyScoreLimit(Tier.free)).toBe(25);
  });

  test('a paid or comped account is never worse off than a free one', () => {
    for (const action of METERED_ACTIONS) {
      const free = meteredLimit(Tier.free, action).limit;
      expect(meteredLimit(Tier.always_on, action).limit).toBeGreaterThanOrEqual(free);
      expect(meteredLimit(Tier.pro, action).limit).toBeGreaterThanOrEqual(free);
    }
    // Career's own 15 a month loses to the launch's 100; Search's unlimited wins.
    expect(meteredLimit(Tier.always_on, 'tailored_generation').limit).toBe(100);
    expect(isUnlimited(meteredLimit(Tier.pro, 'tailored_generation').limit)).toBe(true);
    expect(masterResumeLimit(Tier.always_on)).toBe(10);
  });

  test('every launch number is still tunable through the free tier\'s variable', () => {
    process.env.ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION = '40';
    process.env.ENTITLEMENT_SOURCE_LIMIT_FREE = '2';
    expect(meteredLimit(Tier.free, 'tailored_generation').limit).toBe(40);
    expect(sourceLimit(Tier.free)).toBe(2);
  });

  test('switching the launch off restores the paid packaging exactly', () => {
    process.env.ENTITLEMENT_LAUNCH_OPEN = 'false';
    try {
      expect(planHasFeature(Tier.free, 'month_in_review')).toBe(false);
      expect(meteredLimit(Tier.free, 'tailored_generation')).toEqual({ limit: 10, scope: 'lifetime', trial: true });
      expect(meteredLimit(Tier.always_on, 'tailored_generation').limit).toBe(15);
    } finally {
      delete process.env.ENTITLEMENT_LAUNCH_OPEN;
    }
  });
});
