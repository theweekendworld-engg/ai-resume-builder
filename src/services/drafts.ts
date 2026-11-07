/**
 * Message drafts: write one for a job, revise it over several turns, open it
 * in the user's own mail app (docs/impl/07-telegram-apply.md §3).
 *
 * Plain server code: the caller passes the identity (a Clerk session, a
 * linked Telegram chat). Every read and write is scoped by `userId` in the
 * query, so a draft id from someone else's chat reaches nothing.
 *
 * Metering: the FIRST draft goes through `draftScoutOutreach`, which charges
 * `cover_letter` exactly as the dashboard's draft button does. A revision is
 * an edit of a draft already paid for, so it is bounded by the chat rate
 * limiter instead of a second charge.
 *
 * Code owns the facts: `toEmail` comes from the posting text
 * (`applyEmailsOf`) or an address the user typed, never from a model.
 * Patronus never sends: `composeLinks` is as far as it goes.
 */

import type { MessageDraft } from '@prisma/client';
import { applyEmailsOf, extractTypedEmail } from '@/lib/drafts/applyEmail';
import { MAX_INSTRUCTION_CHARS, reviseDraftText } from '@/lib/drafts/revise';
import type { DraftView } from '@/lib/drafts/types';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import { checkChatRateLimit } from '@/lib/rateLimit';
import { err, ok, type Result } from '@/lib/result';
import { loadShareableEvidence, selectEvidence } from '@/lib/scout/outreach';
import { dataOf } from '@/lib/scout/section';
import type { DraftFormat, DraftTarget, JdData, OutreachDraft, ScoutRunView } from '@/lib/scout/types';
import { SuspendedError } from '@/lib/suspension';
import { UsageLimitError } from '@/lib/usageTracker';

export type { DraftView } from '@/lib/drafts/types';
export { composeLinks, type ComposeLinks } from '@/lib/drafts/compose';
export { renderDraftForTelegram, renderDraftForWhatsApp } from '@/lib/drafts/render';

// ───────────────────────────────────────────────────────────────── seams

type ScoutDeps = {
    getScoutRun: (userId: string, runId: string) => Promise<Result<ScoutRunView>>;
    draftScoutOutreach: (
        userId: string,
        runId: string,
        params: { target: DraftTarget; format: DraftFormat; note?: string | null },
    ) => Promise<Result<OutreachDraft>>;
};

let scoutOverride: ScoutDeps | null = null;

async function scout(): Promise<ScoutDeps> {
    if (scoutOverride) return scoutOverride;
    const service = await import('@/services/scout');
    return { getScoutRun: service.getScoutRun, draftScoutOutreach: service.draftScoutOutreach };
}

/** Test seam: stand in for the Scout service (run reads and the metered first draft). */
export const __testing = {
    setScout(deps: ScoutDeps | null) {
        scoutOverride = deps;
    },
};

// ───────────────────────────────────────────────────────────────── shape

const FORMATS: ReadonlySet<string> = new Set<DraftFormat>(['email', 'linkedin_message', 'linkedin_note']);

/** Targets an application inbox ("send resumes to jobs@…") is the right `To` for. */
const APPLY_INBOX_TARGETS: ReadonlySet<DraftTarget> = new Set<DraftTarget>(['poster', 'recruiter']);

function toView(row: MessageDraft): DraftView {
    return {
        id: row.id,
        version: row.version,
        runId: row.runId,
        workspaceId: row.workspaceId,
        format: row.format as DraftFormat,
        target: row.target as DraftTarget,
        toEmail: row.toEmail,
        subject: row.subject,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        parentId: row.parentId,
        instruction: row.instruction,
    };
}

async function workspaceFor(userId: string, runId: string, view: ScoutRunView): Promise<string | null> {
    const row = await prisma.applicationWorkspace.findFirst({
        where: { userId, scoutRunId: runId },
        select: { id: true },
    });
    return row?.id ?? dataOf(view.sections, 'track')?.workspaceId ?? null;
}

// ───────────────────────────────────────────────────────────────── create

export type CreateDraftParams = {
    target: DraftTarget;
    /** Null: an email when the posting gives an address, else a LinkedIn message (chat's default). */
    format: DraftFormat | null;
    /** The user's own steer ("mention I used their SDK"). */
    note?: string | null;
};

