'use server';

import { auth } from '@clerk/nextjs/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getCurrentBillingPeriod, calculateOpenAiCostUsd } from '@/lib/usageTracker';

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
    const load = unstable_cache(
      async () => {
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
        return { usageAgg, sessionsAgg, pdfCount };
      },
      ['usage-stats', userId],
      { revalidate: 60, tags: [`usage:${userId}`] }
    );
    const { usageAgg, sessionsAgg, pdfCount } = await load();

    const completed = sessionsAgg.find((r) => r.status === 'completed')?._count._all ?? 0;
    const failed = sessionsAgg.find((r) => r.status === 'failed')?._count._all ?? 0;

    let totalCostUsd = usageAgg._sum.costUsd ?? 0;
    if (totalCostUsd === 0 && (usageAgg._sum.totalTokens ?? 0) > 0) {
      const logs = await prisma.apiUsageLog.findMany({
        where: {
          userId,
          createdAt: { gte: period.start, lt: period.end },
          status: 'success',
        },
        select: { model: true, inputTokens: true, outputTokens: true },
      });
      totalCostUsd = logs.reduce(
        (sum, log) =>
          sum +
          calculateOpenAiCostUsd({
            model: log.model,
            inputTokens: log.inputTokens,
            outputTokens: log.outputTokens,
          }),
        0
      );
    }

    return {
      success: true,
      stats: {
        monthStart: period.start,
        monthEnd: period.end,
        totalTokens: usageAgg._sum.totalTokens ?? 0,
        totalCostUsd: twoDecimals(totalCostUsd),
        generationsCompleted: completed,
        generationsFailed: failed,
        pdfsGenerated: pdfCount,
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
