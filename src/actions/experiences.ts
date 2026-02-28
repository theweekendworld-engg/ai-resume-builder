'use server';

import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

const ExperienceSchema = z.object({
  company: z.string().min(1).max(300),
  role: z.string().min(1).max(300),
  startDate: z.string().min(1).max(50),
  endDate: z.string().max(50).optional(),
  current: z.boolean().optional(),
  location: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  highlights: z.array(z.string().max(300)).max(100).optional(),
});

const ExperienceUpdateSchema = ExperienceSchema.partial().extend({
  id: z.string().cuid(),
});

async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

export async function listUserExperiences() {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const experiences = await prisma.userExperience.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  return {
    success: true,
    experiences: experiences.map((e) => ({
      ...e,
      highlights: Array.isArray(e.highlights) ? (e.highlights as string[]) : [],
    })),
  };
}

export async function createUserExperience(input: unknown) {
  const parsed = ExperienceSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const experience = await prisma.userExperience.create({
    data: {
      userId,
      company: parsed.data.company,
      role: parsed.data.role,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate ?? '',
      current: parsed.data.current ?? false,
      location: parsed.data.location ?? '',
      description: parsed.data.description ?? '',
      highlights: parsed.data.highlights ?? [],
    },
    select: { id: true },
  });

  return { success: true, experienceId: experience.id };
}

export async function updateUserExperience(input: unknown) {
  const parsed = ExperienceUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const { id, ...rest } = parsed.data;

  await prisma.userExperience.updateMany({
    where: { id, userId },
    data: {
      ...rest,
      highlights: rest.highlights ?? undefined,
    },
  });

  return { success: true };
}

export async function deleteUserExperience(id: string) {
  const parsedId = z.string().cuid().safeParse(id);
  if (!parsedId.success) return { success: false, error: 'Invalid experience id' };

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  await prisma.userExperience.deleteMany({ where: { id: parsedId.data, userId } });
  return { success: true };
}