/**
 * Write version 1 of a draft for a Scout run. Generation, the job-kind check
 * and the `cover_letter` charge are `draftScoutOutreach`'s; this adds the
 * code-owned `To` and the versioned row.
 */
export async function createDraftForRun(userId: string, runId: string, params: CreateDraftParams): Promise<Result<DraftView>> {
    const deps = await scout();
    const run = await deps.getScoutRun(userId, runId);
    if (!run.success) return err('I could not find that job.', 'not_found');

    const emails = applyEmailsOf(run.data.sections);
    const format: DraftFormat = params.format ?? (emails.length > 0 ? 'email' : 'linkedin_message');
    // The application inbox is where an application goes, not a referral ask
    // to a named colleague: those keep an empty To for the user to fill.
    const toEmail = format === 'email' && APPLY_INBOX_TARGETS.has(params.target) ? emails[0] ?? null : null;
    const steer = toEmail
        ? `This is my application for the role, going to ${toEmail}, the address the posting gives for applications. Ask to be considered and say my resume is attached.`
        : null;
    const note = [steer, params.note?.trim() || null].filter(Boolean).join(' ') || null;

    const drafted = await deps.draftScoutOutreach(userId, runId, { target: params.target, format, note });
    if (!drafted.success) return err(drafted.error, drafted.code);
    if (!drafted.data.body.trim()) {
        // The charge was taken inside draftScoutOutreach; an empty draft is not a draft.
        const { refundMeteredAction } = await import('@/lib/entitlements');
        await refundMeteredAction(userId, 'cover_letter', { reason: 'scout_draft_empty' }).catch(() => undefined);
        return err('Could not write that draft. Try again.', 'draft_failed');
    }

    const row = await prisma.messageDraft.create({
        data: {
            userId,
            runId,
            workspaceId: await workspaceFor(userId, runId, run.data),
            version: 1,
            format,
            target: params.target,
            toEmail,
            subject: format === 'email' ? drafted.data.subject : null,
            body: drafted.data.body,
        },
    });
    return ok(toView(row));
}

// ───────────────────────────────────────────────────────────────── revise

const GUARD_REFUSAL = 'I could not make that change without adding a number your record does not show, so I kept the last version. Say it another way, or add the fact to your profile first.';

/**
 * Write version n+1 of a draft from one instruction, verbatim.
 *
 * The model edits the previous version under the numeric guard (sources: the
 * previous version, the shareable evidence, the instruction). A revision the
 * guard would have to strip is refused and nothing is written. Replaying the
 * same instruction on the same version (a second tap on "Shorter") returns
 * the version it already made, free.
 */
export async function reviseDraft(userId: string, draftId: string, instruction: string): Promise<Result<DraftView>> {
    const text = instruction.trim();
    if (!text) return err('Tell me what to change.', 'invalid_input');
    if (text.length > MAX_INSTRUCTION_CHARS) return err('That is long for an edit. Tell me the change in a sentence or two.', 'invalid_input');

    const previous = await prisma.messageDraft.findFirst({ where: { id: draftId, userId } });
    if (!previous || previous.status === 'discarded') return err('I could not find that draft.', 'not_found');
    if (!FORMATS.has(previous.format)) return err('That draft cannot be edited here.', 'invalid_state');
    const format = previous.format as DraftFormat;

    const replay = await prisma.messageDraft.findFirst({
        where: { userId, parentId: previous.id, instruction: text },
        orderBy: { createdAt: 'desc' },
    });
    if (replay) return ok(toView(replay));

    const limited = await checkChatRateLimit(userId);
    if (!limited.allowed) return err(limited.error ?? 'Give it a minute.', 'rate_limited');

    let jd: JdData | null = null;
    if (previous.runId) {
        const run = await (await scout()).getScoutRun(userId, previous.runId);
        jd = run.success ? dataOf(run.data.sections, 'jd') : null;
    }
    const evidence = selectEvidence(await loadShareableEvidence(userId), jd, 12);

    let outcome: Awaited<ReturnType<typeof reviseDraftText>>;
    try {
        outcome = await reviseDraftText({
            userId,
            sessionId: previous.runId,
            format,
            previous: { subject: previous.subject, body: previous.body, version: previous.version },
            instruction: text,
            evidence,
        });
    } catch (error) {
        if (error instanceof UsageLimitError || error instanceof SuspendedError) return err(error.message, 'usage_limit');
        console.warn('[drafts] revision failed', { draftId, error: error instanceof Error ? error.message : String(error) });
        return err('Could not edit that draft. Try again.', 'revise_failed');
    }
    if (!outcome.ok) {
        return outcome.reason === 'guard'
            ? err(GUARD_REFUSAL, 'guard_rejected')
            : err('Could not edit that draft. Try again.', 'revise_failed');
    }

    // "Send it to hr@acme.in" changes the To. Typed by the user, so code reads it.
    const typed = format === 'email' ? extractTypedEmail(text) : null;
    const row = await prisma.messageDraft.create({
        data: {
            userId,
            runId: previous.runId,
            workspaceId: previous.workspaceId,
            parentId: previous.id,
            version: previous.version + 1,
            format: previous.format,
            target: previous.target,
            toEmail: typed ?? previous.toEmail,
            subject: format === 'email' ? outcome.subject : null,
            body: outcome.body,
            instruction: text,
        },
    });
    await track(userId, 'message_draft_revised', { version: row.version, format: row.format });
    return ok(toView(row));
}

