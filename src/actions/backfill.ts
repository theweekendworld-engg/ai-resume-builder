'use server';

/**
 * The backfill interview's action layer (PRD 07).
 *
 * impl/00 §P-3, in order, every time: Clerk `auth()` → feature flag → zod parse
 * → `gateMeteredAction` once at entry → work → `FunnelEvent` → `Result<T>`.
 * No business logic lives here; it is all in `src/agents/backfillAgent.ts` and
 * `src/agents/tools/backfill.ts`, both of which take an explicit `userId` and
 * are therefore testable against the real database.
 *
 * Two things worth knowing before editing this file:
 *
 * 1. **The session is the metered unit, not the turn.** A ten-question
 *    interview costs one `context_interview`, charged when the session is
 *    created and never when it is resumed. PRD 07 §6 gives the free tier one
 *    lifetime session; charging per turn would end it at question two.
 * 2. **Nothing here confirms a Win.** Every capture lands as a draft and the
 *    closing screen is a review step (CLAUDE.md rule 5). `confirmAllFromSession`
 *    exists because the user pressed a button that says so.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { InterviewStatus, InterviewSubject } from '@prisma/client';
import { err, ok, type Result } from '@/lib/result';
import { isEnabled } from '@/lib/flags';
import { gateMeteredAction, isEntitlementError, type MeteredAction } from '@/lib/entitlements';
import { track } from '@/lib/track';
import { bulkConfirm, listEmployers } from '@/actions/wins';
import {
    BACKFILL_ENTRY_POINTS,
    closingLines,
    estimateProgress,
    finishBackfill,
    runBackfillTurn,
    startBackfill,
    type BackfillTurn,
} from '@/agents/backfillAgent';
import {
    deleteTranscriptTool,
    exportTranscriptTool,
    findResumableSessionTool,
    getSessionTool,
    listSessionsTool,
    type CapturedWin,
    type SessionListEntry,
    type SessionSummary,
    type TranscriptTurn,
} from '@/agents/tools/backfill';

// ───────────────────────────────────────────────────────────────── metering
//
// PRD 07 §6 is explicit: reuse `context_interview`, which already exists in
// `MeteredAction` and was created for exactly this.
//
// Note for C4, who owns `src/lib/plans.ts`: `PLAN_METERED_LIMITS` currently has
// `context_interview: period(0)` on both Free and Career. PRD 07 §6 wants
// `lifetime(1)` on Free and `period(4)` on Career — and the free lifetime one
// is deliberate, because a user who reconstructs one job wants the other three.
// The `lifetime` scope C4 added for the brag doc already expresses it exactly.
// Reported rather than edited; nothing in this file changes when it lands.
const BACKFILL_ACTION: MeteredAction = 'context_interview';

// ─────────────────────────────────────────────────────────────── telemetry
//
// PRD 07 §7. These names are not yet in `SERVER_EVENTS` (`src/lib/track.ts` is
// shared and three agents are writing this wave), so they are declared here and
// cast at the single call site below — the same pattern `src/actions/wins.ts`
// uses for a not-yet-landed `MeteredAction`. Moving them into the union is a
// one-line change and nothing here needs to follow it.
const BACKFILL_EVENTS = {
    started: 'backfill_started',
    questionAnswered: 'backfill_question_answered',
    winCaptured: 'backfill_win_captured',
    abandoned: 'backfill_abandoned',
    completed: 'backfill_completed',
    winsConfirmed: 'backfill_wins_confirmed',
    resumed: 'backfill_resumed',
} as const;

type BackfillEventKey = keyof typeof BACKFILL_EVENTS;

function trackBackfill(
    userId: string,
    event: BackfillEventKey,
    payload: Record<string, unknown> = {},
): Promise<void> {
    return track(userId, BACKFILL_EVENTS[event], { feature: 'backfill', ...payload });
}

// ───────────────────────────────────────────────────────────────── schemas

const SUBJECT_TYPES = Object.values(InterviewSubject) as [InterviewSubject, ...InterviewSubject[]];

const StartSchema = z.object({
    subjectType: z.enum(SUBJECT_TYPES),
    subjectId: z.string().max(64).nullable().optional(),
    subjectLabel: z.string().min(1).max(160),
    entryPoint: z.enum(BACKFILL_ENTRY_POINTS),
});

export type StartBackfillInput = z.infer<typeof StartSchema>;

const AnswerSchema = z
    .object({
        sessionId: z.string().min(1).max(64),
        answer: z.string().max(8_000).optional(),
        dontRemember: z.boolean().optional(),
    })
    .refine((value) => Boolean(value.answer?.trim()) || value.dontRemember === true, {
        message: 'provide an answer, or set dontRemember',
        path: ['answer'],
    });

const SessionIdSchema = z.string().min(1).max(64);

// ───────────────────────────────────────────────────────────────── helpers

type Gate = { userId: string } | { error: Result<never> };

/**
 * Auth + flag, in that order. The flag is checked on every entry point rather
 * than only on the page, because a server action is a public endpoint.
 */
