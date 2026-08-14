/**
 * Backfill interview tools (PRD 07 §5.1).
 *
 * Same shape as the other modules under `src/agents/tools/`: each export is a
 * `*Tool` function that zod-parses its own input, takes an explicit `userId`,
 * and returns a `Result<T>` rather than throwing. Explicit `userId` is what
 * makes them testable against the real database without standing up Clerk —
 * the Clerk hop happens once, in `src/actions/backfill.ts`.
 *
 * There is no model call in this file. Every one of them lives in
 * `src/agents/backfillAgent.ts` and goes through `generateStructured`.
 *
 * The rule this file exists to enforce: **a Win is persisted the moment it is
 * captured, not when the session ends.** Killing the browser mid-interview must
 * lose nothing (PRD 07 §9).
 */

import { z } from 'zod';
import {
    EvidenceKind,
    GroundState,
    InterviewStatus,
    InterviewSubject,
    Prisma,
    WinCategory,
    WinSensitivity,
    WinSource,
    WinStatus,
    type InterviewSession,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { extractQuantities, flattenQuantities, isQuantitySupported } from '@/lib/ai/guard';
import { createWinFromText } from '@/actions/wins';
import { parseMergeProposalCode } from '@/services/winDrafting';
import { WIN_CLAIM_TYPE, WIN_SUBJECT_TYPE, parseExperienceDate } from '@/services/winGraph';
import type { ImpactInput } from '@/actions/wins.types';

// ═══════════════════════════════════════════════════════════════════ constants

/** PRD 07 §5.4: a transcript is the most sensitive row in the product. */
export const TRANSCRIPT_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

/** `Win.sourceRef` / `Evidence.sourceRef` prefix. One namespace, one grep. */
export const BACKFILL_SOURCE_PREFIX = 'backfill:';

/** The rare categories the log is usually missing (PRD 07 §3.2 priority 4). */
export const RARE_CATEGORIES: readonly WinCategory[] = [
    WinCategory.influenced,
    WinCategory.grew,
    WinCategory.saved,
];

// ═══════════════════════════════════════════════════════════════════ wire types

export type TranscriptRole = 'agent' | 'user';

export type TranscriptTurn = {
    role: TranscriptRole;
    content: string;
    /** ISO 8601. Stored as a string because the column is `Json`. */
    at: string;
    /** The topic key the agent was pursuing. Absent on user turns. */
    topic?: string;
    /** User pressed "I don't remember" rather than typing. */
    dontRemember?: boolean;
};

/** One card in the right rail. */
export type CapturedWin = {
    winId: string;
    title: string;
    category: WinCategory;
    sensitivity: WinSensitivity;
    quantified: boolean;
    /** Pre-formatted headline figure, e.g. `800ms → 180ms`. Null when absent. */
    metricLabel: string | null;
    /** Which question produced it — the abandon-at-question histogram needs it. */
    questionIndex: number;
    capturedAt: string;
};

export type SubjectContext = {
    subjectType: InterviewSubject;
    subjectId: string | null;
    subjectLabel: string;
    /** Employer/project detail when the subject resolves to a stored row. */
    role: string | null;
    highlights: string[];
    description: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    /** Wins already on the record for this subject, newest first. */
    existingWins: { id: string; title: string; category: WinCategory; quantified: boolean }[];
    existingWinCount: number;
    /**
     * False when the subject has no stored row and no Wins. The agent must open
     * with the anchor question and must not pretend to remember anything
     * (PRD 07 §8, "subject has zero prior context").
     */
    hasPriorContext: boolean;
};

export type GraphGaps = {
    /** Categories with no Win at all for this subject, rarest first. */
    missingCategories: WinCategory[];
    /** Wins for this subject carrying no `ImpactMetric`. */
    unquantifiedWins: { id: string; title: string }[];
    /** Wins whose narrative never says who else was affected. */
    unscopedWins: { id: string; title: string }[];
    quantifiedCount: number;
    totalCount: number;
};

export type SessionSnapshot = {
    id: string;
    userId: string;
    subjectType: InterviewSubject;
    subjectId: string | null;
    subjectLabel: string;
    status: InterviewStatus;
    transcript: TranscriptTurn[];
    askedTopics: string[];
    captured: CapturedWin[];
    questionCount: number;
    costUsd: number;
    startedAt: Date;
    lastActiveAt: Date;
    completedAt: Date | null;
    expiresAt: Date;
};

export type SessionSummary = {
    winsCaptured: number;
    quantifiedCount: number;
    crossTeamCount: number;
    confidentialCount: number;
    questionsAsked: number;
    durationSec: number;
    /** What the record held before this session — the before/after line. */
    priorWinCount: number;
    priorHighlightCount: number;
    subjectLabel: string;
    /** Highlights whose stored wording the user's framing beats. Never applied. */
    proposedHighlightDiffs: { existing: string; proposed: string }[];
};

// ═══════════════════════════════════════════════════════════════════ json codecs
//
// Prisma hands `Json` columns back as `JsonValue`. Every read goes through one
// of these so a row written by an older shape degrades to empty rather than
// throwing inside a route handler.

function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

function asRecordArray(value: Prisma.JsonValue | null | undefined): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    const out: Record<string, unknown>[] = [];
    for (const entry of value) {
        if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
            out.push(entry as Record<string, unknown>);
        }
    }
    return out;
}

