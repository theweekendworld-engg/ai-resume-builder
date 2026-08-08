'use server';

import { prisma } from '@/lib/prisma';
import { requireAdminUserId } from '@/lib/adminAuth';
import {
  ensureFlagsSeeded,
  FEATURE_FLAGS,
  invalidateFlagCache,
  type FeatureFlagKey,
} from '@/lib/flags';
import { entitlementsEnforced } from '@/lib/entitlements';
import {
  COMPARISON_PLANS,
  METERED_ACTIONS,
  METERED_ACTION_LABELS,
  costBudgetUsd,
  freeResumeCap,
  freeTrialDays,
  freeTrialUses,
  meteredLimit,
  tokenBudget,
  type MeteredAction,
} from '@/lib/plans';
import { z } from 'zod';
import {
  getCurrentBillingPeriod,
  upsertAllUserUsageSummaries,
  upsertUserUsageSummary,
} from '@/lib/usageTracker';

const AdminUserIdSchema = z.object({
  userId: z.string().min(1).max(255),
});

type AggregateUsage = {
  calls: number;
  tokens: number;
  costUsd: number;
};

export type AdminDashboardData = {
  usage: {
    today: AggregateUsage;
    week: AggregateUsage;
    month: AggregateUsage;
  };
  operationBreakdown: Array<{
    operation: string;
    calls: number;
    tokens: number;
    costUsd: number;
    avgLatencyMs: number;
  }>;
  generations: {
    completed: number;
    failed: number;
    total: number;
  };
  topUsers: Array<{
    userId: string;
    fullName: string;
    email: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
};

export type AdminUserUsageData = {
  user: {
    userId: string;
    fullName: string;
    email: string;
  };
  currentMonthSummary: {
    periodStart: Date;
    periodEnd: Date;
    totalTokens: number;
    totalCostUsd: number;
    totalGenerations: number;
    totalPdfs: number;
    breakdown: unknown;
  } | null;
  limits: {
    maxMonthlyTokens: number;
    maxMonthlyCostUsd: number;
  };
  operationBreakdown: Array<{
    operation: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
  recentLogs: Array<{
    id: string;
    operation: string;
    provider: string;
    model: string;
    totalTokens: number;
    costUsd: number;
    latencyMs: number;
    status: string;
    createdAt: Date;
    sessionId: string | null;
  }>;
  trend: Array<{
    date: string;
    tokens: number;
    costUsd: number;
    calls: number;
  }>;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function startOfUtcWeek(date: Date): Date {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset, 0, 0, 0, 0));
  return start;
}

function twoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

async function aggregateUsage(from: Date, to: Date): Promise<AggregateUsage> {
  const result = await prisma.apiUsageLog.aggregate({
    where: {
      createdAt: { gte: from, lt: to },
      status: 'success',
    },
    _sum: {
      totalTokens: true,
      costUsd: true,
    },
    _count: {
      _all: true,
    },
  });

  return {
    calls: result._count._all,
    tokens: result._sum.totalTokens ?? 0,
    costUsd: twoDecimals(result._sum.costUsd ?? 0),
  };
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireAdminUserId();

  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const weekStart = startOfUtcWeek(now);
  const month = getCurrentBillingPeriod(now);

  const [today, week, monthAgg, byOperation, generationStatuses, heavyUsers] = await Promise.all([
    aggregateUsage(todayStart, now),
    aggregateUsage(weekStart, now),
    aggregateUsage(month.start, now),
    prisma.apiUsageLog.groupBy({
      by: ['operation'],
      where: {
        createdAt: { gte: month.start, lt: month.end },
      },
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      _avg: {
        latencyMs: true,
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _sum: {
          costUsd: 'desc',
        },
      },
    }),
    prisma.generationSession.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: month.start, lt: month.end },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.apiUsageLog.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: month.start, lt: month.end },
        status: 'success',
      },
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _sum: {
          costUsd: 'desc',
        },
      },
      take: 10,
    }),
  ]);

  const topUserIds = heavyUsers.map((row) => row.userId);
  const profiles = topUserIds.length > 0
    ? await prisma.userProfile.findMany({
      where: { userId: { in: topUserIds } },
      select: {
        userId: true,
        fullName: true,
        email: true,
      },
    })
    : [];
  const profileMap = new Map(profiles.map((profile) => [profile.userId, profile]));

  return {
    usage: {
      today,
      week,
      month: monthAgg,
    },
    operationBreakdown: byOperation.map((row) => ({
      operation: row.operation,
      calls: row._count._all,
      tokens: row._sum.totalTokens ?? 0,
      costUsd: twoDecimals(row._sum.costUsd ?? 0),
      avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
    })),
    generations: {
      completed: generationStatuses.find((row) => row.status === 'completed')?._count._all ?? 0,
      failed: generationStatuses.find((row) => row.status === 'failed')?._count._all ?? 0,
      total: generationStatuses.reduce((acc, row) => acc + row._count._all, 0),
    },
    topUsers: heavyUsers.map((row) => {
      const profile = profileMap.get(row.userId);
      return {
        userId: row.userId,
        fullName: profile?.fullName || '',
        email: profile?.email || '',
        calls: row._count._all,
        tokens: row._sum.totalTokens ?? 0,
        costUsd: twoDecimals(row._sum.costUsd ?? 0),
      };
    }),
  };
}

