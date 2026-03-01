'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { getCurrentBillingPeriod } from '@/lib/usageTracker';

function twoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export type UserUsageStats = {
  success: boolean;
  stats?: {
    monthStart: Date;
    monthEnd: Date;
    totalTokens: number;
    totalCostUsd: number;
    generationsCompleted: number;
    generationsFailed: number;
    pdfsGenerated: number;
  };
  error?: string;
};

export async function getUserUsageStats(): Promise<UserUsageStats> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const period = getCurrentBillingPeriod();

    const [usageAgg, sessionsAgg, pdfCount] = await Promise.all([
      prisma.apiUsageLog.aggregate({
        where: {
          userId,
          createdAt: { gte: period.start, lt: period.end },
          status: 'success',
        },
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.generationSession.groupBy({
        by: ['status'],
        where: {
          userId,
          createdAt: { gte: period.start, lt: period.end },
        },
        _count: { _all: true },
      }),
      prisma.generatedPdf.count({
        where: {
          userId,
          createdAt: { gte: period.start, lt: period.end },
        },
      }),
    ]);

    const completed = sessionsAgg.find((r) => r.status === 'completed')?._count._all ?? 0;
    const failed = sessionsAgg.find((r) => r.status === 'failed')?._count._all ?? 0;

    return {
      success: true,
      stats: {
        monthStart: period.start,
        monthEnd: period.end,
        totalTokens: usageAgg._sum.totalTokens ?? 0,
        totalCostUsd: twoDecimals(usageAgg._sum.costUsd ?? 0),
        generationsCompleted: completed,
        generationsFailed: failed,
        pdfsGenerated: pdfCount,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
