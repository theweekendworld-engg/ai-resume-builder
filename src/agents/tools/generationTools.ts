import { z } from 'zod';
import type { ResumeData } from '@/types/resume';
import type { Result } from '@/lib/result';
import { generateSmartResumePipeline, type SmartResumePipelineResult } from '@/actions/generateResume';

const DataCompletenessInput = z.object({
  profile: z.object({
    fullName: z.string().default(''),
    email: z.string().default(''),
    defaultTitle: z.string().default(''),
  }).nullable(),
  experiences: z.array(
    z.object({
      description: z.string().default(''),
    })
  ).default([]),
  projects: z.array(
    z.object({
      description: z.string().default(''),
      embedded: z.boolean().optional(),
    })
  ).default([]),
  education: z.array(z.unknown()).default([]),
});

const LegacyPipelineInput = z.object({
  jobDescription: z.string().min(20),
  userId: z.string().min(1),
  sessionId: z.string().cuid().optional(),
  fallbackResumeData: z.unknown().optional(),
  focusAreas: z.array(z.string()).optional(),
  maxProjects: z.number().int().min(1).max(6).optional(),
});

type DataRequirements = {
  missing: string[];
  questions: string[];
};

export async function checkDataCompletenessTool(input: unknown): Promise<Result<DataRequirements>> {
  const parsed = DataCompletenessInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
      code: 'INVALID_INPUT',
    };
  }

  const data = parsed.data;
  const missing: string[] = [];
  const questions: string[] = [];

  if (!data.profile?.fullName || !data.profile?.email || !data.profile?.defaultTitle) {
    missing.push('profile');
    questions.push('Please complete your profile name, email, and target title.');
  }
  if (data.experiences.length < 1 || !data.experiences.some((exp) => exp.description.trim().length > 20)) {
    missing.push('experiences');
    questions.push('Add at least one experience with a meaningful description.');
  }
  if (data.projects.length < 1 || !data.projects.some((project) => project.description.trim().length > 20)) {
    missing.push('projects');
    questions.push('Add at least one project with concrete outcomes or technical depth.');
  }
  if (data.education.length < 1) {
    missing.push('education');
    questions.push('Add at least one education entry.');
  }

  return {
    success: true,
    data: { missing, questions },
  };
}

export async function runLegacyPipelineTool(input: unknown): Promise<Result<SmartResumePipelineResult>> {
  const parsed = LegacyPipelineInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
      code: 'INVALID_INPUT',
    };
  }

  try {
    const result = await generateSmartResumePipeline(parsed.data.jobDescription, {
      actorUserId: parsed.data.userId,
      actorSessionId: parsed.data.sessionId,
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
      focusAreas: parsed.data.focusAreas,
      maxProjects: parsed.data.maxProjects,
    });

    return { success: true, data: result };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Legacy pipeline failed',
      code: 'PIPELINE_FAILED',
    };
  }
}
