'use server';

import { z } from 'zod';
import { initialResumeData, ResumeData } from '@/types/resume';
import { generateTailoredResume } from '@/actions/ai';
import { createResume } from '@/actions/resume';
import { saveJobTargetToCloud } from '@/actions/jobTargets';
import { getUserProfile } from '@/actions/profile';

const GenerateInputSchema = z.object({
  company: z.string().max(300).optional(),
  role: z.string().max(300).optional(),
  jobDescription: z.string().max(50000).optional(),
  fullName: z.string().max(300).optional(),
  email: z.string().max(500).optional(),
  phone: z.string().max(100).optional(),
  linkedin: z.string().max(500).optional(),
  yearsExperience: z.string().max(50).optional(),
  template: z.enum(['ats-simple', 'modern', 'classic']).default('ats-simple'),
});

function createDraftResume(
  input: z.infer<typeof GenerateInputSchema>,
  profile?: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    defaultTitle: string;
    defaultSummary: string;
  }
): ResumeData {
  const base = structuredClone(initialResumeData);

  base.personalInfo.fullName = input.fullName?.trim() || profile?.fullName || '';
  base.personalInfo.email = input.email?.trim() || profile?.email || '';
  base.personalInfo.phone = input.phone?.trim() || profile?.phone || '';
  base.personalInfo.location = profile?.location ?? '';
  base.personalInfo.website = profile?.website ?? '';
  base.personalInfo.linkedin = input.linkedin?.trim() || profile?.linkedin || '';
  base.personalInfo.github = profile?.github ?? '';
  base.personalInfo.title = input.role?.trim() || profile?.defaultTitle || '';
  base.personalInfo.summary = profile?.defaultSummary || '';

  return base;
}

export async function generateInitialResume(input: unknown): Promise<{
  success: boolean;
  resumeId?: string;
  template?: 'ats-simple' | 'modern' | 'classic';
  error?: string;
}> {
  const parsed = GenerateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }

  const safeInput = parsed.data;

  try {
    const profileResult = await getUserProfile();
    const profile = profileResult.success ? profileResult.profile : undefined;

    let resumeData = createDraftResume(safeInput, profile ? {
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      website: profile.website,
      linkedin: profile.linkedin,
      github: profile.github,
      defaultTitle: profile.defaultTitle,
      defaultSummary: profile.defaultSummary,
    } : undefined);

    if (safeInput.jobDescription?.trim()) {
      resumeData = await generateTailoredResume(safeInput.jobDescription, resumeData);
    }

    const title = safeInput.fullName?.trim() ? `${safeInput.fullName.trim()} Resume` : 'Untitled Resume';

    const createResult = await createResume({
      title,
      resumeData,
      source: safeInput.jobDescription?.trim() ? 'ai' : 'manual',
    });

    if (!createResult.success || !createResult.resumeId) {
      return { success: false, error: createResult.error ?? 'Failed to create initial resume.' };
    }

    if (safeInput.jobDescription?.trim()) {
      await saveJobTargetToCloud(safeInput.company ?? '', safeInput.role ?? '', safeInput.jobDescription);
    }

    return {
      success: true,
      resumeId: createResult.resumeId,
      template: safeInput.template,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate initial resume.',
    };
  }
}
