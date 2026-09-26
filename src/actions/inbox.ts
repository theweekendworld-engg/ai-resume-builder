'use server';

/**
 * Career inbox server actions: auth → flag → zod → service → Result.
 * Thin on purpose; the logic lives in `src/services/careerInbox.ts` so the
 * Telegram and WhatsApp bots call exactly the same code.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { isEnabled } from '@/lib/flags';
import { err, ok, type Result } from '@/lib/result';
import {
    BOARD_COLUMNS,
    JOB_ACTIONS,
    type CompanyItem,
    type InboxCounts,
    type InsightItem,
    type JobBoardItem,
    type NoteItem,
} from '@/lib/inbox/types';
import {
    inboxCounts,
    listChatNotes,
    listCompanies,
    listInsights,
    listJobBoard,
    setJobStatus,
} from '@/services/careerInbox';
import { confirmWinForUser, dismissWinForUser } from '@/services/wins';

type Gate = { userId: string } | { error: Result<never> };

async function gateSurface(): Promise<Gate> {
    const { userId } = await auth();
    if (!userId) return { error: err('Not signed in', 'unauthenticated') };
    if (!(await isEnabled(userId, 'scout'))) return { error: err('The inbox is not available yet', 'not_available') };
    return { userId };
}

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

const Id = z.string().min(1).max(64);
const VERDICTS = ['strong', 'possible', 'stretch', 'not_a_fit', 'unknown'] as const;
const WORK_MODES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;

const BoardSchema = z.object({
    columns: z.array(z.enum(BOARD_COLUMNS)).max(BOARD_COLUMNS.length).optional(),
    verdicts: z.array(z.enum(VERDICTS)).max(VERDICTS.length).optional(),
    location: z.string().trim().max(80).nullable().optional(),
    workModes: z.array(z.enum(WORK_MODES)).max(WORK_MODES.length).optional(),
    sinceDays: z.number().int().min(1).max(3650).nullable().optional(),
    sort: z.enum(['fit', 'recent']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
}).default({});

export async function getJobBoard(input: z.input<typeof BoardSchema> = {}): Promise<Result<JobBoardItem[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = BoardSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return ok(await listJobBoard(gate.userId, parsed.data));
}

const StatusSchema = z.object({
    workspaceId: Id.optional(),
    runId: Id.optional(),
    action: z.enum(JOB_ACTIONS),
}).refine((value) => Boolean(value.workspaceId) !== Boolean(value.runId), { message: 'Pass exactly one of workspaceId or runId' });

export async function updateJobStatus(input: z.infer<typeof StatusSchema>): Promise<Result<JobBoardItem>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = StatusSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    const ref = parsed.data.workspaceId ? { workspaceId: parsed.data.workspaceId } : { runId: parsed.data.runId! };
    return setJobStatus(gate.userId, ref, parsed.data.action);
}

const InsightsSchema = z.object({
    tag: z.string().trim().max(60).nullable().optional(),
    q: z.string().trim().max(120).nullable().optional(),
    limit: z.number().int().min(1).max(200).optional(),
}).default({});

export async function getInsights(input: z.input<typeof InsightsSchema> = {}): Promise<Result<InsightItem[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = InsightsSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return ok(await listInsights(gate.userId, parsed.data));
}

export async function getCompanies(): Promise<Result<CompanyItem[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    return ok(await listCompanies(gate.userId));
}

export async function getChatNotes(): Promise<Result<NoteItem[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    return ok(await listChatNotes(gate.userId));
}

export async function getInboxCounts(): Promise<Result<InboxCounts>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    return ok(await inboxCounts(gate.userId));
}

/** Confirm a note-derived Win from the inbox. Same transaction as the Work Log (rule 5). */
export async function confirmChatNote(winId: string): Promise<Result<{ winId: string; title: string }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = Id.safeParse(winId);
    if (!parsed.success) return err('Invalid id', 'invalid_input');
    return confirmWinForUser(gate.userId, parsed.data);
}

export async function dismissChatNote(winId: string): Promise<Result<void>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = Id.safeParse(winId);
    if (!parsed.success) return err('Invalid id', 'invalid_input');
    return dismissWinForUser(gate.userId, parsed.data);
}
