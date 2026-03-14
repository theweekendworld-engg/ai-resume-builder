'use server';

import { auth } from '@clerk/nextjs/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { deriveResumeIdentity, extractParsedJDTarget } from '@/lib/resumeIdentity';
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
    const load = unstable_cache(
      async () => {
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
        return {
          profileRow,
          recentResumes,
          totalResumes,
          totalPdfs,
          monthGenerations,
          projectCount,
        };
      },
      ['dashboard-overview', userId],
      { revalidate: 60, tags: [`dashboard:${userId}`] }
    );
    const {
      profileRow,
      recentResumes,
      totalResumes,
      totalPdfs,
      monthGenerations,
      projectCount,
    } = await load();
    const recentResumeSessions = recentResumes.length > 0
      ? await prisma.generationSession.findMany({
        where: {
          userId,
          resultResumeId: { in: recentResumes.map((resume) => resume.id) },
        },
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
        select: {
          resultResumeId: true,
          parsedJD: true,
        },
      })
      : [];
    const parsedTargetByResumeId = new Map<string, ReturnType<typeof extractParsedJDTarget>>();
    for (const session of recentResumeSessions) {
      if (!session.resultResumeId || parsedTargetByResumeId.has(session.resultResumeId)) continue;
      parsedTargetByResumeId.set(session.resultResumeId, extractParsedJDTarget(session.parsedJD));
    }

    const profile: UserProfileDTO | null = profileRow
      ? {
          ...profileRow,
          preferences: parseUserGenerationPreferences(profileRow.preferences),
        }
      : null;

    return {
      success: true,
      profile,
      recentResumes: recentResumes.map((resume) => {
        const identity = deriveResumeIdentity({
          storedTitle: resume.title,
          storedTargetRole: resume.targetRole,
          storedTargetCompany: resume.targetCompany,
          parsedTarget: parsedTargetByResumeId.get(resume.id),
          fallbackTitle: resume.title,
        });
        return {
          ...resume,
          title: identity.title,
          targetRole: identity.targetRole,
          targetCompany: identity.targetCompany,
        };
      }),
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
