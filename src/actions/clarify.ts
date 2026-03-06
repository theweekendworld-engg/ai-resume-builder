'use server';

import { auth } from '@clerk/nextjs/server';
import { GenerationStatus, KnowledgeType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { generateSmartResumeFromArtifacts, generateSmartResumePipeline } from '@/actions/generateResume';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
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
    const smart = await generateSmartResumePipeline(parsed.data.jobDescription, {
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    });

    const gaps = detectGaps({
      requiredSkills: smart.sources.parsedJD.requiredSkills,
      resume: smart.resume,
    });

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { preferences: true },
    });
    const preferences = parseUserGenerationPreferences(profile?.preferences);
    const questions = preferences.autoGenerate
      ? []
      : buildQuestions(gaps, parsed.data.maxQuestions ?? 3);

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
        matchedProjects: smart.artifacts.matchedProjects as Prisma.InputJsonValue,
        matchedAchievements: smart.artifacts.matchedAchievements as Prisma.InputJsonValue,
        staticData: smart.artifacts.staticData as unknown as Prisma.InputJsonValue,
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
  } catch (error: unknown) {
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
        parsedJD: true,
        matchedProjects: true,
        matchedAchievements: true,
        staticData: true,
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

    const parsedJDSchemaResult = z.object({
      role: z.string().default(''),
      company: z.string().default(''),
      requiredSkills: z.array(z.string()).default([]),
      preferredSkills: z.array(z.string()).default([]),
      experienceLevel: z.string().default(''),
      keyResponsibilities: z.array(z.string()).default([]),
      industryDomain: z.string().default(''),
    }).safeParse(session.parsedJD ?? {});
    const matchedProjects = z.array(z.object({ id: z.string(), score: z.number().default(0) }))
      .safeParse(session.matchedProjects ?? []);
    const matchedAchievements = z.array(z.object({
      id: z.string(),
      score: z.number().default(0),
      type: z.nativeEnum(KnowledgeType),
    })).safeParse(session.matchedAchievements ?? []);
    const staticData = z.object({
      profile: z.object({
        fullName: z.string().default(''),
        email: z.string().default(''),
        phone: z.string().default(''),
        location: z.string().default(''),
        website: z.string().default(''),
        linkedin: z.string().default(''),
        github: z.string().default(''),
        defaultTitle: z.string().default(''),
        defaultSummary: z.string().default(''),
      }).nullable(),
      experiences: z.array(z.object({
        id: z.string(),
        company: z.string().default(''),
        role: z.string().default(''),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
        current: z.boolean().default(false),
        location: z.string().default(''),
        description: z.string().default(''),
      })).default([]),
      education: z.array(z.object({
        id: z.string(),
        institution: z.string().default(''),
        degree: z.string().default(''),
        fieldOfStudy: z.string().default(''),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
        current: z.boolean().default(false),
      })).default([]),
    }).safeParse(session.staticData ?? {});

    const canReuseArtifacts = parsedJDSchemaResult.success && matchedProjects.success && matchedAchievements.success && staticData.success;
    const smart = canReuseArtifacts
      ? await generateSmartResumeFromArtifacts({
        jobDescription: enrichedJobDescription,
        fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
        focusAreas: mergedPayload.gaps,
        actorSessionId: session.id,
        actorUserId: userId,
        artifactSeed: {
          parsedJD: {
            ...parsedJDSchemaResult.data,
            skillGroups: [],
            seniorityLevel: 'mid',
            isRemote: false,
            softSkills: [],
          },
          matchedProjects: matchedProjects.data,
          matchedAchievements: matchedAchievements.data.map((item) => ({
            id: item.id,
            score: item.score,
            type: item.type,
          })),
          staticData: staticData.data,
        },
      })
      : await generateSmartResumePipeline(enrichedJobDescription, {
        fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
        focusAreas: mergedPayload.gaps,
        actorSessionId: session.id,
        actorUserId: userId,
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
  } catch (error: unknown) {
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
