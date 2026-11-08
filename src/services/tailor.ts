/**
 * Scout → a resume tailored for the job Scout just analysed.
 *
 * Scout already holds the posting (ingest text, or the tracker row's copy), the
 * fit, and the tracked job. Before this, turning that into a resume meant
 * copying the job description into /build by hand (audit 2026-09-27, K). Here
 * it is one call:
 *
 *   1. the user's base resume (their most recent non-copy Resume with content)
 *      is copied into a per-job resume linked to the tracker row;
 *   2. generation runs INTO that copy, never over the base;
 *   3. the tracker row points at the copy, so every surface can open it.
 *
 * Idempotent: a generation already in flight for this job is returned, and a
 * re-tailor reuses the same copy. Charging follows `channelGenerate`: the unit
 * is spent when generation starts, after any clarification questions.
 */

import { Channel, GenerationStatus, Prisma } from '@prisma/client';
import { loadRun, readSections } from '@/lib/agent/run';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { SCOUT_AGENT, type IngestData, type JdData } from '@/lib/scout/types';
import { linkSessionToChain, skipAllGenerationQuestions, startGenerationForUser, type ChannelGenerateResponse } from '@/services/channelGenerate';
import type { ResumeData } from '@/types/resume';

export type TailorStart = {
    /** GenerationSession id; progress is the existing generation SSE/notifications. */
    sessionId: string;
    workspaceId: string;
    /** The per-job resume copy this will write into (never the base resume). */
    resumeId: string | null;
    status: 'awaiting_clarification' | 'generating' | 'completed';
    /** Present while `status` is `awaiting_clarification`: the question to ask now. */
    nextQuestion?: { id: string; question: string; gap: string };
    /** Where that question sits: "Question 1 of 3". */
    progress?: { current: number; total: number };
    /**
     * Auto mode only: the skills the skipped questions asked about. Nothing
     * about them is claimed; the apply chain says so in its final message.
     */
    skipped?: string[];
};

export type TailorOptions = {
    /**
     * Run without stopping for questions (the apply chain): every
     * clarification is skipped through the "skip all" path, and the session
     * is tied to the chain so its completion writes the application draft.
     */
    auto?: boolean;
};

type StoredQuestion = { id: string; question: string; gap: string };

function storedQuestions(clarifications: Prisma.JsonValue | null): { questions: StoredQuestion[]; answers: Record<string, unknown> } {
    if (!clarifications || typeof clarifications !== 'object' || Array.isArray(clarifications)) return { questions: [], answers: {} };
    const value = clarifications as { questions?: unknown; answers?: Record<string, unknown> };
    const questions = (Array.isArray(value.questions) ? value.questions : []).filter((raw): raw is StoredQuestion => {
        const q = raw as Partial<StoredQuestion> | null;
        return Boolean(q) && typeof q?.id === 'string' && typeof q?.question === 'string' && typeof q?.gap === 'string';
    });
    const answers = value.answers && typeof value.answers === 'object' ? value.answers : {};
    return { questions, answers };
}

/** "Question 2 of 3" for the first question not yet put to the user. */
function progressOf(clarifications: Prisma.JsonValue | null): TailorStart['progress'] {
    const { questions, answers } = storedQuestions(clarifications);
    if (questions.length === 0) return undefined;
    const answered = questions.filter((q) => answers[q.id] !== undefined).length;
    return { current: Math.min(answered + 1, questions.length), total: questions.length };
}

/** The skills the session's questions asked about and the user did not answer. */
function skippedGaps(clarifications: Prisma.JsonValue | null): string[] {
    const { questions, answers } = storedQuestions(clarifications);
    return questions.filter((q) => !String(answers[q.id] ?? '').trim()).map((q) => q.gap);
}

/** The first question not yet put to the user, from a session's clarifications. */
function pendingQuestion(clarifications: Prisma.JsonValue | null): TailorStart['nextQuestion'] {
    if (!clarifications || typeof clarifications !== 'object' || Array.isArray(clarifications)) return undefined;
    const value = clarifications as { questions?: unknown; answers?: Record<string, unknown> };
    const questions = Array.isArray(value.questions) ? value.questions : [];
    const answers = value.answers && typeof value.answers === 'object' ? value.answers : {};
    for (const raw of questions) {
        const q = raw as { id?: unknown; question?: unknown; gap?: unknown };
        if (typeof q.id === 'string' && typeof q.question === 'string' && typeof q.gap === 'string' && answers[q.id] === undefined) {
            return { id: q.id, question: q.question, gap: q.gap };
        }
    }
    return undefined;
}

const JOB_KINDS = new Set(['job_posting', 'hiring_post']);
const MIN_JD_CHARS = 120;
const STALE_GENERATION_MS = 30 * 60_000;

const CHANNEL: Record<'web' | 'telegram' | 'whatsapp', Channel> = {
    web: Channel.web,
    telegram: Channel.telegram,
    whatsapp: Channel.whatsapp,
};

function statusOf(status: GenerationStatus): TailorStart['status'] {
    if (status === GenerationStatus.awaiting_clarification) return 'awaiting_clarification';
    if (status === GenerationStatus.completed) return 'completed';
    return 'generating';
}

function copyTitle(jd: JdData | null, workspace: { roleTitle: string | null; companyName: string | null }): string {
    const role = jd?.role || workspace.roleTitle || 'Tailored resume';
    const company = jd?.company || workspace.companyName;
    return (company ? `${role} — ${company}` : role).slice(0, 200);
}

/**
 * Tailor a resume for the job a Scout run analysed, using the JD Scout already
 * stored. Creates a per-job copy of the user's base resume and links it to the
 * tracker row. Charges `tailored_generation` at the point of value.
 */