export function decodeTranscript(value: Prisma.JsonValue | null | undefined): TranscriptTurn[] {
    return asRecordArray(value).flatMap((entry) => {
        const role = entry.role === 'agent' || entry.role === 'user' ? entry.role : null;
        if (!role || typeof entry.content !== 'string') return [];
        return [
            {
                role,
                content: entry.content,
                at: typeof entry.at === 'string' ? entry.at : new Date(0).toISOString(),
                ...(typeof entry.topic === 'string' ? { topic: entry.topic } : {}),
                ...(entry.dontRemember === true ? { dontRemember: true } : {}),
            } satisfies TranscriptTurn,
        ];
    });
}

/**
 * `winIds` holds the rail, not bare ids. The column name is fixed by the
 * orchestrator-owned schema; the shape inside it is ours, and the rail needs a
 * title and a metric to render without an N+1 join on every poll. Bare-string
 * rows written by an earlier shape still decode.
 */
export function decodeCaptured(value: Prisma.JsonValue | null | undefined): CapturedWin[] {
    if (!Array.isArray(value)) return [];
    const out: CapturedWin[] = [];
    for (const entry of value) {
        if (typeof entry === 'string') {
            out.push({
                winId: entry,
                title: '',
                category: WinCategory.shipped,
                sensitivity: WinSensitivity.shareable,
                quantified: false,
                metricLabel: null,
                questionIndex: 0,
                capturedAt: new Date(0).toISOString(),
            });
            continue;
        }
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const record = entry as Record<string, unknown>;
        if (typeof record.winId !== 'string') continue;
        out.push({
            winId: record.winId,
            title: typeof record.title === 'string' ? record.title : '',
            category: isWinCategory(record.category) ? record.category : WinCategory.shipped,
            sensitivity: isWinSensitivity(record.sensitivity)
                ? record.sensitivity
                : WinSensitivity.shareable,
            quantified: record.quantified === true,
            metricLabel: typeof record.metricLabel === 'string' ? record.metricLabel : null,
            questionIndex: typeof record.questionIndex === 'number' ? record.questionIndex : 0,
            capturedAt:
                typeof record.capturedAt === 'string' ? record.capturedAt : new Date(0).toISOString(),
        });
    }
    return out;
}

function isWinCategory(value: unknown): value is WinCategory {
    return typeof value === 'string' && value in WinCategory;
}

function isWinSensitivity(value: unknown): value is WinSensitivity {
    return typeof value === 'string' && value in WinSensitivity;
}

export function toSnapshot(row: InterviewSession): SessionSnapshot {
    return {
        id: row.id,
        userId: row.userId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectLabel: row.subjectLabel,
        status: row.status,
        transcript: decodeTranscript(row.transcript),
        askedTopics: asStringArray(row.askedTopics),
        captured: decodeCaptured(row.winIds),
        questionCount: row.questionCount,
        costUsd: row.costUsd,
        startedAt: row.startedAt,
        lastActiveAt: row.lastActiveAt,
        completedAt: row.completedAt,
        expiresAt: row.expiresAt,
    };
}

// ═══════════════════════════════════════════════════════════════════ 0. session

const SubjectTypes = Object.values(InterviewSubject) as [InterviewSubject, ...InterviewSubject[]];

const StartSessionInput = z.object({
    userId: z.string().min(1),
    subjectType: z.enum(SubjectTypes),
    subjectId: z.string().max(64).nullable().optional(),
    subjectLabel: z.string().min(1).max(160),
});

/**
 * One active session per subject. Re-entering an employer the user already
 * started resumes it rather than forking a second transcript — otherwise
 * `askedTopics` cannot do its job and question one repeats forever.
 */
