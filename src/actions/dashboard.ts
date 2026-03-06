'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { getCurrentBillingPeriod } from '@/lib/usageTracker';
import type { UserProfileDTO } from '@/actions/profile';

export type DashboardOverview = {
  success: boolean;
  profile?: UserProfileDTO | null;
  recentResumes?: Array<{
    id: string;
    title: string;
    updatedAt: Date;
    targetRole: string | null;
    targetCompany: string | null;
    atsScore: number | null;
  }>;
  totalResumes?: number;
  totalPdfs?: number;
  monthGenerations?: number;
  projectCount?: number;
  error?: string;
};

export async function getDashboardOverview(): Promise<DashboardOverview> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const period = getCurrentBillingPeriod();

    const [
      profileRow,
      recentResumes,
      totalResumes,
      totalPdfs,
      monthGenerations,
      projectCount,
    ] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
      }),
      prisma.resume.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          targetRole: true,
          targetCompany: true,
          atsScore: true,
        },
      }),
      prisma.resume.count({ where: { userId } }),
      prisma.generatedPdf.count({ where: { userId } }),
      prisma.generationSession.count({
        where: {
          userId,
          status: 'completed',
          createdAt: { gte: period.start, lt: period.end },
        },
      }),
      prisma.userProject.count({ where: { userId } }),
    ]);

    const profile: UserProfileDTO | null = profileRow
      ? {
          ...profileRow,
          preferences: parseUserGenerationPreferences(profileRow.preferences),
        }
      : null;

    return {
      success: true,
      profile,
      recentResumes,
      totalResumes,
      totalPdfs,
      monthGenerations,
      projectCount,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
