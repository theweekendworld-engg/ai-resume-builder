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
import { gateMeteredAction, isEntitlementError, refundMeteredAction } from '@/lib/entitlements';
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
  /**
   * The unit is waived for this session (a regeneration of a recent one).
   * Carried here because the charge happens when generation STARTS, which for
   * a session with questions is in `continueSession`, long after the decision.
   */
  free?: boolean;
};

/** Where `continueSession` appends the answers to the JD. */
export const CLARIFICATION_MARKER = '\n\nCandidate clarifications (verified user input):';

/**
 * The job description as the user wrote it, without the clarification block
 * the pipeline appended. The editor used to reload the enriched text, so the
 * user saw their own answers pasted into the posting.
 */
export function stripClarificationBlock(jobDescription: string): string {
  const index = jobDescription.indexOf(CLARIFICATION_MARKER);
  return index >= 0 ? jobDescription.slice(0, index) : jobDescription;
}

/** A free regeneration is allowed for this many copies of one posting in a day. */
export const FREE_REGEN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FREE_REGEN_MAX_PER_WINDOW = 3;

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
  /**
   * Regenerate from an earlier session of the SAME user. Within 24h, and at
   * most `FREE_REGEN_MAX_PER_WINDOW` copies of that posting, the new session
   * is not charged: redoing a result you did not like is not a second job.
   */
  regenerateOfSessionId: z.string().cuid().optional(),
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
  /**
   * Machine-readable reason on failure: `entitlement_required`,
   * `empty_profile`, `enqueue_failed`, `not_found`. Lets each surface show
   * the right next step (a plan link, an upload CTA) instead of raw text.
   */
  code?: string;
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

  return { questions, answers, gaps, ...(obj.free === true ? { free: true } : {}) };
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

/**
 * Is there anything to tailor FROM? A user who skipped history in onboarding
 * and pasted a JD used to spend one of ten free generations on a resume built
 * from nothing (audit 2026-09-27, D). Checked before any charge.
 */
export async function hasGenerationContext(userId: string, fallbackResumeData?: ResumeData): Promise<boolean> {
  if (fallbackResumeData && (fallbackResumeData.experience?.length || fallbackResumeData.projects?.length)) return true;
  const [experiences, projects, resumes] = await Promise.all([
    prisma.userExperience.count({ where: { userId } }),
    prisma.userProject.count({ where: { userId } }),
    prisma.resume.count({ where: { userId, NOT: { content: { equals: Prisma.DbNull } } } }),
  ]);
  return experiences + projects + resumes > 0;
}

type Enqueuer = (sessionId: string, options?: { force?: boolean }) => Promise<unknown>;
let enqueuer: Enqueuer = enqueueGenerationSession;

/**
 * Test seam. The local queue runs the real pipeline on a detached timer, which
 * in a test would fire model and LaTeX calls after the test has finished.
 */
export const __testing = {
  setEnqueuer(next: Enqueuer | null) {
    enqueuer = next ?? enqueueGenerationSession;
  },
};

type Charge = { ok: true } | { ok: false; error: string; code: string };

/** One `tailored_generation` unit, or the plan's own refusal. */
async function chargeGeneration(userId: string): Promise<Charge> {
  try {
    await gateMeteredAction(userId, 'tailored_generation');
    return { ok: true };
  } catch (error: unknown) {
    if (isEntitlementError(error)) return { ok: false, error: error.message, code: 'entitlement_required' };
    throw error;
  }
}

async function refundGeneration(userId: string, reason: string): Promise<void> {
  await refundMeteredAction(userId, 'tailored_generation', { reason }).catch((error: unknown) => {
    console.error('[channelGenerate] refund failed', { userId, reason, error: String(error) });
  });
}

/**
 * Hand a session to the queue, and undo the charge if that fails: the user
 * must never pay for a generation that did not start.
 */
async function enqueueCharged(params: {
  userId: string;
  sessionId: string;
  charged: boolean;
  force?: boolean;
}): Promise<ChannelGenerateResponse> {
  try {
    await enqueuer(params.sessionId, params.force ? { force: true } : undefined);
    return { success: true, sessionId: params.sessionId, status: 'generating' };
  } catch (error: unknown) {
    if (params.charged) await refundGeneration(params.userId, 'generation_enqueue_failed');
    await prisma.generationSession.updateMany({
      where: { id: params.sessionId, userId: params.userId },
      data: {
        status: GenerationStatus.failed,
        errorMessage: error instanceof Error ? error.message : 'Failed to start generation',
      },
    });
    return {
      success: false,
      sessionId: params.sessionId,
      code: 'enqueue_failed',
      error: 'Could not start the generation. Nothing was charged — try again in a minute.',
    };
  }
}