export async function startSessionTool(input: unknown): Promise<Result<SessionSnapshot>> {
    const parsed = StartSessionInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, subjectType, subjectLabel } = parsed.data;
    const subjectId = parsed.data.subjectId ?? null;

    const now = new Date();
    const resumable = await prisma.interviewSession.findFirst({
        where: {
            userId,
            subjectType,
            subjectId,
            status: { in: [InterviewStatus.active, InterviewStatus.paused] },
            expiresAt: { gt: now },
        },
        orderBy: { lastActiveAt: 'desc' },
    });

    if (resumable) {
        const reopened =
            resumable.status === InterviewStatus.active
                ? resumable
                : await prisma.interviewSession.update({
                    where: { id: resumable.id },
                    data: { status: InterviewStatus.active },
                });
        return ok(toSnapshot(reopened));
    }

    const created = await prisma.interviewSession.create({
        data: {
            userId,
            subjectType,
            subjectId,
            subjectLabel,
            status: InterviewStatus.active,
            expiresAt: new Date(now.getTime() + TRANSCRIPT_TTL_DAYS * DAY_MS),
        },
    });
    return ok(toSnapshot(created));
}

const SessionRefInput = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1).max(64),
});

const FindResumableInput = z.object({
    userId: z.string().min(1),
    subjectType: z.enum(SubjectTypes),
    subjectId: z.string().max(64).nullable().optional(),
});

/**
 * Is there already a live session for this subject?
 *
 * The action layer asks before it meters. Resuming an interview the user
 * already paid a session for must not charge them a second one — and PRD 07 §6
 * gives the free tier exactly one, so getting this wrong is the difference
 * between the best demo the product has and a paywall on question two.
 */
export async function findResumableSessionTool(
    input: unknown,
): Promise<Result<SessionSnapshot | null>> {
    const parsed = FindResumableInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const row = await prisma.interviewSession.findFirst({
        where: {
            userId: parsed.data.userId,
            subjectType: parsed.data.subjectType,
            subjectId: parsed.data.subjectId ?? null,
            status: { in: [InterviewStatus.active, InterviewStatus.paused] },
            expiresAt: { gt: new Date() },
        },
        orderBy: { lastActiveAt: 'desc' },
    });
    return ok(row ? toSnapshot(row) : null);
}

export type SessionListEntry = {
    id: string;
    subjectType: InterviewSubject;
    subjectId: string | null;
    subjectLabel: string;
    status: InterviewStatus;
    questionCount: number;
    capturedCount: number;
    lastActiveAt: Date;
    expiresAt: Date;
};

/** Everything the entry screen needs: what is resumable, and what is finished. */
export async function listSessionsTool(input: unknown): Promise<Result<SessionListEntry[]>> {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const rows = await prisma.interviewSession.findMany({
        where: { userId: parsed.data.userId },
        orderBy: { lastActiveAt: 'desc' },
        take: 40,
    });

    return ok(
        rows.map((row) => ({
            id: row.id,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            subjectLabel: row.subjectLabel,
            status: row.status,
            questionCount: row.questionCount,
            capturedCount: decodeCaptured(row.winIds).length,
            lastActiveAt: row.lastActiveAt,
            expiresAt: row.expiresAt,
        })),
    );
}

export async function getSessionTool(input: unknown): Promise<Result<SessionSnapshot>> {
    const parsed = SessionRefInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const row = await prisma.interviewSession.findFirst({
        where: { id: parsed.data.sessionId, userId: parsed.data.userId },
    });
    if (!row) return err('Interview session not found', 'not_found');
    if (row.expiresAt.getTime() <= Date.now() && row.status !== InterviewStatus.completed) {
        return err('That session has expired', 'expired');
    }
    return ok(toSnapshot(row));
}

const PersistTurnInput = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1).max(64),
    appendTurns: z
        .array(
            z.object({
                role: z.enum(['agent', 'user']),
                content: z.string().max(8_000),
                at: z.string().optional(),
                topic: z.string().max(120).optional(),
                dontRemember: z.boolean().optional(),
            }),
        )
        .max(4)
        .default([]),
    askTopics: z.array(z.string().max(120)).max(12).default([]),
    questionCountDelta: z.number().int().min(0).max(2).default(0),
    costUsdDelta: z.number().min(0).default(0),
    status: z.enum(Object.values(InterviewStatus) as [InterviewStatus, ...InterviewStatus[]]).optional(),
});

