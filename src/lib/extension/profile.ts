import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import type { ExtensionProfileBundle } from '@/lib/extension/schemas';

export async function getExtensionProfileBundle(userId: string): Promise<ExtensionProfileBundle> {
  const [profile, experiences, education, projects] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        fullName: true,
        email: true,
        phone: true,
        location: true,
        website: true,
        linkedin: true,
        github: true,
        defaultTitle: true,
        defaultSummary: true,
        yearsExperience: true,
        preferences: true,
      },
    }),
    prisma.userExperience.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        company: true,
        role: true,
        startDate: true,
        endDate: true,
        current: true,
        location: true,
        description: true,
        highlights: true,
      },
    }),
    prisma.userEducation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        institution: true,
        degree: true,
        fieldOfStudy: true,
        startDate: true,
        endDate: true,
        current: true,
      },
    }),
    prisma.userProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        githubUrl: true,
        technologies: true,
        source: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    profile: {
      fullName: profile?.fullName ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
      location: profile?.location ?? '',
      website: profile?.website ?? '',
      linkedin: profile?.linkedin ?? '',
      github: profile?.github ?? '',
      defaultTitle: profile?.defaultTitle ?? '',
      defaultSummary: profile?.defaultSummary ?? '',
      yearsExperience: profile?.yearsExperience ?? '',
      preferences: parseUserGenerationPreferences(profile?.preferences),
    },
    experiences: experiences.map((item) => ({
      ...item,
      highlights: Array.isArray(item.highlights) ? (item.highlights as string[]) : [],
    })),
    education,
    projects: projects.map((item) => ({
      ...item,
      technologies: Array.isArray(item.technologies) ? (item.technologies as string[]) : [],
      source: item.source,
    })),
  };
}