/** Free when regenerating one of the user's own sessions from the last day. */
async function isFreeRegeneration(userId: string, seedSessionId: string | undefined): Promise<boolean> {
  if (!seedSessionId) return false;
  const seed = await prisma.generationSession.findFirst({
    where: { id: seedSessionId, userId },
    select: { createdAt: true, jobDescription: true },
  });
  if (!seed) return false;
  const since = new Date(Date.now() - FREE_REGEN_WINDOW_MS);
  if (seed.createdAt < since) return false;
  const baseJd = stripClarificationBlock(seed.jobDescription);
  const recent = await prisma.generationSession.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { jobDescription: true },
  });
  const sameJob = recent.filter((session) => stripClarificationBlock(session.jobDescription) === baseJd).length;
  return sameJob < FREE_REGEN_MAX_PER_WINDOW;
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
  /** The tracked job this generation is for (Scout / tracker). Owner-checked. */
  workspaceId?: string;
  /** Waive the unit (a recent regeneration). */
  free?: boolean;
}): Promise<ChannelGenerateResponse> {
  // Nothing to tailor from: say so BEFORE anything is charged or parsed.
  if (!(await hasGenerationContext(params.userId, params.fallbackResumeData))) {
    return {
      success: false,
      code: 'empty_profile',
      error: 'Add your experience first: upload your resume or add a role to your profile, so there is something real to tailor.',
    };
  }

  // A workspace id is only honoured when it is the caller's own.
  const workspaceId = params.workspaceId
    ? (await prisma.applicationWorkspace.findFirst({
      where: { id: params.workspaceId, userId: params.userId },
      select: { id: true },
    }))?.id
    : undefined;

  // Charged when generation STARTS, not when it is requested. A session with
  // questions is charged in `continueSession`, once they are answered or
  // skipped, so abandoning at the questions costs nothing (audit §F).
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
      workspaceId,
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
        ...(params.free ? { free: true } : {}),
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

  if (!params.free) {
    const charge = await chargeGeneration(params.userId);
    if (!charge.ok) {
      await prisma.generationSession.update({
        where: { id: session.id },
        data: { status: GenerationStatus.failed, errorMessage: charge.error },
      });
      return { success: false, sessionId: session.id, error: charge.error, code: charge.code };
    }
  }
  return enqueueCharged({ userId: params.userId, sessionId: session.id, charged: !params.free });
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

  // Claim the transition with a conditional update: two submits of the last
  // answer (a double tap, a Telegram retry) start — and charge — once.
  const claimed = await prisma.generationSession.updateMany({
    where: { id: session.id, status: GenerationStatus.awaiting_clarification },
    data: { status: GenerationStatus.generating },
  });
  if (claimed.count === 0) {
    return { success: true, sessionId: session.id, status: 'generating' };
  }

  // The unit is charged here: generation is about to start.
  if (!mergedPayload.free) {
    const charge = await chargeGeneration(params.userId);
    if (!charge.ok) {
      // Put the session back where it was, so the answers are not lost and
      // the user can continue after upgrading.
      await prisma.generationSession.update({
        where: { id: session.id },
        data: {
          status: GenerationStatus.awaiting_clarification,
          clarifications: payload as unknown as Prisma.InputJsonValue,
        },
      });
      return { success: false, sessionId: session.id, error: charge.error, code: charge.code };
    }
  }

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

  return enqueueCharged({ userId: params.userId, sessionId: session.id, charged: !mergedPayload.free, force: true });
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
    free: await isFreeRegeneration(userId, parsed.data.regenerateOfSessionId),
  });
}

/**
 * Start a generation for a user the CALLER has already established, linked to
 * a tracked job. For `src/services/tailor.ts`; never reachable from a request
 * without that caller's own authentication.
 */
export async function startGenerationForUser(params: {
  userId: string;
  channel: Channel;
  message: string;
  sourceResumeId: string;
  workspaceId: string;
  fallbackResumeData?: ResumeData;
  maxQuestions?: number;
}): Promise<ChannelGenerateResponse> {
  return startNewSession({
    userId: params.userId,
    channel: params.channel,
    message: params.message,
    sourceResumeId: params.sourceResumeId,
    workspaceId: params.workspaceId,
    fallbackResumeData: params.fallbackResumeData,
    maxQuestions: params.maxQuestions ?? 3,
  });
}