/**
 * The single writer for session state. Reads the row, merges, writes back —
 * one place to reason about, and `askedTopics` de-duplicates here rather than
 * in three call sites.
 */
export async function persistTurnTool(input: unknown): Promise<Result<SessionSnapshot>> {
    const parsed = PersistTurnInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, sessionId } = parsed.data;

    const row = await prisma.interviewSession.findFirst({ where: { id: sessionId, userId } });
    if (!row) return err('Interview session not found', 'not_found');

    const now = new Date();
    const transcript = [
        ...decodeTranscript(row.transcript),
        ...parsed.data.appendTurns.map((turn) => ({
            role: turn.role,
            content: turn.content,
            at: turn.at ?? now.toISOString(),
            ...(turn.topic ? { topic: turn.topic } : {}),
            ...(turn.dontRemember ? { dontRemember: true } : {}),
        })),
    ];
    const askedTopics = [...new Set([...asStringArray(row.askedTopics), ...parsed.data.askTopics])];

    const updated = await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
            transcript: transcript as unknown as Prisma.InputJsonValue,
            askedTopics: askedTopics as unknown as Prisma.InputJsonValue,
            questionCount: row.questionCount + parsed.data.questionCountDelta,
            costUsd: row.costUsd + parsed.data.costUsdDelta,
            ...(parsed.data.status
                ? {
                    status: parsed.data.status,
                    ...(parsed.data.status === InterviewStatus.completed
                        ? { completedAt: now }
                        : {}),
                }
                : {}),
        },
    });

    return ok(toSnapshot(updated));
}

// ═══════════════════════════════════════════════════════ 1. getSubjectContext

const SubjectContextInput = z.object({
    userId: z.string().min(1),
    subjectType: z.enum(SubjectTypes),
    subjectId: z.string().max(64).nullable().optional(),
    subjectLabel: z.string().min(1).max(160),
});

export async function getSubjectContextTool(input: unknown): Promise<Result<SubjectContext>> {
    const parsed = SubjectContextInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, subjectType, subjectLabel } = parsed.data;
    const subjectId = parsed.data.subjectId ?? null;

    let role: string | null = null;
    let highlights: string[] = [];
    let description = '';
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    let subjectRowExists = false;

    if (subjectType === InterviewSubject.employer && subjectId) {
        const experience = await prisma.userExperience.findFirst({
            where: { id: subjectId, userId },
        });
        if (experience) {
            subjectRowExists = true;
            role = experience.role;
            highlights = asStringArray(experience.highlights);
            description = experience.description;
            periodStart = parseExperienceDate(experience.startDate, 'start');
            periodEnd = experience.current ? null : parseExperienceDate(experience.endDate, 'end');
        }
    }

    if (subjectType === InterviewSubject.project && subjectId) {
        const project = await prisma.userProject.findFirst({ where: { id: subjectId, userId } });
        if (project) {
            subjectRowExists = true;
            description = project.description;
        }
    }

    // Wins for the subject: by employer/project id when we have one, otherwise
    // by the period the label describes. A competency subject has neither, so it
    // falls back to the whole record.
    const where: Prisma.WinWhereInput = {
        userId,
        status: { in: [WinStatus.draft, WinStatus.confirmed] },
        ...(subjectType === InterviewSubject.employer && subjectId ? { employerId: subjectId } : {}),
        ...(subjectType === InterviewSubject.project && subjectId ? { projectId: subjectId } : {}),
        ...(periodStart || periodEnd
            ? {
                occurredAt: {
                    ...(periodStart ? { gte: periodStart } : {}),
                    ...(periodEnd ? { lte: periodEnd } : {}),
                },
            }
            : {}),
    };

    const wins = await prisma.win.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: 60,
        select: { id: true, title: true, category: true, impactMetricId: true },
    });

    return ok({
        subjectType,
        subjectId,
        subjectLabel,
        role,
        highlights,
        description,
        periodStart,
        periodEnd,
        existingWins: wins.map((win) => ({
            id: win.id,
            title: win.title,
            category: win.category,
            quantified: win.impactMetricId !== null,
        })),
        existingWinCount: wins.length,
        hasPriorContext: subjectRowExists || wins.length > 0 || highlights.length > 0,
    });
}

// ═══════════════════════════════════════════════════════════ 2. getGraphGaps

/**
 * Words that mean "someone outside my own hands was affected". Their absence is
 * what the scope question exists to fix — PRD 07 §3.2 calls scope the thing that
 * separates Senior evidence from Staff evidence, and users never volunteer it.
 */
