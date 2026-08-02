import type { Tier } from '@prisma/client';

/*
 * `Tier` is imported as a TYPE only, and the tables below are keyed by string
 * literal. That is deliberate: this module is reachable from client components
 * (the plan page, the paywalls), and a value import of `@prisma/client` would
 * drag the Prisma runtime into the browser bundle. Prisma generates `Tier` as a
 * string union, so `Record<Tier, T>` still gives full exhaustiveness checking.
 */

/**
 * The plan catalog (PRD 06 §3).
 *
 * This module is the ONLY place a plan name, a price, a quota, or a plan-gated
 * capability is written down. Two rules follow from that, and both are graded:
 *
 *   1. **No raw `Tier` enum in the UI** (CLAUDE.md rule 4). `'always_on'`
 *      displays as "Career", `'pro'` as "Search". Everything user-visible
 *      goes through {@link planName} / {@link PLAN_CATALOG}.
 *   2. **No numeric limit literal at a call site** (PRD 06 §9). `3 free
 *      generations`, `90 days of history`, `1 source` — all of it resolves
 *      here, and all of it is env-overridable so we can tune without a deploy.
 *
 * We deliberately do NOT migrate the `Tier` enum: it is a column on a live
 * billing table, and renaming it buys nothing that a display map doesn't.
 *
 * Import direction: `plans.ts` knows nothing about the database. `entitlements.ts`
 * imports this; never the reverse.
 */

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export type PriceKey = 'career_annual' | 'career_monthly' | 'search_monthly';

export type BillingInterval = 'month' | 'year';

export interface PlanPrice {
  key: PriceKey;
  interval: BillingInterval;
  /** Display amount in cents. The source of truth for what the UI says. */
  amountCents: number;
  /** "$99/year" — precomputed so no call site does currency maths. */
  label: string;
  /** "billed annually" */
  cadence: string;
  /** Env var carrying the Stripe price id. Ids are deploy config, not code. */
  envVar: string;
  /** Marks the price we steer people to. */
  recommended?: boolean;
}

/**
 * Which subscription "slot" a price belongs to. Search is a *separate* Stripe
 * subscription rather than a second line item (PRD 06 §5.2) — simpler
 * proration, independent cancellation, and it matches the mental model of
 * turning Search off without touching Career.
 */
export type SubscriptionSlot = 'career' | 'search';

export const SUBSCRIPTION_SLOTS: readonly SubscriptionSlot[] = ['career', 'search'] as const;

