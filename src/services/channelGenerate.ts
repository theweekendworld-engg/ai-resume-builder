/**
 * Channel resume generation: plain server code, NOT a server action.
 *
 * Formerly `src/actions/channelGenerate.ts` under `'use server'`, where
 * `processChannelGenerate` resolved the user from `input.userId` (returned
 * as-is) or from `channel + externalId` (a Telegram chat id). It is imported by
 * browser components, so any signed-in user could generate as ANY other user,
 * reading their whole record. Callers here must already have established who
 * the user is: the Telegram webhook (secret-verified), the API-key route, or
 * the session wrapper in `src/actions/channelGenerate.ts`.
 */

import { auth } from '@clerk/nextjs/server';
import { Channel, GenerationStatus, PipelineStep, Prisma } from '@prisma/client';
import { z } from 'zod';
import { parseJobDescription } from '@/actions/generateResume';
import { gateMeteredAction, isEntitlementError } from '@/lib/entitlements';
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
  message: z.string().max(50000).optional(),
  fallbackResumeData: z.unknown().optional(),
  maxQuestions: z.number().int().min(1).max(5).default(3),
  /**
   * Move past a clarification question without answering it.
   *
   * `message` is `min(1)`, so before this the only way out of a question was
   * to type something — and the thing a person types when they have nothing
   * to say is a guess. On a product whose one promise is that nothing on the
   * resume is invented, forcing a text box is not a small UX wrinkle: it is
   * the product asking to be lied to.
   *
   * `skipAll` skips the remaining questions in one go, for someone who wants
   * the draft now and will fix it in the editor.
   */
  skip: z.boolean().optional(),
  skipAll: z.boolean().optional(),
})
  // A message is still required for everything that is not a skip — the
  // opening request carries the job description, and answering a question
  // carries the answer.
  .refine((value) => Boolean(value.message?.trim()) || value.skip === true || value.skipAll === true, {
    message: 'message is required unless the question is being skipped',
    path: ['message'],
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

/**
 * The next question that has not been PUT TO the user yet.
 *
 * Keyed on presence rather than on the answer being non-empty. A skip records
 * an empty string, which means "asked, declined" — and the previous
 * truthiness check treated that as still-unanswered, so a skipped question
 * would have been handed straight back and the wizard would have looped on it
 * forever.
 *
 * `buildClarificationContext` drops empty answers when it assembles the
 * model's context, so a declined question still contributes nothing.
 */
function getNextUnansweredQuestion(payload: ClarificationPayload): ClarificationQuestion | undefined {
  return payload.questions.find((question) => payload.answers[question.id] === undefined);
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
  // Entitlement gate: one tailored-generation unit per initiated generation.
  try {
    await gateMeteredAction(params.userId, 'tailored_generation');
  } catch (error: unknown) {
    if (isEntitlementError(error)) {
      return { success: false, error: error.message };
    }
    throw error;
  }

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
  message?: string;
  fallbackResumeData?: ResumeData;
  skip?: boolean;
  skipAll?: boolean;
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

  /*
   * A skipped question is recorded as an EMPTY answer, not left unanswered.
   *
   * `getNextUnansweredQuestion` walks for the first question with no entry, so
   * leaving the key absent would hand the same question back forever.
   * `buildClarificationContext` already drops empty answers when it assembles
   * the model's context, so an empty string means exactly what it should:
   * asked, declined, contributes nothing.
   */
  const skipped = params.skip === true || params.skipAll === true;
  const mergedPayload: ClarificationPayload = {
    ...payload,
    answers: {
      ...payload.answers,
      ...(params.skipAll
        ? Object.fromEntries(payload.questions.map((question) => [question.id, '']))
        : { [nextQuestion.id]: skipped ? '' : (params.message ?? '').trim() }),
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
      skip: parsed.data.skip,
      skipAll: parsed.data.skipAll,
      fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    });
  }

  return startNewSession({
    userId,
    channel: parsed.data.channel,
    // Guaranteed by the schema refine: only a skip may omit it, and a skip
    // requires an existing session.
    message: parsed.data.message ?? '',
    sourceResumeId: parsed.data.sourceResumeId,
    fallbackResumeData: parsed.data.fallbackResumeData as ResumeData | undefined,
    maxQuestions: parsed.data.maxQuestions,
  });
}
