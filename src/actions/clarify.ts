'use server';

import { auth } from '@clerk/nextjs/server';
import { GenerationStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { generateSmartResume } from '@/actions/generateResume';
import { prisma } from '@/lib/prisma';
import type { ResumeData } from '@/types/resume';

const StartClarificationSchema = z.object({
  jobDescription: z.string().min(1).max(50000),
  fallbackResumeData: z.unknown().optional(),
  maxQuestions: z.number().int().min(1).max(5).optional(),
});

const SubmitClarificationsSchema = z.object({
  sessionId: z.string().cuid(),
  answers: z.record(z.string(), z.string().max(1000)).default({}),
  fallbackResumeData: z.unknown().optional(),
});

type ClarificationQuestion = {
  id: string;
  question: string;
  gap: string;
};

type ClarificationPayload = {
  questions: ClarificationQuestion[];
  answers: Record<string, string>;
  gaps: string[];
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectGaps(params: {
  requiredSkills: string[];
  resume: ResumeData;
}): string[] {
  const resumeText = normalizeText(JSON.stringify(params.resume));

  const missingSkills = params.requiredSkills
    .map((skill) => skill.trim())
    .filter(Boolean)
    .filter((skill) => !resumeText.includes(normalizeText(skill)));

  return [...new Set(missingSkills)].slice(0, 5);
}

function buildQuestions(gaps: string[], maxQuestions: number): ClarificationQuestion[] {
  return gaps.slice(0, maxQuestions).map((gap, index) => ({
    id: `q${index + 1}`,
    gap,
    question: `Do you have hands-on experience with ${gap}? Share one concrete project, impact, or metric we can safely include.`,
  }));
}

function readClarificationPayload(value: Prisma.JsonValue | null): ClarificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { questions: [], answers: {}, gaps: [] };
  }

  const obj = value as Record<string, unknown>;
  const questionsRaw = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: ClarificationQuestion[] = questionsRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const q = entry as Record<string, unknown>;
      if (typeof q.id !== 'string' || typeof q.question !== 'string' || typeof q.gap !== 'string') {
        return null;
      }
      return { id: q.id, question: q.question, gap: q.gap };
    })
    .filter((entry): entry is ClarificationQuestion => Boolean(entry));

  const answersRaw = obj.answers && typeof obj.answers === 'object' && !Array.isArray(obj.answers)
    ? (obj.answers as Record<string, unknown>)
    : {};

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(answersRaw)) {
    if (typeof value === 'string') {
      answers[key] = value;
    }
  }

  const gaps = Array.isArray(obj.gaps)
    ? obj.gaps.filter((value): value is string => typeof value === 'string')
    : [];

  return { questions, answers, gaps };
}

function buildClarificationContext(payload: ClarificationPayload): string {
  const lines = payload.questions
    .map((question) => {
      const answer = payload.answers[question.id]?.trim();
      if (!answer) return '';
      return `- Gap: ${question.gap}\n  Answer: ${answer}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return '';

  return `\n\nCandidate clarifications (verified user input):\n${lines.join('\n')}`;
}

export async function startClarificationSession(input: unknown): Promise<{
  success: boolean;
  sessionId?: string;
  status?: 'awaiting_clarification' | 'completed';
  questions?: ClarificationQuestion[];
  resume?: ResumeData;
  atsEstimate?: number;
  error?: string;
}> {
  const parsed = StartClarificationSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };

  try {
    const smart = await generateSmartResume(parsed.data.jobDescription, {
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    });

    const gaps = detectGaps({
      requiredSkills: smart.sources.parsedJD.requiredSkills,
      resume: smart.resume,
    });

    const questions = buildQuestions(gaps, parsed.data.maxQuestions ?? 3);

    const clarifications: ClarificationPayload = {
      questions,
      answers: {},
      gaps,
    };

    const session = await prisma.generationSession.create({
      data: {
        userId,
        jobDescription: parsed.data.jobDescription,
        parsedJD: smart.sources.parsedJD as Prisma.InputJsonValue,
        matchedItems: {
          projects: smart.sources.projects,
          knowledgeItems: smart.sources.knowledgeItems,
        } as Prisma.InputJsonValue,
        clarifications: clarifications as unknown as Prisma.InputJsonValue,
        status: questions.length > 0 ? GenerationStatus.awaiting_clarification : GenerationStatus.completed,
      },
      select: { id: true },
    });

    if (questions.length === 0) {
      return {
        success: true,
        sessionId: session.id,
        status: 'completed',
        resume: smart.resume,
        atsEstimate: smart.atsEstimate,
      };
    }

    return {
      success: true,
      sessionId: session.id,
      status: 'awaiting_clarification',
      questions,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start clarification session',
    };
  }
}

export async function submitClarificationAnswers(input: unknown): Promise<{
  success: boolean;
  sessionId?: string;
  resume?: ResumeData;
  atsEstimate?: number;
  error?: string;
}> {
  const parsed = SubmitClarificationsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };

  try {
    const session = await prisma.generationSession.findFirst({
      where: { id: parsed.data.sessionId, userId },
      select: {
        id: true,
        jobDescription: true,
        clarifications: true,
      },
    });

    if (!session) {
      return { success: false, error: 'Generation session not found' };
    }

    const existingPayload = readClarificationPayload(session.clarifications);
    const mergedPayload: ClarificationPayload = {
      ...existingPayload,
      answers: {
        ...existingPayload.answers,
        ...parsed.data.answers,
      },
    };

    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.generating,
        clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
      },
    });

    const clarificationContext = buildClarificationContext(mergedPayload);
    const enrichedJobDescription = `${session.jobDescription}${clarificationContext}`;

    const smart = await generateSmartResume(enrichedJobDescription, {
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
      focusAreas: mergedPayload.gaps,
    });

    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.completed,
        clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      sessionId: session.id,
      resume: smart.resume,
      atsEstimate: smart.atsEstimate,
    };
  } catch (error) {
    await prisma.generationSession.updateMany({
      where: { id: parsed.data.sessionId, userId },
      data: { status: GenerationStatus.failed },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to submit clarifications',
    };
  }
}
