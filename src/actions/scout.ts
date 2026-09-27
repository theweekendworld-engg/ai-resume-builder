'use server';

/**
 * Scout server actions (docs/impl/06-scout-agent.md).
 *
 * Convention order: Clerk `auth()` → flag → zod → work → `Result`. Metering is
 * NOT here: it lives in `src/services/scout.ts` because the Telegram and
 * WhatsApp webhooks start runs without an action in front of them, and one
 * gate in the shared path is the only way the count stays channel-independent.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { isEnabled } from '@/lib/flags';
import { err, ok, type Result } from '@/lib/result';
import { parseSharedMessage } from '@/lib/scout/message';
import type { OutreachDraft, ScoutRunSummary, ScoutRunView } from '@/lib/scout/types';
import { track } from '@/lib/track';
import type { ContactImportSummary } from '@/lib/contacts/import';

export type { ContactImportSummary };
import {
    answerScoutQuestion,
    draftScoutOutreach,
    getScoutRun,
    getScoutRunSteps,
    listScoutRuns,
    refreshScoutRun,
    startScoutRun,
} from '@/services/scout';
import { tailorResumeForRun, type TailorStart } from '@/services/tailor';

type Gate = { userId: string } | { error: Result<never> };

async function gateSurface(): Promise<Gate> {
    const { userId } = await auth();
    if (!userId) return { error: err('Not signed in', 'unauthenticated') };
    if (!(await isEnabled(userId, 'scout'))) return { error: err('Scout is not available yet', 'not_available') };
    return { userId };
}

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

const RunIdSchema = z.string().min(1).max(64);

// ───────────────────────────────────────────────────────────────── start

const StartSchema = z.object({
    /** A link, a pasted post, or both in one box — parsed like a chat message. */
    message: z.string().trim().min(1).max(100_000),
});

export async function startScout(input: z.infer<typeof StartSchema>): Promise<Result<{ run: ScoutRunView; created: boolean }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = StartSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const shared = parseSharedMessage(parsed.data.message);
    return startScoutRun({
        userId: gate.userId,
        input: { url: shared.url, text: shared.text, source: 'dashboard' },
        channel: 'web',
    });
}

// ───────────────────────────────────────────────────────────────── reads

export async function getScout(runId: string): Promise<Result<ScoutRunView>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) return err('Invalid run id', 'invalid_input');
    return getScoutRun(gate.userId, parsed.data);
}

export type ScoutStepView = {
    id: string;
    name: string;
    status: string;
    attempt: number;
    reason: string | null;
    sources: { url: string; title: string | null }[];
    latencyMs: number | null;
    startedAt: string;
    finishedAt: string | null;
};

/** The run's step timeline: what ran, how long it took, what it read. */
export async function getScoutSteps(runId: string): Promise<Result<ScoutStepView[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) return err('Invalid run id', 'invalid_input');
    const steps = await getScoutRunSteps(gate.userId, parsed.data);
    return ok(steps.map((step) => ({
        id: step.id,
        name: step.name,
        status: step.status,
        attempt: step.attempt,
        reason: step.reason,
        sources: Array.isArray(step.sources)
            ? (step.sources as { url: string; title: string | null }[]).map((source) => ({ url: source.url, title: source.title ?? null }))
            : [],
        latencyMs: step.latencyMs,
        startedAt: step.startedAt.toISOString(),
        finishedAt: step.finishedAt?.toISOString() ?? null,
    })));
}

export async function listScouts(): Promise<Result<ScoutRunSummary[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    return ok(await listScoutRuns(gate.userId));
}

// ──────────────────────────────────────────────────────────────── writes

const AnswerSchema = z.object({ runId: RunIdSchema, value: z.string().trim().min(1).max(500) });

export async function answerScout(input: z.infer<typeof AnswerSchema>): Promise<Result<ScoutRunView>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = AnswerSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return answerScoutQuestion(gate.userId, parsed.data.runId, parsed.data.value);
}

export async function refreshScout(runId: string): Promise<Result<ScoutRunView>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) return err('Invalid run id', 'invalid_input');
    return refreshScoutRun(gate.userId, parsed.data);
}

const DraftSchema = z.object({
    runId: RunIdSchema,
    target: z.enum(['poster', 'recruiter', 'hiring_manager', 'referral', 'alumni']),
    format: z.enum(['linkedin_note', 'linkedin_message', 'email']),
    contactId: z.string().max(64).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
});

export async function draftScoutMessage(input: z.infer<typeof DraftSchema>): Promise<Result<OutreachDraft>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = DraftSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    const { runId, ...params } = parsed.data;
    return draftScoutOutreach(gate.userId, runId, params);
}

// ───────────────────────────────────────────────────────────────── tailor

/**
 * "Tailor my resume for this job" from a Scout run: a per-job copy of the
 * base resume, generated against the posting Scout already read.
 */
export async function tailorFromScout(runId: string): Promise<Result<TailorStart>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) return err('Invalid run id', 'invalid_input');
    return tailorResumeForRun(gate.userId, parsed.data, 'web');
}

// ──────────────────────────────────────────────────────────────── contacts


const ImportSchema = z.object({
    /** The contents of LinkedIn's `Connections.csv` from the data export. */
    csv: z.string().min(1).max(5_000_000),
});

/**
 * Import first-degree connections from the user's own LinkedIn data export.
 * LinkedIn's API offers no connections access to apps like this one; the
 * export is the user's data, obtained by the user, and it is complete.
 */
export async function importLinkedInConnections(
    input: z.infer<typeof ImportSchema>,
): Promise<Result<ContactImportSummary>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = ImportSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const { importConnectionsCsv } = await import('@/lib/contacts/import');
    const result = await importConnectionsCsv(gate.userId, parsed.data.csv);
    if (result.success) await track(gate.userId, 'scout_contacts_imported', { ...result.data });
    return result;
}

export async function getContactStats(): Promise<Result<{ total: number; lastImportedAt: string | null }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const { contactStats } = await import('@/lib/contacts/import');
    return ok(await contactStats(gate.userId));
}