const SCOPE_MARKERS = [
    'team', 'teams', 'org', 'company', 'company-wide', 'cross-team', 'department',
    'engineers', 'people', 'users', 'customers', 'clients', 'region', 'fleet',
    'org-wide', 'group', 'division', 'stakeholders', 'partners',
];

export function mentionsScope(text: string): boolean {
    const lower = text.toLowerCase();
    return SCOPE_MARKERS.some((marker) => new RegExp(`\\b${marker}\\b`).test(lower));
}

const GraphGapsInput = z.object({
    userId: z.string().min(1),
    winIds: z.array(z.string().max(64)).max(200).default([]),
});

export async function getGraphGapsTool(input: unknown): Promise<Result<GraphGaps>> {
    const parsed = GraphGapsInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, winIds } = parsed.data;

    if (winIds.length === 0) {
        return ok({
            missingCategories: [...RARE_CATEGORIES],
            unquantifiedWins: [],
            unscopedWins: [],
            quantifiedCount: 0,
            totalCount: 0,
        });
    }

    const wins = await prisma.win.findMany({
        where: { userId, id: { in: winIds }, status: { not: WinStatus.dismissed } },
        select: { id: true, title: true, narrative: true, category: true, impactMetricId: true },
    });

    const present = new Set(wins.map((win) => win.category));
    return ok({
        missingCategories: RARE_CATEGORIES.filter((category) => !present.has(category)),
        unquantifiedWins: wins
            .filter((win) => win.impactMetricId === null)
            .map((win) => ({ id: win.id, title: win.title })),
        unscopedWins: wins
            .filter((win) => !mentionsScope(`${win.title} ${win.narrative}`))
            .map((win) => ({ id: win.id, title: win.title })),
        quantifiedCount: wins.filter((win) => win.impactMetricId !== null).length,
        totalCount: wins.length,
    });
}

// ═══════════════════════════════════════════════════════════ 3. writeWinDraft

const ImpactSchema = z.object({
    metric: z.string().min(1).max(120),
    baseline: z.string().max(80).nullable().optional(),
    result: z.string().max(80).nullable().optional(),
    delta: z.string().max(80).nullable().optional(),
    scope: z.string().max(120).nullable().optional(),
    timeframe: z.string().max(80).nullable().optional(),
});

const WriteWinDraftInput = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1).max(64),
    questionIndex: z.number().int().min(0).max(64),
    /** Verbatim user answer. The only admissible source of facts for this Win. */
    answerText: z.string().min(1).max(8_000),
    draft: z.object({
        title: z.string().min(1).max(120),
        narrative: z.string().max(4_000).default(''),
        category: z.enum(Object.values(WinCategory) as [WinCategory, ...WinCategory[]]),
        skills: z.array(z.string().max(80)).max(20).default([]),
        collaborators: z.array(z.string().max(120)).max(20).default([]),
        sensitivity: z.enum(
            Object.values(WinSensitivity) as [WinSensitivity, ...WinSensitivity[]],
        ),
        impact: ImpactSchema.nullable().default(null),
        confidence: z.number().min(0).max(1).default(0.6),
    }),
    occurredAt: z.coerce.date(),
    employerId: z.string().max(64).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
});

export type WriteWinDraftResult = {
    win: CapturedWin;
    /** True when the Win already existed and this answer restated it. */
    deduplicated: boolean;
};

/**
 * Persist one captured Win as a `draft`, immediately.
 *
 * Goes through `createWinFromText` with a pre-structured `draft` so the answer
 * is not sent to the structuring model a second time — the interview has
 * already done that work, and re-running it would both cost money and risk a
 * different result than the one shown in the rail.
 *
 * Never auto-confirms (CLAUDE.md rule 5): confirmation is a user act, and the
 * whole point of the closing screen is that it is a review step.
 */