async function gateSurface(): Promise<Gate> {
    const { userId } = await auth();
    if (!userId) return { error: err('Not signed in', 'unauthenticated') };
    if (!(await isEnabled(userId, 'backfill'))) {
        return { error: err('Backfill is not available yet', 'not_available') };
    }
    return { userId };
}

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

// ═══════════════════════════════════════════════════════════════════ 1. start

export type BackfillSessionView = {
    sessionId: string;
    subjectLabel: string;
    subjectType: InterviewSubject;
    status: InterviewStatus;
    turn: BackfillTurn;
    /** Full conversation, so a resumed session renders its own history. */
    transcript: TranscriptTurn[];
    resumed: boolean;
};

export async function startBackfillSession(
    input: StartBackfillInput,
): Promise<Result<BackfillSessionView>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsed = StartSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    const { subjectType, subjectLabel, entryPoint } = parsed.data;
    const subjectId = parsed.data.subjectId ?? null;

    const resumable = await findResumableSessionTool({ userId, subjectType, subjectId });
    const existing = resumable.success ? resumable.data : null;

    // Metered once, at entry, and only for a genuinely new session.
    if (!existing) {
        try {
            await gateMeteredAction(userId, BACKFILL_ACTION);
        } catch (error) {
            if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
            throw error;
        }
    }

    const turn = await startBackfill({ userId, subjectType, subjectId, subjectLabel });
    if (!turn.success) return err(turn.error, turn.code);

    const session = await getSessionTool({ userId, sessionId: turn.data.sessionId });
    if (!session.success) return err(session.error, session.code);

    if (existing) {
        await trackBackfill(userId, 'resumed', {
            daysSincePause: Math.max(
                0,
                Math.round((Date.now() - existing.lastActiveAt.getTime()) / 86_400_000),
            ),
            capturedSoFar: existing.captured.length,
        });
    } else {
        await trackBackfill(userId, 'started', {
            subjectType,
            entryPoint,
            existingWinCount: session.data.captured.length,
        });
    }

    return ok({
        sessionId: session.data.id,
        subjectLabel: session.data.subjectLabel,
        subjectType: session.data.subjectType,
        status: session.data.status,
        turn: turn.data,
        transcript: session.data.transcript,
        resumed: existing !== null,
    });
}

// ═══════════════════════════════════════════════════════════════════ 2. answer

export async function answerBackfill(input: {
    sessionId: string;
    answer?: string;
    dontRemember?: boolean;
}): Promise<Result<BackfillTurn>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsed = AnswerSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const before = await getSessionTool({ userId, sessionId: parsed.data.sessionId });
    if (!before.success) return err(before.error, before.code);
    const capturedBefore = new Set(before.data.captured.map((win) => win.winId));

    const result = await runBackfillTurn({
        userId,
        sessionId: parsed.data.sessionId,
        answer: parsed.data.answer,
        dontRemember: parsed.data.dontRemember,
    });
    if (!result.success) return err(result.error, result.code);

    // §7's two events that matter. The question index is precise on purpose:
    // the abandon-at-question histogram is how a bad question gets found.
    await trackBackfill(userId, 'questionAnswered', {
        index: before.data.questionCount,
        topicType: before.data.transcript.at(-1)?.topic?.split(':')[0] ?? null,
        answerChars: (parsed.data.answer ?? '').length,
        saidDontRemember: parsed.data.dontRemember === true,
    });

    for (const win of result.data.captured) {
        if (capturedBefore.has(win.winId)) continue;
        await trackBackfill(userId, 'winCaptured', {
            index: before.data.questionCount,
            quantified: win.quantified,
            category: win.category,
            sensitivity: win.sensitivity,
        });
    }

    return ok(result.data);
}

// ═══════════════════════════════════════════════════════════ 3. pause / finish

export type BackfillClosing = {
    summary: SessionSummary;
    /** Ready-to-render copy, counted from rows. */
    lines: string[];
    capturedWins: CapturedWin[];
};

export async function pauseBackfillSession(sessionId: string): Promise<Result<void>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    const session = await getSessionTool({ userId, sessionId: parsedId.data });
    if (!session.success) return err(session.error, session.code);

    const result = await finishBackfill({ userId, sessionId: parsedId.data, status: 'paused' });
    if (!result.success) return err(result.error, result.code);

    await trackBackfill(userId, 'abandoned', {
        atQuestion: session.data.questionCount,
        capturedSoFar: session.data.captured.length,
        secondsElapsed: Math.round((Date.now() - session.data.startedAt.getTime()) / 1000),
        deliberate: true,
    });

    return ok(undefined);
}

