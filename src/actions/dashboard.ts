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
  totalApplications?: number;
  error?: string;
};

export type ApplicationWorkspaceListResult = {
  success: boolean;
  workspaces?: Array<{
    id: string;
    sourceUrl: string;
    sourcePlatform: string | null;
    companyName: string | null;
    roleTitle: string | null;
    location: string | null;
    applicationStatus: string;
    fitScore: number | null;
    fitSummary: string | null;
    questionCount: number;
    answeredQuestionCount: number;
    selectedResumeId: string | null;
    updatedAt: Date;
    createdAt: Date;
  }>;
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
          totalApplications,
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
          prisma.applicationWorkspace.count({ where: { userId } }),
        ]);
        return {
          profileRow,
          recentResumes,
          totalResumes,
          totalPdfs,
          monthGenerations,
          projectCount,
          totalApplications,
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
      totalApplications,
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
      totalApplications,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function listApplicationWorkspaces(): Promise<ApplicationWorkspaceListResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const workspaces = await prisma.applicationWorkspace.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 25,
      include: {
        _count: {
          select: {
            questions: true,
          },
        },
        questions: {
          select: {
            finalAnswer: true,
          },
        },
      },
    });

    return {
      success: true,
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        sourceUrl: workspace.sourceUrl,
        sourcePlatform: workspace.sourcePlatform,
        companyName: workspace.companyName,
        roleTitle: workspace.roleTitle,
        location: workspace.location,
        applicationStatus: workspace.applicationStatus,
        fitScore: workspace.fitScore,
        fitSummary: workspace.fitSummary,
        questionCount: workspace._count.questions,
        answeredQuestionCount: workspace.questions.filter((question) => Boolean(question.finalAnswer?.trim())).length,
        selectedResumeId: workspace.selectedResumeId,
        updatedAt: workspace.updatedAt,
        createdAt: workspace.createdAt,
      })),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
