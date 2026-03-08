'use server';

import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

const EducationSchema = z.object({
  institution: z.string().min(1).max(300),
  degree: z.string().min(1).max(300),
  fieldOfStudy: z.string().max(300).optional(),
  startDate: z.string().min(1).max(50),
  endDate: z.string().max(50).optional(),
  current: z.boolean().optional(),
});

const EducationUpdateSchema = EducationSchema.partial().extend({
  id: z.string().cuid(),
});

async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

export async function listUserEducation() {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const education = await prisma.userEducation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  return { success: true, education };
}

export async function createUserEducation(input: unknown) {
  const parsed = EducationSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const record = await prisma.userEducation.create({
    data: {
      userId,
      institution: parsed.data.institution,
      degree: parsed.data.degree,
      fieldOfStudy: parsed.data.fieldOfStudy ?? '',
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate ?? '',
      current: parsed.data.current ?? false,
    },
    select: { id: true },
  });

  return { success: true, educationId: record.id };
}

export async function updateUserEducation(input: unknown) {
  const parsed = EducationUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const { id, ...rest } = parsed.data;

  await prisma.userEducation.updateMany({
    where: { id, userId },
    data: rest,
  });

  return { success: true };
}

export async function deleteUserEducation(id: string) {
  const parsedId = z.string().cuid().safeParse(id);
  if (!parsedId.success) return { success: false, error: 'Invalid education id' };

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  await prisma.userEducation.deleteMany({ where: { id: parsedId.data, userId } });
  return { success: true };
}