export async function getAdminUserUsage(userId: string): Promise<AdminUserUsageData> {
  await requireAdminUserId();
  const parsedInput = AdminUserIdSchema.safeParse({ userId });
  if (!parsedInput.success) {
    throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
  }
  const parsedUserId = parsedInput.data.userId;

  const now = new Date();
  const month = getCurrentBillingPeriod(now);
  await upsertUserUsageSummary({ userId: parsedUserId, periodStart: month.start, periodEnd: month.end });

  const [summary, logs] = await Promise.all([
    prisma.userUsageSummary.findUnique({
      where: {
        userId_periodStart: {
          userId: parsedUserId,
          periodStart: month.start,
        },
      },
    }),
    prisma.apiUsageLog.findMany({
      where: {
        userId: parsedUserId,
        createdAt: {
          gte: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)),
          lt: now,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  const dayBuckets = new Map<string, { date: string; tokens: number; costUsd: number; calls: number }>();
  for (const log of logs) {
    const date = `${log.createdAt.getUTCFullYear()}-${String(log.createdAt.getUTCMonth() + 1).padStart(2, '0')}-${String(log.createdAt.getUTCDate()).padStart(2, '0')}`;
    const bucket = dayBuckets.get(date) ?? { date, tokens: 0, costUsd: 0, calls: 0 };
    bucket.tokens += log.totalTokens;
    bucket.costUsd += log.costUsd;
    bucket.calls += 1;
    dayBuckets.set(date, bucket);
  }

  const trend = [...dayBuckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      costUsd: twoDecimals(entry.costUsd),
    }));

  const breakdownMap = new Map<string, { operation: string; calls: number; tokens: number; costUsd: number }>();
  for (const log of logs) {
    const bucket = breakdownMap.get(log.operation) ?? { operation: log.operation, calls: 0, tokens: 0, costUsd: 0 };
    bucket.calls += 1;
    bucket.tokens += log.totalTokens;
    bucket.costUsd += log.costUsd;
    breakdownMap.set(log.operation, bucket);
  }
  const breakdown = [...breakdownMap.values()]
    .sort((a, b) => b.costUsd - a.costUsd)
    .map((row) => ({ ...row, costUsd: twoDecimals(row.costUsd) }));

  const profile = await prisma.userProfile.findUnique({
    where: { userId: parsedUserId },
    select: {
      fullName: true,
      email: true,
      preferences: true,
    },
  });

  return {
    user: {
      userId: parsedUserId,
      fullName: profile?.fullName || '',
      email: profile?.email || '',
    },
    currentMonthSummary: summary
      ? {
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        totalTokens: summary.totalTokens,
        totalCostUsd: twoDecimals(summary.totalCostUsd),
        totalGenerations: summary.totalGenerations,
        totalPdfs: summary.totalPdfs,
        breakdown: summary.breakdown,
      }
      : null,
    limits: {
      maxMonthlyTokens: Number(process.env.USAGE_MAX_MONTHLY_TOKENS_PER_USER ?? 300000),
      maxMonthlyCostUsd: Number(process.env.USAGE_MAX_MONTHLY_COST_USD_PER_USER ?? 10),
    },
    operationBreakdown: breakdown,
    recentLogs: logs.map((log) => ({
      id: log.id,
      operation: log.operation,
      provider: log.provider,
      model: log.model,
      totalTokens: log.totalTokens,
      costUsd: twoDecimals(log.costUsd),
      latencyMs: log.latencyMs,
      status: log.status,
      createdAt: log.createdAt,
      sessionId: log.sessionId,
    })),
    trend,
  };
}

export async function refreshCurrentUsageSummaries(): Promise<void> {
  await requireAdminUserId();
  await upsertAllUserUsageSummaries();
}

/* ── Feature flags ──────────────────────────────────────────────────────────
 *
 * Until now there was no write path. `grep featureFlag src/actions/` returned
 * only test files: the flag table could be changed by hand-written SQL against
 * production and by nothing else, while every sold feature in the product sat
 * behind one. An `/admin` route existed and could not perform the single
 * operation that gates the entire product.
 */

export type FeatureFlagRow = {
  key: FeatureFlagKey;
  enabled: boolean;
  rolloutPercent: number;
  allowUserIds: string[];
  description: string;
  /** False when the row is missing entirely — off for everyone, allow-list included. */
  seeded: boolean;
};

export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  await requireAdminUserId();

  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));

  // Driven by the declared list, not by what happens to be in the table. A
  // flag with no row is the failure this screen exists to make visible, so it
  // has to appear here rather than be absent from the listing.
  return FEATURE_FLAGS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      enabled: row?.enabled ?? false,
      rolloutPercent: row?.rolloutPercent ?? 0,
      allowUserIds: Array.isArray(row?.allowUserIds)
        ? (row.allowUserIds as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : [],
      description: row?.description ?? `Career OS: ${key}`,
      seeded: Boolean(row),
    };
  });
}

