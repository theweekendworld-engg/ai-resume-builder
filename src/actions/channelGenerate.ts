'use server';

import { auth } from '@clerk/nextjs/server';
import { Channel, GenerationStatus, PipelineStep, Prisma } from '@prisma/client';
import { z } from 'zod';
import { parseJobDescription } from '@/actions/generateResume';
import { enqueueGenerationSession } from '@/lib/generationQueue';
import { buildPdfDownloadUrl, findLatestGeneratedPdf } from '@/lib/pdfLinks';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import type { ResumeData } from '@/types/resume';

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

const ChannelGenerateSchema = z.object({
  sessionId: z.string().cuid().optional(),
  userId: z.string().min(1).max(255).optional(),
  sourceResumeId: z.string().cuid().optional(),
  channel: z.nativeEnum(Channel),
  externalId: z.string().min(1).max(255).optional(),
  message: z.string().min(1).max(50000),
  fallbackResumeData: z.unknown().optional(),
  maxQuestions: z.number().int().min(1).max(5).default(3),
});

export type ChannelGenerateResponse = {
  success: boolean;
  sessionId?: string;
  status?: 'awaiting_clarification' | 'generating' | 'completed';
  questions?: ClarificationQuestion[];
  nextQuestion?: ClarificationQuestion;
  resume?: ResumeData;
  resumeId?: string;
  atsEstimate?: number;
  pdfId?: string;
  pdfUrl?: string;
  error?: string;
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectGaps(params: {
  requiredSkills: string[];
  contextText: string;
}): string[] {
  const contextText = normalizeText(params.contextText);

  const missingSkills = params.requiredSkills
    .map((skill) => skill.trim())
    .filter(Boolean)
    .filter((skill) => !contextText.includes(normalizeText(skill)));

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

function getNextUnansweredQuestion(payload: ClarificationPayload): ClarificationQuestion | undefined {
  return payload.questions.find((question) => !payload.answers[question.id]?.trim());
}

async function buildGenerationContextText(params: {
  userId: string;
  fallbackResumeData?: ResumeData;
}): Promise<{ contextText: string; autoGenerate: boolean }> {
  const [profile, experiences, projects, knowledge] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId: params.userId },
      select: {
        preferences: true,
        fullName: true,
        email: true,
        defaultTitle: true,
        defaultSummary: true,
      },
    }),
    prisma.userExperience.findMany({
      where: { userId: params.userId },
      select: {
        company: true,
        role: true,
        description: true,
        highlights: true,
      },
      take: 12,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userProject.findMany({
      where: { userId: params.userId },
      select: {
        name: true,
        description: true,
        technologies: true,
        readme: true,
      },
      take: 12,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeItem.findMany({
      where: { userId: params.userId },
      select: {
        title: true,
        content: true,
      },
      take: 8,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const preferences = parseUserGenerationPreferences(profile?.preferences);
  const fallbackText = params.fallbackResumeData ? JSON.stringify(params.fallbackResumeData) : '';
  const experienceText = experiences
    .map((experience) => JSON.stringify(experience))
    .join('\n');
  const projectText = projects
    .map((project) => JSON.stringify(project))
    .join('\n');
  const knowledgeText = knowledge
    .map((item) => `${item.title}\n${item.content}`)
    .join('\n');
  const profileText = JSON.stringify({
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    defaultTitle: profile?.defaultTitle ?? '',
    defaultSummary: profile?.defaultSummary ?? '',
  });

  return {
    contextText: [fallbackText, profileText, experienceText, projectText, knowledgeText].join('\n'),
    autoGenerate: preferences.autoGenerate,
  };
}

async function resolveUserId(params: {
  userId?: string;
  channel: Channel;
  externalId?: string;
}): Promise<string | null> {
  if (params.userId) {
    return params.userId;
  }

  if (params.channel === Channel.web) {
    const { userId } = await auth();
    return userId ?? null;
  }

  if (!params.externalId) return null;

  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_externalId: {
        channel: params.channel,
        externalId: params.externalId,
      },
    },
    select: { userId: true, verified: true },
  });

  if (!identity || !identity.verified) return null;
  return identity.userId;
}

async function startNewSession(params: {
  userId: string;
  channel: Channel;
  message: string;
  sourceResumeId?: string;
  fallbackResumeData?: ResumeData;
  maxQuestions: number;
}): Promise<ChannelGenerateResponse> {
  const [parsedJD, context] = await Promise.all([
    parseJobDescription({
      jobDescription: params.message,
      userId: params.userId,
    }),
    buildGenerationContextText({
      userId: params.userId,
      fallbackResumeData: params.fallbackResumeData,
    }),
  ]);

  const gaps = detectGaps({
    requiredSkills: parsedJD.requiredSkills,
    contextText: context.contextText,
  });

  const questions = context.autoGenerate
    ? []
    : buildQuestions(gaps, params.maxQuestions);

  const session = await prisma.generationSession.create({
    data: {
      userId: params.userId,
      sourceResumeId: params.sourceResumeId,
      channel: params.channel,
      jobDescription: params.message,
      parsedJD: parsedJD as Prisma.InputJsonValue,
      fallbackResume: params.fallbackResumeData
        ? params.fallbackResumeData as unknown as Prisma.InputJsonValue
        : undefined,
      clarifications: {
        questions,
        answers: {},
        gaps,
      } as Prisma.InputJsonValue,
      currentStep: PipelineStep.reuse_check,
      stepStartedAt: new Date(),
      status: questions.length > 0 ? GenerationStatus.awaiting_clarification : GenerationStatus.generating,
    },
    select: { id: true },
  });

  if (questions.length > 0) {
    return {
      success: true,
      sessionId: session.id,
      status: 'awaiting_clarification',
      questions,
      nextQuestion: questions[0],
    };
  }

  try {
    await enqueueGenerationSession(session.id);
    return {
      success: true,
      sessionId: session.id,
      status: 'generating',
    };
  } catch (error: unknown) {
    return {
      success: false,
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Failed to generate resume',
    };
  }
}

async function continueSession(params: {
  userId: string;
  sessionId: string;
  channel: Channel;
  message: string;
  fallbackResumeData?: ResumeData;
}): Promise<ChannelGenerateResponse> {
  const session = await prisma.generationSession.findFirst({
    where: {
      id: params.sessionId,
      userId: params.userId,
      channel: params.channel,
    },
    select: {
      id: true,
      jobDescription: true,
      status: true,
      clarifications: true,
      resultResumeId: true,
      draftResume: true,
      atsScore: true,
    },
  });

  if (!session) {
    return { success: false, error: 'Generation session not found' };
  }

  if (session.status === GenerationStatus.completed) {
    const latestPdf = await findLatestGeneratedPdf({
      userId: params.userId,
      sessionId: session.id,
      resumeId: session.resultResumeId,
    });
    return {
      success: true,
      sessionId: session.id,
      status: 'completed',
      resumeId: session.resultResumeId ?? undefined,
      resume: (session.draftResume as ResumeData | null) ?? undefined,
      atsEstimate: session.atsScore ?? undefined,
      pdfId: latestPdf?.id,
      pdfUrl: latestPdf ? buildPdfDownloadUrl(latestPdf.id) : undefined,
    };
  }

  if (session.status !== GenerationStatus.awaiting_clarification) {
    return {
      success: true,
      sessionId: session.id,
      status: 'generating',
    };
  }

  const payload = readClarificationPayload(session.clarifications);
  const nextQuestion = getNextUnansweredQuestion(payload);

  if (!nextQuestion) {
    return { success: false, error: 'Clarification state is invalid for this session' };
  }

  const mergedPayload: ClarificationPayload = {
    ...payload,
    answers: {
      ...payload.answers,
      [nextQuestion.id]: params.message.trim(),
    },
  };

  const followingQuestion = getNextUnansweredQuestion(mergedPayload);

  if (followingQuestion) {
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      sessionId: session.id,
      status: 'awaiting_clarification',
      questions: mergedPayload.questions,
      nextQuestion: followingQuestion,
    };
  }

  const clarificationContext = buildClarificationContext(mergedPayload);
  const enrichedJobDescription = `${session.jobDescription}${clarificationContext}`;

  await prisma.generationSession.update({
    where: { id: session.id },
    data: {
      status: GenerationStatus.generating,
      currentStep: PipelineStep.reuse_check,
      stepStartedAt: new Date(),
      workflowRunId: null,
      errorMessage: null,
      errorStep: null,
      jobDescription: enrichedJobDescription,
      fallbackResume: params.fallbackResumeData
        ? params.fallbackResumeData as unknown as Prisma.InputJsonValue
        : undefined,
      clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    await enqueueGenerationSession(session.id, { force: true });
    return {
      success: true,
      sessionId: session.id,
      status: 'generating',
    };
  } catch (error: unknown) {
    return {
      success: false,
      sessionId: session.id,
      error: error instanceof Error ? error.message : 'Failed to generate resume after clarifications',
    };
  }
}

export async function processChannelGenerate(input: unknown): Promise<ChannelGenerateResponse> {
  const parsed = ChannelGenerateSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await resolveUserId({
    userId: parsed.data.userId,
    channel: parsed.data.channel,
    externalId: parsed.data.externalId,
  });

  if (!userId) {
    return {
      success: false,
      error: parsed.data.channel === Channel.web
        ? 'Not authenticated'
        : 'Channel identity not linked. Link your account first.',
    };
  }

  if (parsed.data.sessionId) {
    return continueSession({
      userId,
      channel: parsed.data.channel,
      sessionId: parsed.data.sessionId,
      message: parsed.data.message,
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    });
  }

  return startNewSession({
    userId,
    channel: parsed.data.channel,
    message: parsed.data.message,
    sourceResumeId: parsed.data.sourceResumeId,
    fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    maxQuestions: parsed.data.maxQuestions,
  });
}