export async function writeWinDraftTool(input: unknown): Promise<Result<WriteWinDraftResult>> {
    const parsed = WriteWinDraftInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { draft, sessionId, questionIndex } = parsed.data;

    // Belt and braces on top of the guard inside `generateStructured`: an impact
    // whose figures are not in the user's own answer is dropped here, before it
    // can reach a row. PRD 07 §9 makes this a hard gate, so it is enforced at
    // the write, not only asserted in a test.
    const impact = draft.impact && impactIsGrounded(draft.impact, parsed.data.answerText)
        ? draft.impact
        : null;

    const created = await createWinFromText({
        draft: {
            title: draft.title,
            narrative: draft.narrative,
            category: draft.category,
            skills: draft.skills,
            collaborators: draft.collaborators,
            suggestedSensitivity: draft.sensitivity,
            quantified: impact !== null,
            impact,
            confidence: draft.confidence,
        },
        occurredAt: parsed.data.occurredAt,
        sensitivity: draft.sensitivity,
        source: WinSource.backfill,
        sourceRef: `${BACKFILL_SOURCE_PREFIX}${sessionId}`,
        // The session knows its subject; inference does not, and returns null
        // on overlapping employments. Declared in this tool's own schema and
        // previously dropped on the floor here.
        ...(parsed.data.employerId !== undefined
            ? { employerId: parsed.data.employerId }
            : {}),
        ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId } : {}),
    });

    if (!created.success) {
        // A near-duplicate is not a failure of the interview — the user just
        // restated something already on the record. Surface the existing card
        // rather than dropping the turn on the floor (PRD 01 §12).
        const existingId = parseMergeProposalCode(created.code);
        if (existingId) {
            const existing = await prisma.win.findFirst({
                where: { id: existingId, userId: parsed.data.userId },
                select: { id: true, title: true, category: true, sensitivity: true, impactMetricId: true },
            });
            if (existing) {
                return ok({
                    win: {
                        winId: existing.id,
                        title: existing.title,
                        category: existing.category,
                        sensitivity: existing.sensitivity,
                        quantified: existing.impactMetricId !== null,
                        metricLabel: await metricLabelFor(parsed.data.userId, existing.id),
                        questionIndex,
                        capturedAt: new Date().toISOString(),
                    },
                    deduplicated: true,
                });
            }
        }
        return err(created.error, created.code ?? 'capture_failed');
    }

    const win = created.data;
    return ok({
        win: {
            winId: win.id,
            title: win.title,
            category: win.category,
            sensitivity: win.sensitivity,
            quantified: win.impact !== null,
            metricLabel: formatMetricLabel(win.impact),
            questionIndex,
            capturedAt: new Date().toISOString(),
        },
        deduplicated: false,
    });
}

/** Append captured Wins to the session rail. Separate write, so a rail update never blocks the capture. */
export async function recordCapturesTool(input: {
    userId: string;
    sessionId: string;
    wins: CapturedWin[];
}): Promise<Result<CapturedWin[]>> {
    const row = await prisma.interviewSession.findFirst({
        where: { id: input.sessionId, userId: input.userId },
    });
    if (!row) return err('Interview session not found', 'not_found');

    const existing = decodeCaptured(row.winIds);
    const byId = new Map(existing.map((win) => [win.winId, win]));
    for (const win of input.wins) byId.set(win.winId, win);
    const merged = [...byId.values()];

    await prisma.interviewSession.update({
        where: { id: input.sessionId },
        data: { winIds: merged as unknown as Prisma.InputJsonValue },
    });
    return ok(merged);
}

// ══════════════════════════════════════════════════════ 4. writeImpactMetric

const WriteImpactInput = z.object({
    userId: z.string().min(1),
    winId: z.string().min(1).max(64),
    /** Verbatim user answer. Every figure written must appear in it. */
    answerText: z.string().min(1).max(8_000),
    impact: ImpactSchema,
});

/**
 * Attach a metric to a Win captured earlier in the session — the "quantify"
 * rung of the ladder, answered.
 *
 * Refuses rather than rounds. A figure the user did not state is the one thing
 * this feature must never produce, because it ends up on a resume.
 */
export async function writeImpactMetricTool(
    input: unknown,
): Promise<Result<{ winId: string; metricLabel: string }>> {
    const parsed = WriteImpactInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, winId, impact, answerText } = parsed.data;

    if (!impactIsGrounded(impact, answerText)) {
        return err('That answer does not contain a figure we can attribute', 'no_quantity');
    }

    const win = await prisma.win.findFirst({
        where: { id: winId, userId },
        select: { id: true, title: true, source: true, impactMetricId: true },
    });
    if (!win) return err('Win not found', 'not_found');

    const existing = await prisma.impactMetric.findFirst({
        where: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: winId },
        orderBy: { createdAt: 'asc' },
    });

    const data = {
        statement: win.title,
        metric: impact.metric,
        baseline: impact.baseline ?? null,
        result: impact.result ?? null,
        delta: impact.delta ?? null,
        scope: impact.scope ?? null,
        timeframe: impact.timeframe ?? null,
    };

    const metric = existing
        ? await prisma.impactMetric.update({ where: { id: existing.id }, data })
        : await prisma.impactMetric.create({
            data: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: winId, source: 'interview', ...data },
        });

    if (win.impactMetricId !== metric.id) {
        await prisma.win.update({ where: { id: winId }, data: { impactMetricId: metric.id } });
    }

    return ok({
        winId,
        metricLabel:
            formatMetricLabel({
                metric: metric.metric,
                baseline: metric.baseline,
                result: metric.result,
                delta: metric.delta,
            }) ?? metric.metric,
    });
}

