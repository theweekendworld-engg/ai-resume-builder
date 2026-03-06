import { z } from 'zod';
import { calculateATSScore } from '@/actions/ai';
import type { ResumeData } from '@/types/resume';
import type { Result } from '@/lib/result';

const ScoreAtsInput = z.object({
  userId: z.string().min(1),
  sessionId: z.string().cuid().optional(),
  resume: z.unknown(),
  jobDescription: z.string().min(20),
});

const ValidateClaimsInput = z.object({
  resume: z.unknown(),
});

export async function scoreAtsTool(input: unknown): Promise<Result<number>> {
  const parsed = ScoreAtsInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
      code: 'INVALID_INPUT',
    };
  }

  try {
    const score = await calculateATSScore(parsed.data.resume as ResumeData, parsed.data.jobDescription, {
      userId: parsed.data.userId,
      sessionId: parsed.data.sessionId,
      operation: 'ats_scoring',
    });
    return { success: true, data: score.overall };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to score ATS',
      code: 'ATS_FAILED',
    };
  }
}

export async function validateClaimsTool(input: unknown): Promise<Result<{ valid: boolean; notes: string[] }>> {
  const parsed = ValidateClaimsInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
      code: 'INVALID_INPUT',
    };
  }

  const resume = parsed.data.resume as ResumeData;
  const notes: string[] = [];

  if (!resume.personalInfo.summary?.trim()) {
    notes.push('Summary is empty.');
  }
  if (resume.experience.length === 0) {
    notes.push('No experience entries.');
  }
  if (resume.skills.length < 3) {
    notes.push('Skills section is sparse.');
  }

  return {
    success: true,
    data: {
      valid: notes.length === 0,
      notes,
    },
  };
}
