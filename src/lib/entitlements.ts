import { ApplicationStatus, Tier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  METERED_ACTIONS,
  METERED_ACTION_LABELS,
  PLAN_FEATURES,
  UNLIMITED,
  isUnlimited,
  maxTier,
  meteredLimit,
  planName,
  tierRequiredFor,
  tierRequiredForAction,
  type MeteredAction,
  type PlanFeature,
  type QuotaScope,
  type SubscriptionSlot,
} from '@/lib/plans';
import { track } from '@/lib/track';
import { getCurrentBillingPeriod } from '@/lib/usageTracker';

/**
 * Entitlement layer (PRD 06 §3).
 *
 * Plan-aware enforcement wrapping every *metered* AI action, plus the
 * synchronous feature table for the gates that aren't counters. This is
 * distinct from the flat token/cost cap in `usageTracker.enforceUsageLimit`
 * (a runaway-cost safety net): entitlements gate on the *product plan*.
 *
 * Three things this module owns and nothing else may duplicate:
 *   - **Tier resolution.** Effective tier = max order across a user's active
 *     subscriptions (PRD 06 §5.2). Search implies Career; turning Search off
 *     must never drop someone to Free.
 *   - **Quota arithmetic**, including the refund path. A unit burned by a
 *     failed generation is something users notice and resent, so
 *     {@link refundMeteredAction} exists and callers are expected to use it.
 *   - **Soft mode.** `ENTITLEMENTS_ENFORCE=false` records the overage and lets
 *     the action through, so we accumulate real per-feature usage before we
 *     ever turn a paying user away (PRD 06 §4, Trap-1 mitigation).
 *
 * Limits themselves live in `src/lib/plans.ts`. Nothing here hard-codes a number.
 */

export type { MeteredAction, PlanFeature, QuotaScope, SubscriptionSlot } from '@/lib/plans';
export { METERED_ACTIONS, METERED_ACTION_LABELS } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Subscription rows
// ---------------------------------------------------------------------------

/**
 * Career and Search are two Stripe subscriptions, and therefore two rows,
 * distinguished by `Subscription.slot`.
 *
 * They used to be distinguished by writing `${userId}::search` into `userId`,
 * because that column was unique. The comment here promised the convention
 * would stay in this one file behind helpers — and it did not: a second
 * implementation had already appeared in the proactive-downgrade handler as
 * `userId.split('::')[0]`. A column whose values are sometimes not what the
 * column is named is a bug waiting for its next reader, and the obvious next
 * reader is an account deletion or a data export filtering `userId = $1`,
 * which would silently miss the Search row.
 *
 * `slot` is now a real column with a `@@unique([userId, slot])`. There is no
 * key derivation left to get wrong.
 */

/**
 * Statuses that grant access. `canceling` is a subscription the user has turned
 * off that has not reached its period end — they paid for it, they keep it.
 * `past_due` is the 14-day grace window; the webhook parks `currentPeriodEnd`
 * at the end of that window, so the period-end check below closes it.
 */
const ACCESS_STATUSES = new Set(['active', 'trialing', 'canceling', 'past_due']);

/** PRD 06 §5.5 — a card expiring is not a churn decision. */
export const GRACE_PERIOD_DAYS = 14;

export interface SubscriptionSummary {
  slot: SubscriptionSlot;
  tier: Tier;
  status: string;
  currentPeriodEnd: Date | null;
  stripeSubId: string | null;
  stripeCustomerId: string | null;
  /** Access is live right now. */
  active: boolean;
  /** Turned off, still inside the paid period. */
  cancelAtPeriodEnd: boolean;
  /** In the failed-payment grace window. */
  pastDue: boolean;
}

function summarize(
  row: {
    slot: SubscriptionSlot;
    tier: Tier;
    status: string;
    currentPeriodEnd: Date | null;
    stripeSubId: string | null;
    stripeCustomerId: string | null;
  },
  now: Date
): SubscriptionSummary {
  const withinPeriod = !row.currentPeriodEnd || row.currentPeriodEnd.getTime() > now.getTime();
  const active = row.tier !== Tier.free && ACCESS_STATUSES.has(row.status) && withinPeriod;
  return {
    slot: row.slot,
    tier: row.tier,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    stripeSubId: row.stripeSubId,
    stripeCustomerId: row.stripeCustomerId,
    active,
    cancelAtPeriodEnd: row.status === 'canceling',
    pastDue: row.status === 'past_due',
  };
}

export interface SubscriptionState {
  /** Effective tier: max order across everything currently active. */
  tier: Tier;
  career: SubscriptionSummary | null;
  search: SubscriptionSummary | null;
  /** Any row we hold, active or not — the plan page shows lapsed ones too. */
  all: SubscriptionSummary[];
}