export async function completeBackfillSession(
    sessionId: string,
): Promise<Result<BackfillClosing>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    const session = await getSessionTool({ userId, sessionId: parsedId.data });
    if (!session.success) return err(session.error, session.code);

    const result = await finishBackfill({ userId, sessionId: parsedId.data, status: 'completed' });
    if (!result.success) return err(result.error, result.code);

    await trackBackfill(userId, 'completed', {
        questions: result.data.questionsAsked,
        winsCaptured: result.data.winsCaptured,
        quantifiedCount: result.data.quantifiedCount,
        durationSec: result.data.durationSec,
        costUsd: session.data.costUsd,
    });

    return ok({
        summary: result.data,
        lines: closingLines(result.data),
        capturedWins: session.data.captured,
    });
}

// ═══════════════════════════════════════════════════════════════ 4. read paths

export type BackfillSubjectOption = {
    subjectType: InterviewSubject;
    subjectId: string | null;
    label: string;
    detail: string;
    /** A live session for this subject, if one exists. */
    resumeSessionId: string | null;
};

export type BackfillEntryData = {
    subjects: BackfillSubjectOption[];
    sessions: SessionListEntry[];
};

/** The `/log/backfill` entry screen: which subjects can be reconstructed. */
export async function getBackfillEntryData(): Promise<Result<BackfillEntryData>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const [employers, sessions] = await Promise.all([listEmployers(), listSessionsTool({ userId })]);
    if (!employers.success) return err(employers.error, employers.code);
    if (!sessions.success) return err(sessions.error, sessions.code);

    const live = new Map(
        sessions.data
            .filter(
                (session) =>
                    session.status === InterviewStatus.active ||
                    session.status === InterviewStatus.paused,
            )
            .map((session) => [`${session.subjectType}:${session.subjectId ?? ''}`, session.id]),
    );

    return ok({
        subjects: employers.data.map((employer) => ({
            subjectType: InterviewSubject.employer,
            subjectId: employer.id,
            label: employer.name,
            detail: employer.role,
            resumeSessionId: live.get(`${InterviewSubject.employer}:${employer.id}`) ?? null,
        })),
        sessions: sessions.data,
    });
}

export type BackfillResumeView = BackfillSessionView & { captured: CapturedWin[] };

/** Rehydrate a session for `/log/backfill/[sessionId]` without asking a question. */
export async function getBackfillSession(sessionId: string): Promise<Result<BackfillResumeView>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    const session = await getSessionTool({ userId, sessionId: parsedId.data });
    if (!session.success) return err(session.error, session.code);

    const lastAgentTurn = [...session.data.transcript].reverse().find((turn) => turn.role === 'agent');
    const unanswered = session.data.transcript.at(-1)?.role === 'agent';

    return ok({
        sessionId: session.data.id,
        subjectLabel: session.data.subjectLabel,
        subjectType: session.data.subjectType,
        status: session.data.status,
        transcript: session.data.transcript,
        captured: session.data.captured,
        resumed: true,
        turn: {
            sessionId: session.data.id,
            acknowledgement: '',
            question: unanswered ? (lastAgentTurn?.content ?? null) : null,
            topic: null,
            progress: estimateProgress(Math.max(0, session.data.questionCount - 1)),
            captured: session.data.captured,
            notices: [],
            done: session.data.status === InterviewStatus.completed,
        },
    });
}

// ═══════════════════════════════════════════════════════ 5. confirm, privacy

/** The closing screen's "Review and confirm all". A user act, never automatic. */
export async function confirmAllFromSession(
    sessionId: string,
): Promise<Result<{ confirmed: number; failed: number }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { userId } = gate;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    const session = await getSessionTool({ userId, sessionId: parsedId.data });
    if (!session.success) return err(session.error, session.code);

    const winIds = session.data.captured.map((win) => win.winId);
    if (winIds.length === 0) return ok({ confirmed: 0, failed: 0 });

    const result = await bulkConfirm(winIds);
    if (!result.success) return err(result.error, result.code);

    await trackBackfill(userId, 'winsConfirmed', {
        confirmed: result.data.ok.length,
        dismissed: 0,
        edited: 0,
    });

    return ok({ confirmed: result.data.ok.length, failed: result.data.failed.length });
}

/**
 * PRD 07 §5.4. The transcript is the most sensitive data in the product and is
 * deletable on its own — the Wins it produced survive, because they are the
 * user's record and deleting a conversation is not the same as retracting it.
 */
export async function deleteBackfillTranscript(
    sessionId: string,
): Promise<Result<{ turnsRemoved: number }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    return deleteTranscriptTool({ userId: gate.userId, sessionId: parsedId.data });
}

export async function exportBackfillTranscript(sessionId: string): Promise<
    Result<{ subjectLabel: string; startedAt: Date; transcript: TranscriptTurn[] }>
> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;

    const parsedId = SessionIdSchema.safeParse(sessionId);
    if (!parsedId.success) return err('Invalid session id', 'invalid_input');

    return exportTranscriptTool({ userId: gate.userId, sessionId: parsedId.data });
}