// ══════════════════════════════════════════════════════════════ 5. linkEvidence

const LinkEvidenceInput = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1).max(64),
    winId: z.string().min(1).max(64),
    /** The user's own words. Their answer is the evidence (PRD 07 §4). */
    excerpt: z.string().min(1).max(2_000),
});

/**
 * `Evidence(interview_assertion)` + `ClaimLink`, both unconfirmed.
 *
 * Deliberately `needs_confirmation` / `confirmedByUser: false`. A statement made
 * in an interview is a claim, not a grounded fact; only the user pressing
 * confirm turns it into one (CLAUDE.md rule 5, and "fail closed on truth").
 */
export async function linkEvidenceTool(
    input: unknown,
): Promise<Result<{ evidenceId: string; claimLinkId: string }>> {
    const parsed = LinkEvidenceInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, sessionId, winId, excerpt } = parsed.data;

    const win = await prisma.win.findFirst({ where: { id: winId, userId }, select: { id: true } });
    if (!win) return err('Win not found', 'not_found');

    const sourceRef = `${BACKFILL_SOURCE_PREFIX}${sessionId}`;

    // Idempotent: a retried turn must not stack a second identical assertion.
    const existing = await prisma.claimLink.findFirst({
        where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId, evidence: { sourceRef } },
        select: { id: true, evidenceId: true },
    });
    if (existing) return ok({ evidenceId: existing.evidenceId, claimLinkId: existing.id });

    const evidence = await prisma.evidence.create({
        data: {
            userId,
            kind: EvidenceKind.interview_assertion,
            sourceRef,
            excerpt: excerpt.slice(0, 2_000),
            confidence: 0.7,
            confirmedByUser: false,
        },
    });
    const claimLink = await prisma.claimLink.create({
        data: {
            userId,
            claimType: WIN_CLAIM_TYPE,
            claimRefId: winId,
            evidenceId: evidence.id,
            groundState: GroundState.needs_confirmation,
        },
    });

    return ok({ evidenceId: evidence.id, claimLinkId: claimLink.id });
}

// ══════════════════════════════════════════════════════════════ 6. endSession

const EndSessionInput = z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1).max(64),
    status: z
        .enum([InterviewStatus.completed, InterviewStatus.paused, InterviewStatus.abandoned])
        .default(InterviewStatus.completed),
    /** Highlights the user's framing improves on. Proposed only, never applied. */
    proposedHighlightDiffs: z
        .array(z.object({ existing: z.string().max(600), proposed: z.string().max(600) }))
        .max(6)
        .default([]),
});

export async function endSessionTool(input: unknown): Promise<Result<SessionSummary>> {
    const parsed = EndSessionInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { userId, sessionId, status } = parsed.data;

    const row = await prisma.interviewSession.findFirst({ where: { id: sessionId, userId } });
    if (!row) return err('Interview session not found', 'not_found');

    const captured = decodeCaptured(row.winIds);
    const winIds = captured.map((win) => win.winId);

    const wins = winIds.length
        ? await prisma.win.findMany({
            where: { userId, id: { in: winIds } },
            select: {
                id: true, title: true, narrative: true, sensitivity: true,
                impactMetricId: true, collaborators: true,
            },
        })
        : [];

    const now = new Date();
    const updated = await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
            status,
            ...(status === InterviewStatus.completed ? { completedAt: now } : {}),
        },
    });

    const context = await getSubjectContextTool({
        userId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectLabel: row.subjectLabel,
    });
    const priorHighlightCount = context.success ? context.data.highlights.length : 0;
    const priorWinCount = context.success
        ? context.data.existingWins.filter((win) => !winIds.includes(win.id)).length
        : 0;

    return ok({
        winsCaptured: wins.length,
        quantifiedCount: wins.filter((win) => win.impactMetricId !== null).length,
        crossTeamCount: wins.filter(
            (win) =>
                mentionsScope(`${win.title} ${win.narrative}`) ||
                asStringArray(win.collaborators).length > 0,
        ).length,
        confidentialCount: wins.filter((win) => win.sensitivity !== WinSensitivity.shareable).length,
        questionsAsked: updated.questionCount,
        durationSec: Math.max(
            0,
            Math.round((now.getTime() - updated.startedAt.getTime()) / 1000),
        ),
        priorWinCount,
        priorHighlightCount,
        subjectLabel: row.subjectLabel,
        proposedHighlightDiffs: parsed.data.proposedHighlightDiffs,
    });
}

