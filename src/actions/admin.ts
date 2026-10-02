'use server';

import { prisma } from '@/lib/prisma';
import { requireAdminUserId } from '@/lib/adminAuth';
import { planName } from '@/lib/plans';
import { Prisma, Tier } from '@prisma/client';
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
  const adminId = await requireAdminUserId();

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
  await audit(adminId, 'flag_set', null, { key: parsed.data.key, enabled: parsed.data.enabled, rolloutPercent: parsed.data.rolloutPercent });
  return { success: true };
}

const AllowListSchema = z.object({
  key: z.enum(FEATURE_FLAGS),
  /** A Clerk user id to add or remove. Ignored when `self` is set. */
  entry: z.string().trim().regex(/^[A-Za-z0-9_:-]{3,100}$/, 'That does not look like a user id').optional(),
  /** Add the signed-in admin: the common case, and no id to copy by hand. */
  self: z.boolean().optional(),
  op: z.enum(['add', 'remove']),
});

/**
 * Edit a flag's allow-list: switch a feature on for named users only, before
 * turning it on for everyone. Until 2026-10-02 the panel could only read the
 * list's length, so turning a flag on for yourself meant SQL against production.
 */
export async function setFeatureFlagAllowList(input: {
  key: string;
  entry?: string;
  self?: boolean;
  op: 'add' | 'remove';
}): Promise<{ success: true; allowUserIds: string[] } | { success: false; error: string }> {
  const adminId = await requireAdminUserId();

  const parsed = AllowListSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const target = parsed.data.self ? adminId : parsed.data.entry;
  if (!target) return { success: false, error: 'Enter a user id' };

  const row = await prisma.featureFlag.findUnique({ where: { key: parsed.data.key } });
  const current = Array.isArray(row?.allowUserIds)
    ? (row.allowUserIds as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  const next = parsed.data.op === 'add'
    ? [...new Set([...current, target])]
    : current.filter((value) => value !== target);

  await prisma.featureFlag.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, enabled: false, rolloutPercent: 0, allowUserIds: next, description: `Career OS: ${parsed.data.key}` },
    update: { allowUserIds: next },
  });

  invalidateFlagCache();
  await audit(adminId, `flag_allowlist_${parsed.data.op}`, target, { key: parsed.data.key });
  return { success: true, allowUserIds: next };
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

/* ── Users ──────────────────────────────────────────────────────────────────
 *
 * Every signed-up user, searchable by name, email or id. Clerk is the list of
 * record: a user who never finished onboarding has no UserProfile row and was
 * invisible here before (the page only showed the top users by cost). Our own
 * counts are joined on. If Clerk cannot be reached, the profile table answers
 * instead, and says so.
 */

export type AdminUserRow = {
  userId: string;
  name: string;
  email: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  plan: string;
  wins: number;
  jobs: number;
  chatMessages: number;
  channels: string[];
  /** Flags this user is on the allow-list of. */
  allowedFlags: string[];
};

export type AdminUserSearch = { rows: AdminUserRow[]; total: number; page: number; pageSize: number; source: 'clerk' | 'profiles' };

const UserSearchSchema = z.object({
  q: z.string().trim().max(120).default(''),
  page: z.number().int().min(0).max(1_000).default(0),
});

/** Not exported: a 'use server' module may export only async functions. */
const ADMIN_USERS_PAGE = 25;