/**
 * Every subscription a user holds, in one query.
 *
 * Prefer this over {@link getUserTier} anywhere the caller also needs renewal
 * dates or the Search/Career split — it is the same round trip.
 */
export async function getSubscriptionState(
  userId: string,
  now: Date = new Date()
): Promise<SubscriptionState> {
  const rows = await prisma.subscription.findMany({
    where: { userId },
    select: {
      slot: true,
      tier: true,
      status: true,
      currentPeriodEnd: true,
      stripeSubId: true,
      stripeCustomerId: true,
    },
  });

  const all = rows.map((row) => summarize(row, now));
  const career = all.find((s) => s.slot === 'career') ?? null;
  const search = all.find((s) => s.slot === 'search') ?? null;
  const tier = maxTier(all.filter((s) => s.active).map((s) => s.tier));

  return { tier, career, search, all };
}

/** Resolve the effective tier for a user (defaults to Free). */
export async function getUserTier(userId: string): Promise<Tier> {
  const { tier } = await getSubscriptionState(userId);
  return tier;
}

// ---------------------------------------------------------------------------
// Feature gates (non-counter, PRD 06 §3.3)
// ---------------------------------------------------------------------------

/**
 * Synchronous table lookup. Zero database queries once the tier is resolved —
 * that is a hard requirement, because these get called per row in a list.
 */
export function hasFeature(tier: Tier, feature: PlanFeature): boolean {
  return PLAN_FEATURES[tier][feature];
}

/**
 * Feature gates reuse {@link EntitlementDecision} rather than inventing a
 * parallel shape: it is the payload every paywall, route and extension client
 * already knows how to render, and a second one would have to be threaded
 * through all of them for no gain. `action` is null and `feature` is set.
 */
export type FeatureDecision = EntitlementDecision;

export function checkFeature(tier: Tier, feature: PlanFeature): EntitlementDecision {
  const allowed = hasFeature(tier, feature);
  return {
    allowed,
    tier,
    action: null,
    feature,
    limit: allowed ? UNLIMITED : 0,
    used: 0,
    remaining: allowed ? UNLIMITED : 0,
    scope: 'period',
    resetsOn: null,
    requiredTier: tierRequiredFor(feature),
    requiresUpgrade: !allowed,
    reason: allowed ? undefined : 'feature not included on this plan',
  };
}

/**
 * Throwing variant for action entry points. Costs exactly one query (the tier),
 * and honours soft mode like every other gate: in soft mode the user gets the
 * feature and we record that we let them.
 */
export async function requireFeature(
  userId: string,
  feature: PlanFeature
): Promise<EntitlementDecision> {
  const tier = await getUserTier(userId);
  const decision = checkFeature(tier, feature);
  if (decision.allowed) return decision;

  if (enforcementEnabled()) throw new EntitlementError(decision);

  await track(userId, 'entitlement_soft_allowed', { feature, tier, overBy: 1 });
  return { ...decision, allowed: true };
}

// ---------------------------------------------------------------------------
// Metered gates
// ---------------------------------------------------------------------------

export type EntitlementDecision = {
  allowed: boolean;
  tier: Tier;
  /** The metered action, or `null` on a feature gate. */
  action: MeteredAction | null;
  /** The plan capability, or `null` on a metered gate. */
  feature: PlanFeature | null;
  limit: number;
  used: number;
  remaining: number;
  scope: QuotaScope;
  /** When the counter resets. `null` for lifetime quotas — they never do. */
  resetsOn: Date | null;
  /** The cheapest plan on which this action exists at all. */
  requiredTier: Tier;
  /** True when the action isn't offered on this tier at all (upsell, not "out of quota"). */
  requiresUpgrade: boolean;
  reason?: string;
};

/** True when the decision came from a quota rather than a capability. */
export function isMeteredDecision(decision: EntitlementDecision): boolean {
  return decision.action !== null;
}

/**
 * Structured error thrown when a user is over quota (and enforcement is on).
 * Carries the paywall payload so routes and actions can render the peak-intent
 * upgrade prompt with the user's real numbers in it.
 */
export class EntitlementError extends Error {
  readonly decision: EntitlementDecision;
  readonly httpStatus = 402;

  constructor(decision: EntitlementDecision) {
    super(entitlementMessage(decision));
    this.name = 'EntitlementError';
    this.decision = decision;
  }
}

/**
 * User-facing text. Note `planName()` rather than the enum: "your always_on
 * plan" is both meaningless and a rule-4 violation (CLAUDE.md).
 */
