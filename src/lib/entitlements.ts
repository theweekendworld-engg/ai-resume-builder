import { Tier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentBillingPeriod } from '@/lib/usageTracker';

/**
 * Entitlement layer (v2 architecture §7).
 *
 * Plan-aware quota enforcement that wraps every *metered* AI action. This is
 * distinct from the flat token/cost cap in `usageTracker.enforceUsageLimit`
 * (which is a runaway-cost safety net): entitlements gate on the *product*
 * plan a user pays for, counted per billing period against `UsageQuota`.
 *
 * Sprint posture (per master plan §8, Trap 1): the *infrastructure* ships now,
 * but the paywall stays SOFT until the Phase-B monetization launch. Set
 * `ENTITLEMENTS_ENFORCE=false` (the default in non-production) to check + record
 * usage without ever blocking — so we accumulate real per-feature usage data
 * before we start turning users away.
 */

export type MeteredAction =
  | 'tailored_generation'
  | 'auto_apply'
  | 'context_interview'
  | 'tier2_grounding'
  // Work Log (PRD 01 §10). Capture itself is NEVER gated — gating it would
  // starve the context graph, which is the asset. `win_draft` meters only the
  // AI structuring call, at a ceiling far above real weekly usage.
  | 'win_draft'
  | 'month_in_review';

const UNLIMITED = Number.POSITIVE_INFINITY;

/** Free-tier tailored-generation allotment, env-overridable (master plan §7.3). */
function freeTailoredLimit(): number {
  const raw = Number(process.env.ENTITLEMENT_FREE_TAILORED_PER_MONTH);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}

function alwaysOnTailoredLimit(): number {
  const raw = Number(process.env.ENTITLEMENT_ALWAYS_ON_TAILORED_PER_MONTH);
  return Number.isFinite(raw) && raw >= 0 ? raw : 15;
}

/** Free-tier AI structuring calls per month. Abuse ceiling, not a product limit. */
function freeWinDraftLimit(): number {
  const raw = Number(process.env.ENTITLEMENT_FREE_WIN_DRAFTS_PER_MONTH);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
}

/**
 * Per-tier, per-action monthly limits. `UNLIMITED` means the action is not
 * metered for that tier (no `UsageQuota` row is written). `0` means the action
 * is not available on that tier at all.
 */
function planLimits(): Record<Tier, Record<MeteredAction, number>> {
  return {
    [Tier.free]: {
      tailored_generation: freeTailoredLimit(),
      auto_apply: 0,
      context_interview: 0,
      tier2_grounding: 0,
      win_draft: freeWinDraftLimit(),
      month_in_review: 0,
    },
    [Tier.always_on]: {
      tailored_generation: alwaysOnTailoredLimit(),
      auto_apply: 0,
      context_interview: 0,
      tier2_grounding: UNLIMITED,
      win_draft: UNLIMITED,
      month_in_review: UNLIMITED,
    },
    [Tier.pro]: {
      tailored_generation: UNLIMITED,
      auto_apply: UNLIMITED,
      context_interview: UNLIMITED,
      tier2_grounding: UNLIMITED,
      win_draft: UNLIMITED,
      month_in_review: UNLIMITED,
    },
    [Tier.team]: {
      tailored_generation: UNLIMITED,
      auto_apply: UNLIMITED,
      context_interview: UNLIMITED,
      tier2_grounding: UNLIMITED,
      win_draft: UNLIMITED,
      month_in_review: UNLIMITED,
    },
  };
}

/** Subscription statuses that actually grant the paid tier. */
const PAID_STATUSES = new Set(['active', 'trialing']);

export type EntitlementDecision = {
  allowed: boolean;
  tier: Tier;
  action: MeteredAction;
  limit: number;
  used: number;
  remaining: number;
  /** True when the action isn't offered on this tier at all (upsell, not "out of quota"). */
  requiresUpgrade: boolean;
  reason?: string;
};

/**
 * Structured error thrown by {@link gateMeteredAction} when a user is over quota
 * (and enforcement is on). Carries the paywall payload so routes/actions can
 * render the peak-intent upgrade prompt (master plan §7.4).
 */
export class EntitlementError extends Error {
  readonly decision: EntitlementDecision;
  readonly httpStatus = 402;

