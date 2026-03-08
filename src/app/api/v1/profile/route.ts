import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { authenticateApiKey } from '@/app/api/v1/_utils';

const ProfileInputSchema = z.object({
  userId: z.string().min(1).max(255),
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

export async function POST(req: NextRequest) {
  const authResult = authenticateApiKey(req);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = ProfileInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 }
      );
    }

    const preferences = parseUserGenerationPreferences(parsed.data.preferences) as Prisma.InputJsonValue;
    const profile = await prisma.userProfile.upsert({
      where: { userId: parsed.data.userId },
      create: {
        userId: parsed.data.userId,
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
        preferences,
      },
      update: {
        fullName: parsed.data.fullName ?? undefined,
        email: parsed.data.email ?? undefined,
        phone: parsed.data.phone ?? undefined,
        location: parsed.data.location ?? undefined,
        website: parsed.data.website ?? undefined,
        linkedin: parsed.data.linkedin ?? undefined,
        github: parsed.data.github ?? undefined,
        defaultTitle: parsed.data.defaultTitle ?? undefined,
        defaultSummary: parsed.data.defaultSummary ?? undefined,
        yearsExperience: parsed.data.yearsExperience ?? undefined,
        preferences,
      },
    });

    return NextResponse.json({
      success: true,
      profile: {
        ...profile,
        preferences: parseUserGenerationPreferences(profile.preferences),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update profile' },
      { status: 500 }
    );
  }
}
