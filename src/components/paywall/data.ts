import { WinStatus, type Tier } from '@prisma/client';
import {
  checkEntitlementForTier,
  getUserTier,
  hasFeature,
  type PlanFeature,
} from '@/lib/entitlements';
import { CAREER_PLAN, logHistoryDays, sourceLimit } from '@/lib/plans';
import { prisma } from '@/lib/prisma';

import {
  pw1GapsAnalysis,
  pw2HiddenHistory,
  pw3TailoredExhausted,
  pw7SourceLimit,
  type PaywallContent,
} from './copy';

/**
 * Server-side paywall data (PRD 06 §4).
 *
 * Each loader answers one question: *does this user, right now, have a real
 * reason to see this paywall, and what are their numbers?* They return `null`
 * rather than a generic prompt when either answer is no — a paywall with
 * placeholder data is worse than no paywall.
 *
 * Server only: these hit Postgres. Client components receive the resulting
 * `PaywallContent` as a prop.
 */

/** Suppress a paywall for anyone who already has the thing it sells. */
function alreadyEntitled(tier: Tier, feature: PlanFeature): boolean {
  return hasFeature(tier, feature);
}

/**
 * PW1 — the greyed competency section at the end of a brag doc.
 *
 * Their win count and the level they're being measured against, both real.
 */
export async function loadPw1(userId: string): Promise<PaywallContent | null> {
  const tier = await getUserTier(userId);
  if (alreadyEntitled(tier, 'rubric_mapping')) return null;

  const [winCount, packet] = await Promise.all([
    prisma.win.count({ where: { userId, status: WinStatus.confirmed } }),
    prisma.reviewPacket.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { targetLevel: true },
    }),
  ]);

  const content = pw1GapsAnalysis({ winCount, targetLevel: packet?.targetLevel ?? null });
  return content.hasOwnData ? content : null;
}

/**
 * PW2 — the log has more history than the plan shows.
 *
 * Counts what is hidden, which is only ever a positive number for someone who
 * has been logging for three months. The copy says "saved but hidden" and it is
 * literally true: nothing is deleted, ever.
 */
export async function loadPw2(userId: string): Promise<PaywallContent | null> {
  const tier = await getUserTier(userId);
  const days = logHistoryDays(tier);
  if (!Number.isFinite(days)) return null;

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const hiddenWinCount = await prisma.win.count({
    where: {
      userId,
      status: { in: [WinStatus.confirmed, WinStatus.archived] },
      occurredAt: { lt: cutoff },
    },
  });

  const content = pw2HiddenHistory({ hiddenWinCount });
  return content.hasOwnData ? content : null;
}

/** PW3 — at submit, after the free tailored generations are gone. */
export async function loadPw3(userId: string): Promise<PaywallContent | null> {
  const tier = await getUserTier(userId);
  const decision = await checkEntitlementForTier(userId, tier, 'tailored_generation');
  if (!Number.isFinite(decision.limit) || decision.limit <= 0) return null;
  if (decision.remaining > 0) return null;

  const content = pw3TailoredExhausted({ limit: decision.limit, used: decision.used });
  return content.hasOwnData ? content : null;
}

/** PW7 — connecting a second source on a one-source plan. */
export async function loadPw7(userId: string): Promise<PaywallContent | null> {
  const tier = await getUserTier(userId);
  const limit = sourceLimit(tier);
  if (!Number.isFinite(limit)) return null;

  const connectedSources = await prisma.captureSource.count({
    where: { userId, status: { in: ['active', 'paused', 'error'] } },
  });
  if (connectedSources < limit) return null;

  const content = pw7SourceLimit({
    connectedSources,
    careerSourceLimit: sourceLimit(CAREER_PLAN.tier),
  });
  return content.hasOwnData ? content : null;
}