  constructor(decision: EntitlementDecision) {
    super(
      decision.requiresUpgrade
        ? `This feature isn't included in your ${decision.tier} plan.`
        : `You've used your ${decision.limit} ${decision.action.replace(/_/g, ' ')} for this period.`
    );
    this.name = 'EntitlementError';
    this.decision = decision;
  }
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

function isUnlimited(limit: number): boolean {
  return !Number.isFinite(limit);
}

/** Resolve the effective tier for a user (defaults to free). */
export async function getUserTier(userId: string): Promise<Tier> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { tier: true, status: true, currentPeriodEnd: true },
  });
  if (!sub) return Tier.free;
  if (sub.tier === Tier.free) return Tier.free;
  if (!PAID_STATUSES.has(sub.status)) return Tier.free;
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now()) return Tier.free;
  return sub.tier;
}

function limitFor(tier: Tier, action: MeteredAction): number {
  return planLimits()[tier][action];
}

async function usedFor(userId: string, action: MeteredAction): Promise<number> {
  const { start } = getCurrentBillingPeriod();
  const row = await prisma.usageQuota.findUnique({
    where: { userId_periodStart_action: { userId, periodStart: start, action } },
    select: { used: true },
  });
  return row?.used ?? 0;
}

/** Non-consuming check — safe for fast-fail UX at request entry / paywall display. */
export async function checkEntitlement(
  userId: string,
  action: MeteredAction
): Promise<EntitlementDecision> {
  const tier = await getUserTier(userId);
  const limit = limitFor(tier, action);

  if (isUnlimited(limit)) {
    return { allowed: true, tier, action, limit, used: 0, remaining: UNLIMITED, requiresUpgrade: false };
  }
  if (limit <= 0) {
    return {
      allowed: false, tier, action, limit, used: 0, remaining: 0,
      requiresUpgrade: true,
      reason: `${action} is not available on the ${tier} plan`,
    };
  }

  const used = await usedFor(userId, action);
  const remaining = Math.max(0, limit - used);
  return {
    allowed: used < limit,
    tier, action, limit, used, remaining,
    requiresUpgrade: false,
    reason: used < limit ? undefined : 'period quota exhausted',
  };
}

/**
 * Check + atomically consume one unit of a metered action.
 *
 * - Unlimited/paid actions: no-op (nothing metered), returns allowed.
 * - Metered actions: atomically increments `UsageQuota.used` iff under limit,
 *   via a conditional `updateMany` (race-safe). Throws {@link EntitlementError}
 *   when over quota AND enforcement is enabled; otherwise records the overage
 *   (used can exceed limit in soft mode) and allows through.
 *
 * Call this ONCE per user-initiated action, at the entry point — not inside the
 * pipeline core or on retries, to avoid double-counting.
 */
export async function gateMeteredAction(
  userId: string,
  action: MeteredAction
): Promise<EntitlementDecision> {
  const tier = await getUserTier(userId);
  const limit = limitFor(tier, action);

  // Not metered on this tier — allow without touching UsageQuota.
  if (isUnlimited(limit)) {
    return { allowed: true, tier, action, limit, used: 0, remaining: UNLIMITED, requiresUpgrade: false };
  }

  const enforce = enforcementEnabled();

  // Action wholly unavailable on this tier (limit 0 => upsell).
  if (limit <= 0) {
    const decision: EntitlementDecision = {
      allowed: !enforce, tier, action, limit, used: 0, remaining: 0,
      requiresUpgrade: true,
      reason: `${action} is not available on the ${tier} plan`,
    };
    if (enforce) throw new EntitlementError(decision);
    return decision;
  }

  const { start } = getCurrentBillingPeriod();

  // Ensure a quota row exists for this period with the current limit.
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

  const used = await usedFor(userId, action);
  const remaining = Math.max(0, limit - used);

  if (!consumed) {
    const decision: EntitlementDecision = {
      allowed: false, tier, action, limit, used, remaining,
      requiresUpgrade: false,
      reason: 'period quota exhausted',
    };
    if (enforce) throw new EntitlementError(decision);
    // Soft mode: record the overage so we still have real usage data, then allow.
    await prisma.usageQuota.updateMany({
      where: { userId, periodStart: start, action },
      data: { used: { increment: 1 } },
    });
    return { ...decision, allowed: true, used: used + 1 };
  }

  return {
    allowed: true, tier, action, limit,
    used, remaining,
    requiresUpgrade: false,
  };
}