export async function searchAdminUsers(input: { q?: string; page?: number } = {}): Promise<AdminUserSearch> {
  await requireAdminUserId();
  const { q, page } = UserSearchSchema.parse(input);

  type Base = { userId: string; name: string; email: string; joinedAt: string | null; lastSeenAt: string | null };
  let base: Base[] = [];
  let total = 0;
  let source: AdminUserSearch['source'] = 'clerk';

  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const list = await client.users.getUserList({
      ...(q ? { query: q } : {}),
      limit: ADMIN_USERS_PAGE,
      offset: page * ADMIN_USERS_PAGE,
      orderBy: '-created_at',
    });
    total = list.totalCount;
    base = list.data.map((user) => ({
      userId: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || '',
      email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '',
      joinedAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      lastSeenAt: user.lastActiveAt ? new Date(user.lastActiveAt).toISOString() : user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
    }));
  } catch (error) {
    console.warn('[admin] Clerk user list unavailable; searching profiles', { error: error instanceof Error ? error.message : String(error) });
    source = 'profiles';
    const where = q
      ? { OR: [
          { fullName: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
          { userId: { contains: q } },
        ] }
      : {};
    const [profiles, count] = await Promise.all([
      prisma.userProfile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * ADMIN_USERS_PAGE, take: ADMIN_USERS_PAGE }),
      prisma.userProfile.count({ where }),
    ]);
    total = count;
    base = profiles.map((p) => ({ userId: p.userId, name: p.fullName, email: p.email, joinedAt: p.createdAt.toISOString(), lastSeenAt: null }));
  }

  const ids = base.map((row) => row.userId);
  if (ids.length === 0) return { rows: [], total, page, pageSize: ADMIN_USERS_PAGE, source };

  const [profiles, subs, wins, jobs, chats, channels, lastCalls, flags] = await Promise.all([
    prisma.userProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, fullName: true, email: true } }),
    prisma.subscription.findMany({ where: { userId: { in: ids }, status: { in: ['active', 'trialing', 'past_due'] } }, select: { userId: true, tier: true } }),
    prisma.win.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'confirmed' }, _count: { _all: true } }),
    prisma.applicationWorkspace.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.chatMessage.groupBy({ by: ['userId'], where: { userId: { in: ids }, role: 'user' }, _count: { _all: true } }),
    prisma.channelIdentity.findMany({ where: { userId: { in: ids }, verified: true }, select: { userId: true, channel: true } }),
    prisma.apiUsageLog.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }),
    prisma.featureFlag.findMany({ select: { key: true, allowUserIds: true } }),
  ]);

  const count = (rows: { userId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.userId, r._count._all]));
  const winCount = count(wins as never);
  const jobCount = count(jobs as never);
  const chatCount = count(chats as never);
  const profileBy = new Map(profiles.map((p) => [p.userId, p]));
  const lastCall = new Map(lastCalls.map((r) => [r.userId, r._max.createdAt]));
  const rank: Record<string, number> = { free: 0, always_on: 1, pro: 2, team: 3 };

  const rows = base.map((row) => {
    const tiers = subs.filter((s) => s.userId === row.userId).map((s) => s.tier);
    const best = tiers.sort((a, b) => rank[b] - rank[a])[0] ?? Tier.free;
    const profile = profileBy.get(row.userId);
    const lastApi = lastCall.get(row.userId);
    const lastSeen = [row.lastSeenAt, lastApi?.toISOString() ?? null].filter(Boolean).sort().at(-1) ?? null;
    return {
      ...row,
      name: row.name || profile?.fullName || '',
      email: row.email || profile?.email || '',
      lastSeenAt: lastSeen,
      plan: planName(best),
      wins: winCount.get(row.userId) ?? 0,
      jobs: jobCount.get(row.userId) ?? 0,
      chatMessages: chatCount.get(row.userId) ?? 0,
      channels: [...new Set(channels.filter((c) => c.userId === row.userId).map((c) => c.channel))],
      allowedFlags: flags
        .filter((f) => Array.isArray(f.allowUserIds) && (f.allowUserIds as unknown[]).includes(row.userId))
        .map((f) => f.key),
    };
  });

  return { rows, total, page, pageSize: ADMIN_USERS_PAGE, source };
}

/* ── Operator actions ──────────────────────────────────────────────────────
 *
 * Every mutation here writes an AdminAction row: who, what, to whom, when
 * (launch audit 2026-10-02: admin changes left no trace at all).
 */