export function slotForPriceKey(key: PriceKey): SubscriptionSlot {
  return key === 'search_monthly' ? 'search' : 'career';
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface PlanDefinition {
  tier: Tier;
  /** The user-facing product name. Never the enum value. */
  name: string;
  /** Positioning line, PRD 06 §2.1. */
  blurb: string;
  /** Ordering for "effective tier = max order across active subscriptions". */
  order: number;
  /** Who this is for, in one clause. Used on the change-plan surface. */
  audience: string;
  prices: readonly PlanPrice[];
  /** Whether a user can buy this today. Teams is R3. */
  purchasable: boolean;
  slot: SubscriptionSlot | null;
}

export const PLAN_CATALOG: Record<Tier, PlanDefinition> = {
  free: {
    tier: 'free',
    name: 'Free',
    blurb: 'Keep a record',
    order: 0,
    audience: 'Anyone starting a work log',
    prices: [],
    purchasable: false,
    slot: null,
  },
  always_on: {
    tier: 'always_on',
    name: 'Career',
    blurb: 'Stay ready',
    order: 1,
    audience: 'For people with a job and a review coming',
    prices: [
      {
        key: 'career_annual',
        interval: 'year',
        amountCents: 9900,
        label: '$99/year',
        cadence: 'billed annually',
        envVar: 'STRIPE_PRICE_CAREER_ANNUAL',
        recommended: true,
      },
      {
        key: 'career_monthly',
        interval: 'month',
        amountCents: 1500,
        label: '$15/month',
        cadence: 'billed monthly',
        envVar: 'STRIPE_PRICE_CAREER_MONTHLY',
      },
    ],
    purchasable: true,
    slot: 'career',
  },
  pro: {
    tier: 'pro',
    name: 'Search',
    blurb: 'Run the hunt',
    order: 2,
    audience: 'For people actively looking, for as long as that lasts',
    prices: [
      {
        key: 'search_monthly',
        interval: 'month',
        amountCents: 2900,
        label: '$29/month',
        cadence: 'billed monthly, cancel any time',
        envVar: 'STRIPE_PRICE_SEARCH_MONTHLY',
      },
    ],
    purchasable: true,
    slot: 'search',
  },
  team: {
    tier: 'team',
    name: 'Teams',
    blurb: 'For coaches',
    order: 3,
    audience: 'Coaches and career services',
    prices: [],
    purchasable: false,
    slot: null,
  },
};

/**
 * Named handles on the catalog.
 *
 * UI code must reach plans through these rather than `PLAN_CATALOG.pro`:
 * the CI grep gate bans `Tier.<value>` anywhere under `src/components` and
 * `src/app`, and it is right to — a component that indexes by enum is one
 * refactor away from rendering it.
 */
export const FREE_PLAN = PLAN_CATALOG.free;
export const CAREER_PLAN = PLAN_CATALOG.always_on;
export const SEARCH_PLAN = PLAN_CATALOG.pro;
export const TEAMS_PLAN = PLAN_CATALOG.team;

/** The three plans a user compares, in order. */
export const COMPARISON_PLANS = [FREE_PLAN, CAREER_PLAN, SEARCH_PLAN] as const;

/** Every price in the catalog, keyed. */
export const PRICES: Record<PriceKey, PlanPrice> = Object.values(PLAN_CATALOG).reduce(
  (acc, plan) => {
    for (const price of plan.prices) acc[price.key] = price;
    return acc;
  },
  {} as Record<PriceKey, PlanPrice>
);

export function isPriceKey(value: string): value is PriceKey {
  return value in PRICES;
}

export function priceFor(key: PriceKey): PlanPrice {
  return PRICES[key];
}

export function tierForPriceKey(key: PriceKey): Tier {
  return key === 'search_monthly' ? 'pro' : 'always_on';
}

/**
 * Env vars from the pre-packaging sprint. Read as a fallback so an environment
 * configured before the rename keeps billing people correctly.
 */
const LEGACY_PRICE_ENV: Partial<Record<PriceKey, string>> = {
  career_monthly: 'STRIPE_PRICE_ALWAYS_ON',
  search_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
};

/**
 * Resolve the configured Stripe price id. **Server only** — price ids live in
 * non-public env vars, so a client component calling this gets `undefined`.
 * Display values come from the catalog, never from Stripe.
 */
export function stripePriceId(key: PriceKey): string | undefined {
  const value = process.env[PRICES[key].envVar];
  if (value && value.length > 0) return value;
  const legacyVar = LEGACY_PRICE_ENV[key];
  const legacy = legacyVar ? process.env[legacyVar] : undefined;
  return legacy && legacy.length > 0 ? legacy : undefined;
}

/** Reverse lookup: a Stripe price id back to the catalog entry. */
export function priceKeyForStripeId(priceId: string | null | undefined): PriceKey | null {
  if (!priceId) return null;
  for (const key of Object.keys(PRICES) as PriceKey[]) {
    if (stripePriceId(key) === priceId) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display helpers — the only sanctioned way to render a plan
// ---------------------------------------------------------------------------

export function planName(tier: Tier): string {
  return PLAN_CATALOG[tier].name;
}

export function planBlurb(tier: Tier): string {
  return PLAN_CATALOG[tier].blurb;
}

export function planOrder(tier: Tier): number {
  return PLAN_CATALOG[tier].order;
}

/** Effective tier across several active subscriptions (PRD 06 §5.2, §8). */
export function maxTier(tiers: readonly Tier[]): Tier {
  return tiers.reduce<Tier>(
    (best, tier) => (planOrder(tier) > planOrder(best) ? tier : best),
    'free'
  );
}

export function isAtLeast(tier: Tier, required: Tier): boolean {
  return planOrder(tier) >= planOrder(required);
}

/** `9900` → `"$99"`, `1550` → `"$15.50"`. */
export function formatUsd(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** The headline price for a tier, or null for Free/Teams. */
export function headlinePrice(tier: Tier): PlanPrice | null {
  const prices = PLAN_CATALOG[tier].prices;
  if (prices.length === 0) return null;
  return prices.find((p) => p.recommended) ?? prices[0];
}

// ---------------------------------------------------------------------------
// Non-metered plan attributes (PRD 06 §3.3)
// ---------------------------------------------------------------------------

/**
 * Capabilities that are on/off rather than counted. These never touch
 * `UsageQuota`: a flat table means `hasFeature` costs zero queries once the
 * tier is known.
 */
export type PlanFeature =
  | 'log_history_unlimited'
  | 'month_in_review'
  | 'rubric_mapping'
  | 'radar_full'
  | 'one_on_one_prep'
  | 'apply_orchestration'
  | 'interview_prep'
  | 'negotiation_mission'
  | 'ats_auto_fix';

export const PLAN_FEATURES: Record<Tier, Record<PlanFeature, boolean>> = {
  free: {
    log_history_unlimited: false,
    month_in_review: false,
    rubric_mapping: false,
    radar_full: false,
    one_on_one_prep: false,
    apply_orchestration: false,
    interview_prep: false,
    negotiation_mission: false,
    ats_auto_fix: false,
  },
  always_on: {
    log_history_unlimited: true,
    month_in_review: true,
    rubric_mapping: true,
    radar_full: true,
    one_on_one_prep: true,
    apply_orchestration: false,
    interview_prep: false,
    negotiation_mission: false,
    ats_auto_fix: false,
  },
  // Search *includes* Career (PRD 06 §2.1). Everything true above stays true.
  pro: {
    log_history_unlimited: true,
    month_in_review: true,
    rubric_mapping: true,
    radar_full: true,
    one_on_one_prep: true,
    apply_orchestration: true,
    interview_prep: true,
    negotiation_mission: true,
    ats_auto_fix: true,
  },
  team: {
    log_history_unlimited: true,
    month_in_review: true,
    rubric_mapping: true,
    radar_full: true,
    one_on_one_prep: true,
    apply_orchestration: true,
    interview_prep: true,
    negotiation_mission: true,
    ats_auto_fix: true,
  },
};

/** Human label for a capability, for paywall and comparison copy. */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  log_history_unlimited: 'Unlimited log history',
  month_in_review: 'Month in Review',
  rubric_mapping: 'Rubric mapping and readiness',
  radar_full: 'Career Radar',
  one_on_one_prep: '1:1 prep',
  apply_orchestration: 'Multi-step apply orchestration',
  interview_prep: 'Interview prep',
  negotiation_mission: 'Negotiation mission',
  ats_auto_fix: 'ATS auto-fix',
};

/** Every tier, cheapest first. The order the upsell ladder is climbed in. */
const TIERS_BY_ORDER: readonly Tier[] = (Object.keys(PLAN_CATALOG) as Tier[]).sort(
  (a, b) => planOrder(a) - planOrder(b)
);

/** The lowest tier that includes a capability — what a paywall should offer. */
export function tierRequiredFor(feature: PlanFeature): Tier {
  return TIERS_BY_ORDER.find((tier) => PLAN_FEATURES[tier][feature]) ?? 'pro';
}

// ---------------------------------------------------------------------------
// Numeric plan attributes (PRD 06 §3.4)
// ---------------------------------------------------------------------------

export const UNLIMITED = Number.POSITIVE_INFINITY;

export function isUnlimited(limit: number): boolean {
  return !Number.isFinite(limit);
}

/** Env override for any numeric plan attribute. Invalid values are ignored. */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'unlimited') return UNLIMITED;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SOURCE_LIMITS: Record<Tier, number> = {
  free: 1,
  always_on: 3,
  pro: 3,
  team: 3,
};

const LOG_HISTORY_DAYS: Record<Tier, number> = {
  free: 90,
  always_on: UNLIMITED,
  pro: UNLIMITED,
  team: UNLIMITED,
};

const MASTER_RESUME_LIMITS: Record<Tier, number> = {
  free: 1,
  always_on: 3,
  pro: UNLIMITED,
  team: UNLIMITED,
};

/** Connected capture sources allowed on a tier (PRD 06 §2.1, PW7). */
export function sourceLimit(tier: Tier): number {
  return envNumber(`ENTITLEMENT_SOURCE_LIMIT_${tier.toUpperCase()}`, SOURCE_LIMITS[tier]);
}

/**
 * Days of log history *visible* on a tier. Older Wins are hidden, never
 * deleted (CLAUDE.md invariant, PRD 06 §5.4).
 */
export function logHistoryDays(tier: Tier): number {
  return envNumber(`ENTITLEMENT_LOG_HISTORY_DAYS_${tier.toUpperCase()}`, LOG_HISTORY_DAYS[tier]);
}

export function masterResumeLimit(tier: Tier): number {
  return envNumber(
    `ENTITLEMENT_MASTER_RESUME_LIMIT_${tier.toUpperCase()}`,
    MASTER_RESUME_LIMITS[tier]
  );
}

// ---------------------------------------------------------------------------
// Metered actions (PRD 06 §3.2)
// ---------------------------------------------------------------------------

/**
 * Actions counted against a quota. Capture is deliberately absent and must
 * stay absent: gating capture would starve the context graph, which is the
 * asset (PRD 06 §2.3).
 */
export const METERED_ACTIONS = [
  'tailored_generation',
  'auto_apply',
  'context_interview',
  'tier2_grounding',
  'win_draft',
  'month_in_review',
  'review_packet',
  'rubric_upload',
  'radar_refresh',
  'cover_letter',
] as const;

export type MeteredAction = (typeof METERED_ACTIONS)[number];

export function isMeteredAction(value: string): value is MeteredAction {
  return (METERED_ACTIONS as readonly string[]).includes(value);
}

/**
 * `period` counts against the current billing month. `lifetime` counts once,
 * ever — the Free brag doc is one lifetime packet, which a monthly quota
 * cannot express (PRD 03 §8).
 */
export type QuotaScope = 'period' | 'lifetime';

export interface MeteredLimit {
  limit: number;
  scope: QuotaScope;
}

/** Noun phrase for the meter: "4 of 15 tailored resumes this period". */
export const METERED_ACTION_LABELS: Record<MeteredAction, string> = {
  tailored_generation: 'Tailored resumes',
  auto_apply: 'Automated applications',
  context_interview: 'Context interviews',
  tier2_grounding: 'Deep truthfulness checks',
  win_draft: 'AI-structured wins',
  month_in_review: 'Month in Review',
  review_packet: 'Review packets',
  rubric_upload: 'Rubric uploads',
  radar_refresh: 'On-demand Radar refreshes',
  cover_letter: 'Cover letters and outreach',
};

const PERIOD: QuotaScope = 'period';

function period(limit: number): MeteredLimit {
  return { limit, scope: PERIOD };
}

function lifetime(limit: number): MeteredLimit {
  return { limit, scope: 'lifetime' };
}

const unlimited: MeteredLimit = { limit: UNLIMITED, scope: PERIOD };

/**
 * Per-tier, per-action limits. `UNLIMITED` means the action is not metered for
 * that tier (no `UsageQuota` row is ever written). `0` means the action is not
 * on that tier at all, which is an upsell rather than an exhausted quota.
 */
const PLAN_METERED_LIMITS: Record<Tier, Record<MeteredAction, MeteredLimit>> = {
  free: {
    tailored_generation: period(3),
    auto_apply: period(0),
    // PRD 07 §6. One free reconstruction: it is the strongest demo the product
    // has, and a user who rebuilds one job wants to rebuild the other three.
    // `period(0)` here would have made backfill unreachable on Free the moment
    // enforcement flipped on.
    context_interview: lifetime(1),
    tier2_grounding: period(0),
    // An abuse ceiling, not a product limit: drafting is part of the capture
    // loop we refuse to gate.
    win_draft: period(30),
    month_in_review: period(0),
    review_packet: lifetime(1),
    rubric_upload: period(0),
    radar_refresh: period(0),
    cover_letter: period(0),
  },
  always_on: {
    tailored_generation: period(15),
    auto_apply: period(0),
    context_interview: period(4),
    tier2_grounding: unlimited,
    win_draft: unlimited,
    month_in_review: unlimited,
    review_packet: period(4),
    rubric_upload: period(3),
    radar_refresh: period(1),
    cover_letter: period(3),
  },
  pro: {
    tailored_generation: unlimited,
    auto_apply: unlimited,
    context_interview: unlimited,
    tier2_grounding: unlimited,
    win_draft: unlimited,
    month_in_review: unlimited,
    review_packet: period(4),
    rubric_upload: period(3),
    radar_refresh: unlimited,
    cover_letter: unlimited,
  },
  team: {
    tailored_generation: unlimited,
    auto_apply: unlimited,
    context_interview: unlimited,
    tier2_grounding: unlimited,
    win_draft: unlimited,
    month_in_review: unlimited,
    review_packet: unlimited,
    rubric_upload: unlimited,
    radar_refresh: unlimited,
    cover_letter: unlimited,
  },
};

/**
 * Legacy env overrides that shipped before the generic scheme. Kept so an
 * already-deployed value keeps working; new limits use
 * `ENTITLEMENT_LIMIT_<TIER>_<ACTION>`.
 */
const LEGACY_LIMIT_ENV: Partial<Record<Tier, Partial<Record<MeteredAction, string>>>> = {
  free: {
    tailored_generation: 'ENTITLEMENT_FREE_TAILORED_PER_MONTH',
    win_draft: 'ENTITLEMENT_FREE_WIN_DRAFTS_PER_MONTH',
  },
  always_on: {
    tailored_generation: 'ENTITLEMENT_ALWAYS_ON_TAILORED_PER_MONTH',
  },
};

/**
 * The limit for a tier/action pair, after env overrides.
 *
 * Every limit is tunable without a deploy — that is the whole point of routing
 * them through one function.
 */
export function meteredLimit(tier: Tier, action: MeteredAction): MeteredLimit {
  const base = PLAN_METERED_LIMITS[tier][action];
  const legacyVar = LEGACY_LIMIT_ENV[tier]?.[action];
  const legacy = legacyVar ? envNumber(legacyVar, base.limit) : base.limit;
  const limit = envNumber(`ENTITLEMENT_LIMIT_${tier.toUpperCase()}_${action.toUpperCase()}`, legacy);
  return limit === base.limit ? base : { limit, scope: base.scope };
}

/** The lowest tier on which an action is available at all. */
export function tierRequiredForAction(action: MeteredAction): Tier {
  return TIERS_BY_ORDER.find((tier) => meteredLimit(tier, action).limit > 0) ?? 'pro';
}

// ---------------------------------------------------------------------------
// Comparison table (the change-plan surface)
// ---------------------------------------------------------------------------

export interface PlanComparisonRow {
  label: string;
  /** One cell per plan in {@link COMPARISON_PLANS} order: Free, Career, Search. */
  values: readonly [string, string, string];
}

/**
 * PRD 06 §2.1, rendered. Strings rather than booleans because half the cells
 * are quantities and a tick would lose the number that matters.
 */
export const PLAN_COMPARISON: readonly PlanComparisonRow[] = [
  { label: 'Work log capture', values: ['Included', 'Included', 'Included'] },
  { label: 'Log history', values: ['90 days visible', 'Unlimited', 'Unlimited'] },
  { label: 'Connected sources', values: ['1', '3', '3'] },
  { label: 'Weekly digest', values: ['Included', 'Included', 'Included'] },
  { label: 'Month in Review', values: ['—', 'Included', 'Included'] },
  { label: 'Review packets', values: ['1 lifetime', '4 per period', '4 per period'] },
  { label: 'Rubric mapping and readiness', values: ['—', 'Included', 'Included'] },
  { label: '1:1 prep', values: ['—', 'Included', 'Included'] },
  { label: 'Career Radar', values: ['Teaser', 'Included', 'Included, on demand'] },
  { label: 'Master resumes', values: ['1', '3', 'Unlimited'] },
  { label: 'Tailored generations', values: ['3 per month', '15 per month', 'Unlimited'] },
  { label: 'ATS score and fix', values: ['Score only', 'Score and fix', 'Score, fix, auto-fix'] },
  { label: 'Extension fit-score and autofill', values: ['Included', 'Included', 'Included'] },
  { label: 'Multi-step apply orchestration', values: ['—', '—', 'Included'] },
  { label: 'Cover letters and outreach', values: ['—', '3 per month', 'Unlimited'] },
  { label: 'Interview prep', values: ['—', '—', 'Included'] },
  { label: 'Negotiation mission', values: ['—', '—', 'Included'] },
  { label: 'Full export', values: ['Included', 'Included', 'Included'] },
  { label: 'Support', values: ['Docs', 'Email, 2 business days', 'Email, 1 business day'] },
];

/**
 * What stays free forever (PRD 06 §2.3). Rendered verbatim on the pricing and
 * cancel surfaces, because it is the sentence that makes leaving safe.
 */
export const FREE_FOREVER_PROMISE =
  'Logging is free forever. We charge for what we do with it.';

/**
 * The retention promise. Shown on every downgrade and cancel surface — and it
 * has to be true, which is why there is an integration test on it.
 */
export const NO_DELETION_PROMISE =
  'Nothing is deleted. Wins older than 90 days are hidden on Free and come back the moment you resubscribe.';
