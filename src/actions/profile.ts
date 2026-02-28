'use server';

import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const ProfileInputSchema = z.object({
  fullName: z.string().max(300).optional(),
  email: z.string().max(500).optional(),
  phone: z.string().max(100).optional(),
  location: z.string().max(300).optional(),
  website: z.string().max(500).optional(),
  linkedin: z.string().max(500).optional(),
  github: z.string().max(500).optional(),
  defaultTitle: z.string().max(300).optional(),
  defaultSummary: z.string().max(5000).optional(),
  yearsExperience: z.string().max(50).optional(),
  preferences: z.unknown().optional(),
});

export type UserProfileDTO = {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
  defaultTitle: string;
  defaultSummary: string;
  yearsExperience: string;
  preferences: unknown;
  createdAt: Date;
  updatedAt: Date;
};

async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

export async function getUserProfile(): Promise<{
  success: boolean;
  profile?: UserProfileDTO;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) return { success: true, profile: undefined };

    return { success: true, profile };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function upsertUserProfile(input: unknown): Promise<{
  success: boolean;
  profile?: UserProfileDTO;
  error?: string;
}> {
  const parsed = ProfileInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const preferences = parsed.data.preferences as Prisma.InputJsonValue | undefined;

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...parsed.data,
        preferences,
        fullName: parsed.data.fullName ?? '',
        email: parsed.data.email ?? '',
        phone: parsed.data.phone ?? '',
        location: parsed.data.location ?? '',
        website: parsed.data.website ?? '',
        linkedin: parsed.data.linkedin ?? '',
        github: parsed.data.github ?? '',
        defaultTitle: parsed.data.defaultTitle ?? '',
        defaultSummary: parsed.data.defaultSummary ?? '',
        yearsExperience: parsed.data.yearsExperience ?? '',
      },
      update: {
        ...parsed.data,
        preferences,
      },
    });

    return { success: true, profile };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
