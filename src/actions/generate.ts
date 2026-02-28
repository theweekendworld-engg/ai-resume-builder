'use server';

import { z } from 'zod';
import { initialResumeData, ResumeData } from '@/types/resume';
import { generateTailoredResume } from '@/actions/ai';
import { createResume } from '@/actions/resume';
import { saveJobTargetToCloud } from '@/actions/jobTargets';

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

function createDraftResume(input: z.infer<typeof GenerateInputSchema>): ResumeData {
  const base = structuredClone(initialResumeData);

  base.personalInfo.fullName = input.fullName?.trim() || 'Your Name';
  base.personalInfo.email = input.email?.trim() || 'you@example.com';
  base.personalInfo.phone = input.phone?.trim() || '';
  base.personalInfo.linkedin = input.linkedin?.trim() || '';
  base.personalInfo.title = input.role?.trim() || base.personalInfo.title;
  base.personalInfo.summary = input.role?.trim()
    ? `${input.role.trim()} with ${input.yearsExperience?.trim() || 'several'} years of experience delivering measurable outcomes.`
    : base.personalInfo.summary;

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
    let resumeData = createDraftResume(safeInput);

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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate initial resume.',
    };
  }
}