function entitlementMessage(decision: EntitlementDecision): string {
  if (decision.action === null || decision.requiresUpgrade) {
    return `That's part of ${planName(decision.requiredTier)}, not ${planName(decision.tier)}.`;
  }
  const noun = METERED_ACTION_LABELS[decision.action].toLowerCase();
  return decision.scope === 'lifetime'
    ? `You've used your ${decision.limit} ${noun} on ${planName(decision.tier)}.`
    : `You've used your ${decision.limit} ${noun} for this period.`;
}

export function isEntitlementError(error: unknown): error is EntitlementError {
  return error instanceof EntitlementError;
}

function enforcementEnabled(): boolean {
  // Default: enforce in production, soft everywhere else. Explicit override wins.
  const raw = process.env.ENTITLEMENTS_ENFORCE;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/** Exported so surfaces can say "we're not enforcing this yet" honestly. */
export function entitlementsEnforced(): boolean {
  return enforcementEnabled();
}

/**
 * Lifetime quotas are stored as a period beginning at the epoch. One row, one
 * counter, never reset — which is exactly what "1 lifetime brag doc" means.
 */
const LIFETIME_PERIOD_START = new Date(0);

function quotaWindow(scope: QuotaScope, now?: Date): { start: Date; end: Date | null } {
  if (scope === 'lifetime') return { start: LIFETIME_PERIOD_START, end: null };
  const { start, end } = getCurrentBillingPeriod(now);
  return { start, end };
}

async function usedFor(userId: string, action: MeteredAction, start: Date): Promise<number> {
  const row = await prisma.usageQuota.findUnique({
    where: { userId_periodStart_action: { userId, periodStart: start, action } },
    select: { used: true },
  });
  return row?.used ?? 0;
}

function unmetered(tier: Tier, action: MeteredAction, scope: QuotaScope): EntitlementDecision {
  return {
    allowed: true,
    tier,
    action,
    feature: null,
    limit: UNLIMITED,
    used: 0,
    remaining: UNLIMITED,
    scope,
    resetsOn: null,
    requiredTier: tierRequiredForAction(action),
    requiresUpgrade: false,
  };
}

/** Non-consuming check — safe for fast-fail UX at request entry and paywall display. */
export async function checkEntitlement(
  userId: string,
  action: MeteredAction
): Promise<EntitlementDecision> {
  const tier = await getUserTier(userId);
  return checkEntitlementForTier(userId, tier, action);
}

/** Same as {@link checkEntitlement} when the caller already resolved the tier. */
export async function checkEntitlementForTier(
  userId: string,
  tier: Tier,
  action: MeteredAction
): Promise<EntitlementDecision> {
  const { limit, scope } = meteredLimit(tier, action);
  const requiredTier = tierRequiredForAction(action);

  if (isUnlimited(limit)) return unmetered(tier, action, scope);

  const { start, end } = quotaWindow(scope);

  if (limit <= 0) {
    return {
      allowed: false,
      tier,
      action,
      feature: null,
      limit,
      used: 0,
      remaining: 0,
      scope,
      resetsOn: end,
      requiredTier,
      requiresUpgrade: true,
      reason: 'action not included on this plan',
    };
  }

  const used = await usedFor(userId, action, start);
  const remaining = Math.max(0, limit - used);
  return {
    allowed: used < limit,
    tier,
    action,
    feature: null,
    limit,
    used,
    remaining,
    scope,
    resetsOn: end,
    requiredTier,
    requiresUpgrade: false,
    reason: used < limit ? undefined : 'quota exhausted',
  };
}

/**
 * Check + atomically consume one unit of a metered action.
 *
 * - Unlimited actions: no-op, nothing written.
 * - Metered actions: increments `UsageQuota.used` iff under the limit, via a
 *   conditional `updateMany` (the race-safe idiom used across this codebase).
 *   Over quota with enforcement on throws {@link EntitlementError}; with
 *   enforcement off it records the overage and allows through.
 *
 * Call ONCE per user-initiated action, at the entry point — not inside the
 * pipeline and not on retries. If the action then fails terminally, call
 * {@link refundMeteredAction}.
 */
export async function gateMeteredAction(
  userId: string,
  action: MeteredAction
): Promise<EntitlementDecision> {
  const tier = await getUserTier(userId);
  const { limit, scope } = meteredLimit(tier, action);
  const requiredTier = tierRequiredForAction(action);

  if (isUnlimited(limit)) return unmetered(tier, action, scope);

  const enforce = enforcementEnabled();
  const { start, end } = quotaWindow(scope);

  // Action wholly unavailable on this tier — an upsell, not an exhausted quota.
  if (limit <= 0) {
    const decision: EntitlementDecision = {
      allowed: !enforce,
      tier,
      action,
      feature: null,
      limit,
      used: 0,
      remaining: 0,
      scope,
      resetsOn: end,
      requiredTier,
      requiresUpgrade: true,
      reason: 'action not included on this plan',
    };
    if (enforce) {
      await track(userId, 'quota_exhausted', { action, tier, requiresUpgrade: true });
      throw new EntitlementError(decision);
    }
    await track(userId, 'entitlement_soft_allowed', { action, tier, overBy: 1 });
    return decision;
  }

  // Ensure a row exists for this window, carrying the current limit.
  await prisma.usageQuota.upsert({
    where: { userId_periodStart_action: { userId, periodStart: start, action } },
    create: { userId, periodStart: start, action, used: 0, limit },
    update: { limit },
  });

  // Atomic consume: only increments while strictly under the limit.
  const result = await prisma.usageQuota.updateMany({
    where: { userId, periodStart: start, action, used: { lt: limit } },
    data: { used: { increment: 1 } },
  });
  const consumed = result.count > 0;

  const used = await usedFor(userId, action, start);
  const remaining = Math.max(0, limit - used);

  if (!consumed) {
    const decision: EntitlementDecision = {
      allowed: false,
      tier,
      action,
      feature: null,
      limit,
      used,
      remaining,
      scope,
      resetsOn: end,
      requiredTier,
      requiresUpgrade: false,
      reason: 'quota exhausted',
    };
    if (enforce) {
      await track(userId, 'quota_exhausted', { action, tier, requiresUpgrade: false });
      throw new EntitlementError(decision);
    }
    // Soft mode: record the overage so the usage data stays real, then allow.
    await prisma.usageQuota.updateMany({
      where: { userId, periodStart: start, action },
      data: { used: { increment: 1 } },
    });
    await track(userId, 'entitlement_soft_allowed', {
      action,
      tier,
      overBy: used + 1 - limit,
    });
    return { ...decision, allowed: true, used: used + 1 };
  }

  return {
    allowed: true,
    tier,
    action,
    feature: null,
    limit,
    used,
    remaining,
    scope,
    resetsOn: end,
    requiredTier,
    requiresUpgrade: false,
  };
}

/**
 * Give a consumed unit back after a terminal failure (PRD 06 §8).
 *
 * Idempotent-ish by construction: it floors at zero and never creates a row, so
 * a double refund cannot mint quota. Call it only on failures the user did not
 * get an artifact from — a retry that succeeds must not be free twice.
 *
 * Returns true if a unit was actually returned.
 */
export async function refundMeteredAction(
  userId: string,
  action: MeteredAction,
  options: { tier?: Tier; reason?: string } = {}
): Promise<boolean> {
  const tier = options.tier ?? (await getUserTier(userId));
  const { limit, scope } = meteredLimit(tier, action);
  if (isUnlimited(limit) || limit <= 0) return false;

  const { start } = quotaWindow(scope);
  const result = await prisma.usageQuota.updateMany({
    where: { userId, periodStart: start, action, used: { gt: 0 } },
    data: { used: { decrement: 1 } },
  });
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Snapshot for the plan surface
// ---------------------------------------------------------------------------

export interface UsageLine {
  action: MeteredAction;
  label: string;
  limit: number;
  used: number;
  remaining: number;
  scope: QuotaScope;
  resetsOn: Date | null;
  /** False when the action isn't on this plan at all. */
  available: boolean;
  unlimited: boolean;
}

export interface EntitlementSnapshot {
  tier: Tier;
  subscriptions: SubscriptionState;
  usage: UsageLine[];
  enforced: boolean;
}

/**
 * Everything `/settings/plan` needs, in two queries.
 *
 * Every metered action appears, including the ones the user has never touched
 * and the ones their plan doesn't include. Nobody should discover a limit by
 * hitting it (PRD 06 §6).
 */
export async function getEntitlementSnapshot(
  userId: string,
  now: Date = new Date()
): Promise<EntitlementSnapshot> {
  const subscriptions = await getSubscriptionState(userId, now);
  const tier = subscriptions.tier;

  const { start: periodStart, end: periodEnd } = getCurrentBillingPeriod(now);
  const rows = await prisma.usageQuota.findMany({
    where: {
      userId,
      periodStart: { in: [periodStart, LIFETIME_PERIOD_START] },
      action: { in: [...METERED_ACTIONS] },
    },
    select: { action: true, periodStart: true, used: true },
  });

  const usedBy = new Map<string, number>();
  for (const row of rows) {
    usedBy.set(`${row.action}:${row.periodStart.getTime()}`, row.used);
  }

  const usage: UsageLine[] = METERED_ACTIONS.map((action) => {
    const { limit, scope } = meteredLimit(tier, action);
    const windowStart = scope === 'lifetime' ? LIFETIME_PERIOD_START : periodStart;
    const used = usedBy.get(`${action}:${windowStart.getTime()}`) ?? 0;
    const unlimited = isUnlimited(limit);
    return {
      action,
      label: METERED_ACTION_LABELS[action],
      limit,
      used,
      remaining: unlimited ? UNLIMITED : Math.max(0, limit - used),
      scope,
      resetsOn: scope === 'lifetime' ? null : periodEnd,
      available: unlimited || limit > 0,
      unlimited,
    };
  });

  return { tier, subscriptions, usage, enforced: enforcementEnabled() };
}

// ---------------------------------------------------------------------------
// The proactive downgrade (PRD 06 §5.3)
// ---------------------------------------------------------------------------

/**
 * Why we are offering to turn Search off. `user_initiated` is the case where
 * they found the switch themselves; the other two are us raising it first.
 */
export type DowngradeTrigger = 'offer_received' | 'inactivity_30d' | 'user_initiated';

export interface DowngradeOffer {
  trigger: DowngradeTrigger;
  /** "Congratulations." — the headline is about them, not about us. */
  headline: string;
  /** The user's own fact that justifies the offer. Never a generic nudge. */
  detail: string;
  /** What they keep. The sentence that makes it safe to say yes. */
  keeps: string;
  /** ISO date the Search period ends. They keep it until then; they paid. */
  searchEndsOn: string | null;
}

const OFFER_COOLDOWN_DAYS = 30;
const INACTIVITY_DAYS = 30;

const DOWNGRADE_KEEPS =
  'Your Career plan keeps everything: your log, your record, your packets, and Radar.';

/**
 * Should we offer to turn Search off?
 *
 * Triggers: an application reached `offer`, or 30 days with no apply activity.
 * Only for a live Search subscription that isn't already winding down, and at
 * most once a month so it never reads as nagging.
 *
 * This lives in the entitlement layer rather than the action layer so a
 * scheduled handler can call it directly — it takes a `userId` and must never
 * be exposed as a server action.
 */
export async function evaluateProactiveDowngrade(
  userId: string,
  now: Date = new Date()
): Promise<DowngradeOffer | null> {
  const { search } = await getSubscriptionState(userId, now);
  if (!search?.active || search.cancelAtPeriodEnd) return null;

  const cooldownStart = new Date(now.getTime() - OFFER_COOLDOWN_DAYS * 86_400_000);
  const recentlyAsked = await prisma.funnelEvent.findFirst({
    where: {
      userId,
      type: { in: ['proactive_downgrade_offered', 'proactive_downgrade_declined'] },
      occurredAt: { gte: cooldownStart },
    },
    select: { id: true },
  });
  if (recentlyAsked) return null;

  const searchEndsOn = search.currentPeriodEnd ? search.currentPeriodEnd.toISOString() : null;

  const won = await prisma.applicationWorkspace.findFirst({
    where: { userId, applicationStatus: ApplicationStatus.offer },
    orderBy: { updatedAt: 'desc' },
    select: { companyName: true, roleTitle: true },
  });

  if (won) {
    const role = won.roleTitle ?? 'a role';
    const where = won.companyName ? ` at ${won.companyName}` : '';
    return {
      trigger: 'offer_received',
      headline: 'Congratulations.',
      detail: `You marked ${role}${where} as an offer. You don't need Search any more — want us to turn it off?`,
      keeps: DOWNGRADE_KEEPS,
      searchEndsOn,
    };
  }

  const inactiveSince = new Date(now.getTime() - INACTIVITY_DAYS * 86_400_000);
  const [recentApply, recentGeneration] = await Promise.all([
    prisma.applicationWorkspace.count({ where: { userId, updatedAt: { gte: inactiveSince } } }),
    prisma.generationSession.count({ where: { userId, createdAt: { gte: inactiveSince } } }),
  ]);
  if (recentApply + recentGeneration > 0) return null;

  return {
    trigger: 'inactivity_30d',
    headline: 'Search has been quiet for a month.',
    detail: `You haven't tailored a resume or touched an application in ${INACTIVITY_DAYS} days. Want us to turn Search off?`,
    keeps: DOWNGRADE_KEEPS,
    searchEndsOn,
  };
}

/** Test seam: the epoch marker used for lifetime quotas. */
export const __testing = { LIFETIME_PERIOD_START };