const SetFeatureFlagSchema = z.object({
  key: z.enum(FEATURE_FLAGS),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
});

export async function setFeatureFlag(input: {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdminUserId();

  const parsed = SetFeatureFlagSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid flag input' };

  // Upsert rather than update: the two flags this screen was written for had
  // no row, and an update would silently no-op on exactly the case that
  // matters most.
  await prisma.featureFlag.upsert({
    where: { key: parsed.data.key },
    create: {
      key: parsed.data.key,
      enabled: parsed.data.enabled,
      rolloutPercent: parsed.data.rolloutPercent,
      description: `Career OS: ${parsed.data.key}`,
    },
    update: {
      enabled: parsed.data.enabled,
      rolloutPercent: parsed.data.rolloutPercent,
    },
  });

  invalidateFlagCache();
  return { success: true };
}

/** Fills in any declared flag with no row, defaulting to off. */
export async function seedFeatureFlags(): Promise<{ success: boolean; seeded: number }> {
  await requireAdminUserId();

  const before = await prisma.featureFlag.count();
  await ensureFlagsSeeded();
  const after = await prisma.featureFlag.count();

  return { success: true, seeded: after - before };
}

/* ── Effective limits ───────────────────────────────────────────────────────
 *
 * Read-only. Every value here comes from an env var with a code default, so
 * the question "what is actually live right now" has no answer you can get by
 * reading the source — the source only tells you the fallback.
 */

export type EffectiveLimitRow = {
  action: MeteredAction;
  label: string;
  /** One cell per plan, Free / Career / Search. */
  values: string[];
};

export type EffectiveLimits = {
  rows: EffectiveLimitRow[];
  tokens: { plan: string; tokens: string; costUsd: string }[];
  trialUses: number;
  resumeCap: number;
  trialDays: number;
  enforced: boolean;
};

function formatLimit(limit: { limit: number; scope: string; trial?: boolean }): string {
  if (!Number.isFinite(limit.limit)) return 'unlimited';
  if (limit.limit === 0) return '—';
  const scope = limit.scope === 'lifetime' ? 'total' : 'per month';
  return `${limit.limit} ${scope}${limit.trial ? ' (trial)' : ''}`;
}

export async function getEffectiveLimits(): Promise<EffectiveLimits> {
  await requireAdminUserId();

  const tiers = COMPARISON_PLANS.map((plan) => plan.tier);

  return {
    rows: METERED_ACTIONS.map((action) => ({
      action,
      label: METERED_ACTION_LABELS[action],
      values: tiers.map((tier) => formatLimit(meteredLimit(tier, action))),
    })),
    tokens: COMPARISON_PLANS.map((plan) => ({
      plan: plan.name,
      tokens: Number.isFinite(tokenBudget(plan.tier))
        ? tokenBudget(plan.tier).toLocaleString()
        : 'unlimited',
      costUsd: Number.isFinite(costBudgetUsd(plan.tier))
        ? `$${costBudgetUsd(plan.tier)}`
        : 'unlimited',
    })),
    trialUses: freeTrialUses(),
    resumeCap: freeResumeCap(),
    trialDays: freeTrialDays(),
    enforced: entitlementsEnforced(),
  };
}