async function audit(adminUserId: string, action: string, targetUserId: string | null, detail: Record<string, unknown> = {}) {
  await prisma.adminAction.create({
    data: { adminUserId, action, targetUserId, detail: detail as Prisma.InputJsonValue },
  });
}

const TargetSchema = z.string().trim().regex(/^[A-Za-z0-9_:-]{3,100}$/);

export async function suspendUser(input: { target: string; reason: string }): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireAdminUserId();
  const target = TargetSchema.safeParse(input.target);
  const reason = z.string().trim().min(3).max(300).safeParse(input.reason);
  if (!target.success || !reason.success) return { success: false, error: 'Give a user id and a reason' };
  if (target.data === adminId) return { success: false, error: 'You cannot suspend yourself' };

  await prisma.userSuspension.upsert({
    where: { userId: target.data },
    create: { userId: target.data, reason: reason.data, byUserId: adminId },
    update: { reason: reason.data, byUserId: adminId },
  });
  // Sign-in too: a Clerk ban revokes sessions. Best effort; the DB row is what
  // stops spend, on every channel.
  let banned = false;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    await (await clerkClient()).users.banUser(target.data);
    banned = true;
  } catch (error) {
    console.warn('[admin] Clerk ban failed; spend is still blocked', { target: target.data, error: String(error) });
  }
  const { forgetSuspension } = await import('@/lib/suspension');
  forgetSuspension(target.data);
  await audit(adminId, 'suspend_user', target.data, { reason: reason.data, clerkBanned: banned });
  return { success: true };
}

export async function unsuspendUser(input: { target: string }): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireAdminUserId();
  const target = TargetSchema.safeParse(input.target);
  if (!target.success) return { success: false, error: 'Invalid user id' };
  await prisma.userSuspension.deleteMany({ where: { userId: target.data } });
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    await (await clerkClient()).users.unbanUser(target.data);
  } catch (error) {
    console.warn('[admin] Clerk unban failed', { target: target.data, error: String(error) });
  }
  const { forgetSuspension } = await import('@/lib/suspension');
  forgetSuspension(target.data);
  await audit(adminId, 'unsuspend_user', target.data);
  return { success: true };
}

/** Clear this period's metered-usage counters for one user (support goodwill). */
export async function resetUserUsage(input: { target: string }): Promise<{ success: boolean; cleared?: number; error?: string }> {
  const adminId = await requireAdminUserId();
  const target = TargetSchema.safeParse(input.target);
  if (!target.success) return { success: false, error: 'Invalid user id' };
  const { count } = await prisma.usageQuota.deleteMany({ where: { userId: target.data } });
  await audit(adminId, 'reset_usage', target.data, { quotaRows: count });
  return { success: true, cleared: count };
}

/** Delete all of a user's data (a deletion request by email). Typed confirmation. */
export async function adminDeleteUserData(input: { target: string; confirm: string }): Promise<{ success: boolean; error?: string; leftovers?: string[] }> {
  const adminId = await requireAdminUserId();
  const target = TargetSchema.safeParse(input.target);
  if (!target.success) return { success: false, error: 'Invalid user id' };
  if (input.confirm !== target.data) return { success: false, error: 'Type the user id to confirm' };
  if (target.data === adminId) return { success: false, error: 'Use Settings to delete your own account' };
  const { deleteUserData } = await import('@/services/accountDeletion');
  const report = await deleteUserData(target.data);
  await audit(adminId, 'delete_user_data', target.data, { rows: report.rows, files: report.files, leftovers: report.leftovers });
  return { success: report.leftovers.length === 0, leftovers: report.leftovers };
}