// ═══════════════════════════════════════════════════════════ transcript privacy

/**
 * PRD 07 §5.4: the transcript is deletable independently of the Wins it
 * produced. Blanking rather than dropping the row keeps the counts the closing
 * screen and the telemetry are built on.
 */
export async function deleteTranscriptTool(input: unknown): Promise<Result<{ turnsRemoved: number }>> {
    const parsed = SessionRefInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const row = await prisma.interviewSession.findFirst({
        where: { id: parsed.data.sessionId, userId: parsed.data.userId },
    });
    if (!row) return err('Interview session not found', 'not_found');

    const turns = decodeTranscript(row.transcript).length;
    await prisma.interviewSession.update({
        where: { id: row.id },
        data: { transcript: [] as unknown as Prisma.InputJsonValue },
    });
    // The Wins keep their evidence excerpts; the raw conversation does not survive.
    await prisma.evidence.updateMany({
        where: { userId: parsed.data.userId, sourceRef: `${BACKFILL_SOURCE_PREFIX}${row.id}` },
        data: { excerpt: '(transcript deleted by the user)' },
    });
    return ok({ turnsRemoved: turns });
}

/** Export payload for the data-export path. User-scoped, never embedded. */
export async function exportTranscriptTool(input: unknown): Promise<
    Result<{ subjectLabel: string; startedAt: Date; transcript: TranscriptTurn[] }>
> {
    const parsed = SessionRefInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const row = await prisma.interviewSession.findFirst({
        where: { id: parsed.data.sessionId, userId: parsed.data.userId },
    });
    if (!row) return err('Interview session not found', 'not_found');

    return ok({
        subjectLabel: row.subjectLabel,
        startedAt: row.startedAt,
        transcript: decodeTranscript(row.transcript),
    });
}

// ═══════════════════════════════════════════════════════════════════ helpers

function invalid<T>(error: z.ZodError): Result<T> {
    return err(
        error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '),
        'invalid_input',
    );
}

/**
 * Every quantity in the impact must be traceable to the user's answer.
 *
 * Reuses the same extractor the numeric guard uses, so "77%" derived from
 * "800ms → 180ms" is rejected here exactly as it would be there — a computed
 * percentage is a fabricated number even when both inputs are real.
 */
export function impactIsGrounded(impact: ImpactInput, sourceText: string): boolean {
    const source = flattenQuantities(extractQuantities(sourceText, 'lenient'));
    const fields = [impact.metric, impact.baseline, impact.result, impact.delta, impact.scope, impact.timeframe];
    for (const field of fields) {
        if (!field) continue;
        for (const quantity of extractQuantities(field, 'strict')) {
            if (quantity.kind === 'year' || quantity.kind === 'date') continue;
            if (!isQuantitySupported(quantity, source)) return false;
        }
    }
    return true;
}

/** `800ms → 180ms`, else `-77%`, else the metric name. Same precedence as the log rail. */
export function formatMetricLabel(
    impact: { metric: string; baseline?: string | null; result?: string | null; delta?: string | null } | null,
): string | null {
    if (!impact) return null;
    if (impact.baseline && impact.result) return `${impact.baseline} → ${impact.result}`;

    // Truthiness, not nullish coalescing. The numeric guard blanks a violating
    // field to '' rather than null, and '' is not nullish — so `?? ` returned
    // the empty string and the rail rendered a ⚡ chip with no label beside it.
    // That is precisely the metric-shaped hole this must never produce.
    return firstNonEmpty(impact.delta, impact.result, impact.metric);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    return null;
}

async function metricLabelFor(userId: string, winId: string): Promise<string | null> {
    const metric = await prisma.impactMetric.findFirst({
        where: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: winId },
        orderBy: { createdAt: 'asc' },
        select: { metric: true, baseline: true, result: true, delta: true },
    });
    return formatMetricLabel(metric);
}
