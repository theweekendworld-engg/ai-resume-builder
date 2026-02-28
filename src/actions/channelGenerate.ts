'use server';

import { auth } from '@clerk/nextjs/server';
import { Channel, GenerationStatus, Prisma, ResumeVersionSource } from '@prisma/client';
import { z } from 'zod';
import { generateSmartResume } from '@/actions/generateResume';
import { prisma } from '@/lib/prisma';
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
  error?: string;
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

function getNextUnansweredQuestion(payload: ClarificationPayload): ClarificationQuestion | undefined {
  return payload.questions.find((question) => !payload.answers[question.id]?.trim());
}

function deriveResumeMetadata(resumeData: ResumeData, atsScore?: number) {
  const targetRole = resumeData.personalInfo.title?.trim() || resumeData.experience[0]?.role?.trim() || null;
  const targetCompany = resumeData.experience[0]?.company?.trim() || null;
  const summaryRaw = resumeData.personalInfo.summary?.trim() || '';
  const atsSummary = summaryRaw ? summaryRaw.slice(0, 180) : null;

  return {
    targetRole,
    targetCompany,
    atsScore: typeof atsScore === 'number' ? atsScore : null,
    atsSummary,
  };
}

async function saveGeneratedResumeForUser(params: {
  userId: string;
  resume: ResumeData;
  atsEstimate?: number;
}): Promise<string> {
  const title = params.resume.personalInfo.fullName?.trim()
    ? `${params.resume.personalInfo.fullName.trim()} Resume`
    : 'Generated Resume';

  const payload = params.resume as unknown as object;

  const resume = await prisma.resume.create({
    data: {
      userId: params.userId,
      title,
      content: payload,
    },
    select: { id: true, title: true },
  });

  const version = await prisma.resumeVersion.create({
    data: {
      userId: params.userId,
      resumeId: resume.id,
      content: payload,
      source: ResumeVersionSource.ai,
    },
    select: { id: true },
  });

  const metadata = deriveResumeMetadata(params.resume, params.atsEstimate);

  await prisma.resume.update({
    where: { id: resume.id },
    data: {
      currentVersionId: version.id,
      targetRole: metadata.targetRole,
      targetCompany: metadata.targetCompany,
      atsScore: metadata.atsScore,
      atsSummary: metadata.atsSummary,
      updatedAt: new Date(),
    },
  });

  return resume.id;
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
  fallbackResumeData?: ResumeData;
  maxQuestions: number;
}): Promise<ChannelGenerateResponse> {
  const smart = await generateSmartResume(params.message, {
    fallbackResumeData: params.fallbackResumeData,
    actorUserId: params.userId,
  });

  const gaps = detectGaps({
    requiredSkills: smart.sources.parsedJD.requiredSkills,
    resume: smart.resume,
  });

  const questions = buildQuestions(gaps, params.maxQuestions);

  const session = await prisma.generationSession.create({
    data: {
      userId: params.userId,
      channel: params.channel,
      jobDescription: params.message,
      parsedJD: smart.sources.parsedJD as Prisma.InputJsonValue,
      matchedItems: {
        projects: smart.sources.projects,
        knowledgeItems: smart.sources.knowledgeItems,
      } as Prisma.InputJsonValue,
      clarifications: {
        questions,
        answers: {},
        gaps,
      } as Prisma.InputJsonValue,
      status: questions.length > 0 ? GenerationStatus.awaiting_clarification : GenerationStatus.completed,
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

  const resumeId = await saveGeneratedResumeForUser({
    userId: params.userId,
    resume: smart.resume,
    atsEstimate: smart.atsEstimate,
  });

  await prisma.generationSession.update({
    where: { id: session.id },
    data: { resultResumeId: resumeId },
  });

  return {
    success: true,
    sessionId: session.id,
    status: 'completed',
    resume: smart.resume,
    resumeId,
    atsEstimate: smart.atsEstimate,
  };
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
    },
  });

  if (!session) {
    return { success: false, error: 'Generation session not found' };
  }

  if (session.status === GenerationStatus.completed) {
    if (!session.resultResumeId) {
      return { success: true, sessionId: session.id, status: 'completed' };
    }

    const resume = await prisma.resume.findFirst({
      where: { id: session.resultResumeId, userId: params.userId },
      include: { currentVersion: true },
    });

    return {
      success: true,
      sessionId: session.id,
      status: 'completed',
      resumeId: session.resultResumeId,
      resume: (resume?.currentVersion?.content ?? resume?.content ?? null) as ResumeData | null ?? undefined,
      atsEstimate: resume?.atsScore ?? undefined,
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

  await prisma.generationSession.update({
    where: { id: session.id },
    data: {
      status: GenerationStatus.generating,
      clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const clarificationContext = buildClarificationContext(mergedPayload);
    const enrichedJobDescription = `${session.jobDescription}${clarificationContext}`;

    const smart = await generateSmartResume(enrichedJobDescription, {
      fallbackResumeData: params.fallbackResumeData,
      focusAreas: mergedPayload.gaps,
      actorUserId: params.userId,
    });

    const resumeId = await saveGeneratedResumeForUser({
      userId: params.userId,
      resume: smart.resume,
      atsEstimate: smart.atsEstimate,
    });

    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.completed,
        resultResumeId: resumeId,
        clarifications: mergedPayload as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      sessionId: session.id,
      status: 'completed',
      resume: smart.resume,
      resumeId,
      atsEstimate: smart.atsEstimate,
    };
  } catch (error) {
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.failed,
      },
    });

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
    fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    maxQuestions: parsed.data.maxQuestions,
  });
}