// ───────────────────────────────────────────────────────────────── reads

/** Every live version drafted for one Scout run, oldest first. Scoped by user in the query. */
export async function listDraftsForRun(userId: string, runId: string): Promise<DraftView[]> {
    const rows = await prisma.messageDraft.findMany({
        where: { userId, runId, status: { not: 'discarded' } },
        orderBy: [{ createdAt: 'asc' }, { version: 'asc' }],
        take: 100,
    });
    return rows.map(toView);
}

/** The tailored resume to attach, as links the web page can open. */
export type TailoredAttachment = {
    resumeId: string;
    title: string;
    /** The latest unexpired PDF of the tailored copy; null when none has been made yet. */
    pdfUrl: string | null;
    editorUrl: string;
};

/**
 * The per-job resume for a run (the copy `tailorResumeForRun` made), and its
 * latest PDF. Null when the job has no tailored copy yet. Only the user's own
 * rows: every query carries `userId`.
 */
export async function tailoredAttachmentForRun(userId: string, runId: string, now: Date = new Date()): Promise<TailoredAttachment | null> {
    const workspace = await prisma.applicationWorkspace.findFirst({
        where: { userId, scoutRunId: runId },
        select: { id: true, selectedResumeId: true, selectedGeneratedPdfId: true },
    });
    if (!workspace) return null;

    const selected = workspace.selectedResumeId
        ? await prisma.resume.findFirst({
            where: { id: workspace.selectedResumeId, userId, NOT: { baseResumeId: null } },
            select: { id: true, title: true },
        })
        : null;
    const resume = selected ?? await prisma.resume.findFirst({
        where: { userId, workspaceId: workspace.id, NOT: { baseResumeId: null } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true },
    });
    if (!resume) return null;

    const live = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    const chosen = workspace.selectedGeneratedPdfId
        ? await prisma.generatedPdf.findFirst({ where: { id: workspace.selectedGeneratedPdfId, userId, resumeId: resume.id, ...live }, select: { id: true } })
        : null;
    const pdf = chosen ?? await prisma.generatedPdf.findFirst({
        where: { userId, resumeId: resume.id, ...live },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    return {
        resumeId: resume.id,
        title: resume.title,
        pdfUrl: pdf ? `/api/pdfs/${encodeURIComponent(pdf.id)}` : null,
        editorUrl: `/editor/${encodeURIComponent(resume.id)}`,
    };
}

export async function getDraft(userId: string, draftId: string): Promise<DraftView | null> {
    const row = await prisma.messageDraft.findFirst({ where: { id: draftId, userId } });
    return row ? toView(row) : null;
}

/**
 * The user opened the draft in a mail app. Conditional, so a second tap is a
 * no-op; true only for the call that flipped it.
 */
export async function markDraftOpened(userId: string, draftId: string): Promise<boolean> {
    const flipped = await prisma.messageDraft.updateMany({
        where: { id: draftId, userId, status: 'draft' },
        data: { status: 'opened' },
    });
    return flipped.count > 0;
}

/**
 * For the signed compose route only: the token in the URL is the
 * authorisation, so the draft is read by id and the owner comes from the row.
 */
export async function getDraftForCompose(draftId: string): Promise<(DraftView & { userId: string }) | null> {
    const row = await prisma.messageDraft.findUnique({ where: { id: draftId } });
    return row && row.status !== 'discarded' ? { ...toView(row), userId: row.userId } : null;
}