export async function tailorResumeForRun(
    userId: string,
    runId: string,
    channel: 'web' | 'telegram' | 'whatsapp',
    options: TailorOptions = {},
): Promise<Result<TailorStart>> {
    const run = await loadRun(runId);
    if (!run || run.userId !== userId || run.agent !== SCOUT_AGENT) return err('Not found', 'not_found');
    if (!run.kind || !JOB_KINDS.has(run.kind)) {
        return err('Only job links and hiring posts can be turned into a resume.', 'not_applicable');
    }

    const workspace = await prisma.applicationWorkspace.findFirst({
        where: { userId, scoutRunId: runId },
        select: { id: true, jobDescription: true, roleTitle: true, companyName: true },
    });
    if (!workspace) {
        return err('This job is still being added to your tracker. Try again in a moment.', 'not_ready');
    }

    const sections = readSections(run);
    const ingest = sections.ingest?.status === 'ok' ? (sections.ingest.data as IngestData) : null;
    const jd = sections.jd?.status === 'ok' ? (sections.jd.data as JdData) : null;
    const jobDescription = (ingest?.text || workspace.jobDescription || '').trim();
    if (jobDescription.length < MIN_JD_CHARS) {
        return err('There is not enough of the job description to tailor against. Paste the full posting in the resume builder.', 'no_job_description');
    }

    // Already in flight for this job: hand back the same session.
    const active = await prisma.generationSession.findFirst({
        where: {
            userId,
            workspaceId: workspace.id,
            // Waiting on questions is resumable indefinitely; a run that says
            // it is generating but has not moved in 30 minutes has died, and
            // must not block tailoring this job forever.
            OR: [
                { status: GenerationStatus.awaiting_clarification },
                {
                    status: { in: [GenerationStatus.pending, GenerationStatus.generating] },
                    updatedAt: { gte: new Date(Date.now() - STALE_GENERATION_MS) },
                },
            ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, sourceResumeId: true, clarifications: true },
    });
    if (active) {
        if (options.auto) {
            await linkSessionToChain(userId, active.id, { runId });
            return autoContinue(userId, active.id, workspace.id, active.sourceResumeId, active.status === GenerationStatus.awaiting_clarification
                ? null
                : { success: true, sessionId: active.id, status: statusOf(active.status) });
        }
        const status = statusOf(active.status);
        return ok({
            sessionId: active.id,
            workspaceId: workspace.id,
            resumeId: active.sourceResumeId,
            status,
            ...(status === 'awaiting_clarification'
                ? { nextQuestion: pendingQuestion(active.clarifications), progress: progressOf(active.clarifications) }
                : {}),
        });
    }

    // The per-job copy: reuse this job's, or make one from the base.
    let copy = await prisma.resume.findFirst({
        where: { userId, workspaceId: workspace.id, NOT: { baseResumeId: null } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, content: true },
    });
    if (!copy) {
        const base = await prisma.resume.findFirst({
            where: { userId, baseResumeId: null, NOT: { content: { equals: Prisma.DbNull } } },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, content: true },
        });
        if (!base) {
            return err('Upload your resume first. Tailoring starts from the resume you already have.', 'no_base_resume');
        }
        copy = await prisma.resume.create({
            data: {
                userId,
                title: copyTitle(jd, workspace),
                content: base.content as Prisma.InputJsonValue,
                baseResumeId: base.id,
                workspaceId: workspace.id,
                targetRole: jd?.role || workspace.roleTitle || null,
                targetCompany: jd?.company || workspace.companyName || null,
            },
            select: { id: true, content: true },
        });
    }

    await prisma.applicationWorkspace.updateMany({
        where: { id: workspace.id, userId },
        data: { selectedResumeId: copy.id },
    });

    const started = await startGenerationForUser({
        userId,
        channel: CHANNEL[channel],
        message: jobDescription,
        sourceResumeId: copy.id,
        workspaceId: workspace.id,
        fallbackResumeData: (copy.content as unknown as ResumeData | null) ?? undefined,
        ...(options.auto ? { chain: { runId } } : {}),
    });
    if (!started.success || !started.sessionId || !started.status) {
        return err(started.error ?? 'Could not start tailoring.', started.code ?? 'tailor_failed');
    }
    if (options.auto) {
        return autoContinue(userId, started.sessionId, workspace.id, copy.id, started.status === 'awaiting_clarification' ? null : started);
    }
    const total = started.questions?.length ?? 0;
    return ok({
        sessionId: started.sessionId,
        workspaceId: workspace.id,
        resumeId: copy.id,
        status: started.status,
        ...(started.nextQuestion ? { nextQuestion: started.nextQuestion } : {}),
        ...(started.status === 'awaiting_clarification' && total > 0 ? { progress: { current: 1, total } } : {}),
    });
}

/**
 * Auto mode: skip whatever questions the session has (the "skip all" path,
 * which charges and enqueues exactly once), and report which skills they
 * asked about. `started` is the session's state when there was nothing to skip.
 */
async function autoContinue(
    userId: string,
    sessionId: string,
    workspaceId: string,
    resumeId: string | null,
    started: ChannelGenerateResponse | null,
): Promise<Result<TailorStart>> {
    const result = started ?? await skipAllGenerationQuestions(userId, sessionId);
    if (!result.success || !result.status) {
        return err(result.error ?? 'Could not start tailoring.', result.code ?? 'tailor_failed');
    }
    const session = await prisma.generationSession.findFirst({
        where: { id: sessionId, userId },
        select: { clarifications: true },
    });
    return ok({
        sessionId,
        workspaceId,
        resumeId,
        status: result.status,
        skipped: skippedGaps(session?.clarifications ?? null),
    });
}