/** Requeue a dead job, or discard it. */
export async function resolveDeadJob(input: { jobId: string; op: 'retry' | 'discard' }): Promise<{ success: boolean; error?: string }> {
  const adminId = await requireAdminUserId();
  const jobId = z.string().min(1).max(64).safeParse(input.jobId);
  if (!jobId.success) return { success: false, error: 'Invalid job id' };
  const result = input.op === 'retry'
    ? await prisma.job.updateMany({
        where: { id: jobId.data, status: 'dead' },
        data: { status: 'pending', attempts: 0, runAt: new Date(), lastError: null },
      })
    : await prisma.job.deleteMany({ where: { id: jobId.data, status: 'dead' } });
  if (result.count === 0) return { success: false, error: 'That job is no longer dead' };
  await audit(adminId, `dead_job_${input.op}`, null, { jobId: jobId.data });
  return { success: true };
}

export type AdminActionRow = { id: string; adminUserId: string; action: string; targetUserId: string | null; detail: unknown; createdAt: string };

export async function listAdminActions(input: { target?: string } = {}): Promise<AdminActionRow[]> {
  await requireAdminUserId();
  const rows = await prisma.adminAction.findMany({
    where: input.target ? { targetUserId: input.target } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type AdminUserDetail = {
  suspension: { reason: string; byUserId: string; createdAt: string } | null;
  plan: string;
  channels: { channel: string; verified: boolean; createdAt: string }[];
  extensionTokens: { id: string; createdAt: string; expiresAt: string; revoked: boolean }[];
  chat: { role: string; text: string; action: string | null; createdAt: string }[];
  runs: { id: string; status: string; kind: string | null; error: string | null; createdAt: string }[];
  jobs: { company: string | null; role: string | null; status: string; updatedAt: string }[];
  failedGenerations: { id: string; errorStep: string | null; errorMessage: string | null; createdAt: string }[];
  actions: AdminActionRow[];
};

/** Everything an operator needs to answer "what happened to this user". */
export async function getAdminUserDetail(target: string): Promise<AdminUserDetail> {
  await requireAdminUserId();
  const userId = TargetSchema.parse(target);
  const [suspension, subs, channels, tokens, chat, runs, jobs, failed, actions] = await Promise.all([
    prisma.userSuspension.findUnique({ where: { userId } }),
    prisma.subscription.findMany({ where: { userId, status: { in: ['active', 'trialing', 'past_due'] } }, select: { tier: true } }),
    prisma.channelIdentity.findMany({ where: { userId }, select: { channel: true, verified: true, createdAt: true } }),
    prisma.extensionAccessToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, createdAt: true, expiresAt: true, revokedAt: true } }),
    prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, select: { role: true, text: true, action: true, createdAt: true } }),
    prisma.agentRun.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, kind: true, error: true, createdAt: true } }),
    prisma.applicationWorkspace.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 20, select: { companyName: true, roleTitle: true, applicationStatus: true, updatedAt: true } }),
    prisma.generationSession.findMany({ where: { userId, status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, errorStep: true, errorMessage: true, createdAt: true } }),
    listAdminActions({ target: userId }),
  ]);
  const rank: Record<string, number> = { free: 0, always_on: 1, pro: 2, team: 3 };
  const best = subs.map((s) => s.tier).sort((a, b) => rank[b] - rank[a])[0] ?? Tier.free;
  return {
    suspension: suspension ? { reason: suspension.reason, byUserId: suspension.byUserId, createdAt: suspension.createdAt.toISOString() } : null,
    plan: planName(best),
    channels: channels.map((c) => ({ channel: c.channel, verified: c.verified, createdAt: c.createdAt.toISOString() })),
    extensionTokens: tokens.map((t) => ({ id: t.id, createdAt: t.createdAt.toISOString(), expiresAt: t.expiresAt.toISOString(), revoked: Boolean(t.revokedAt) })),
    chat: chat.reverse().map((m) => ({ ...m, text: m.text.slice(0, 400), createdAt: m.createdAt.toISOString() })),
    runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    jobs: jobs.map((j) => ({ company: j.companyName, role: j.roleTitle, status: j.applicationStatus, updatedAt: j.updatedAt.toISOString() })),
    failedGenerations: failed.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
    actions,
  };
}
