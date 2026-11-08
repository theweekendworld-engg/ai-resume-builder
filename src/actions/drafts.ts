'use server';

/**
 * Apply-by-email on the web Scout page (docs/impl/07-telegram-apply.md §3):
 * the same versioned `MessageDraft` path Telegram uses, behind buttons.
 *
 * Convention order: Clerk `auth()` → flag → zod → service → `Result`.
 * Metering is NOT here, for the reason `src/actions/scout.ts` gives: the
 * first draft is charged inside `draftScoutOutreach` (`cover_letter`), which
 * Telegram reaches without an action, and a revision is an edit of a draft
 * already paid for (rate-limited by the chat limiter in the service). A
 * second gate here would charge the web twice.
 *
 * Patronus never sends email. These actions write drafts and hand back
 * compose links (Gmail, mailto) for the user's own mail client.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { composeLinks, type ComposeLinks } from '@/lib/drafts/compose';
import { latestChain } from '@/lib/drafts/history';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';
import type { DraftView } from '@/lib/drafts/types';
import { applyEmailsOf } from '@/lib/drafts/applyEmail';
import { prisma } from '@/lib/prisma';
import { applyUrlOf } from '@/lib/scout/applyChain';
import { isEnabled } from '@/lib/flags';
import { err, ok, type Result } from '@/lib/result';
import { track } from '@/lib/track';
import {
    createDraftForRun,
    getDraft,
    listDraftsForRun,
    markDraftOpened,
    reviseDraft,
    tailoredAttachmentForRun,
    type TailoredAttachment,
} from '@/services/drafts';
import { getScoutRun } from '@/services/scout';

export type ApplyDraftVersion = DraftView & { links: ComposeLinks };

/** Everything the apply-by-email panel renders, rebuilt after every write. */
export type ApplyEmailState = {
    /** Addresses the posting gives for applications, best first (code-read, never a model). */
    applyEmails: string[];
    /** The email chain, oldest version first. Empty until the first draft. */
    versions: ApplyDraftVersion[];
    /**
     * The LinkedIn message to the recruiter or poster, oldest version first:
     * what the apply chain writes when the posting gives no address. Empty
     * when there is none.
     */
    messageVersions: ApplyDraftVersion[];
    /** The posting's application link, for applying alongside a LinkedIn message. */
    applyUrl: string | null;
    /** The job is at Applied or further. */
    applied: boolean;
    /** The tailored resume to attach, when this job has one. */
    attachment: TailoredAttachment | null;
};

/** Drafts that are the application itself, not a referral ask. */
const APPLICATION_TARGETS: ReadonlySet<string> = new Set(['recruiter', 'poster']);

/** Job statuses that already count as applied. */
const APPLIED_STATUSES: ReadonlySet<string> = new Set(['submitted', 'applied', 'in_review', 'interview', 'offer']);

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

const IdSchema = z.string().min(1).max(64);

async function stateFor(userId: string, runId: string): Promise<Result<ApplyEmailState>> {
    const run = await getScoutRun(userId, runId);
    if (!run.success) return err('I could not find that job.', 'not_found');
    const [drafts, attachment, workspace] = await Promise.all([
        listDraftsForRun(userId, runId),
        tailoredAttachmentForRun(userId, runId).catch(() => null),
        prisma.applicationWorkspace.findFirst({ where: { userId, scoutRunId: runId }, select: { applicationStatus: true } }),
    ]);
    const withLinks = (draft: DraftView): ApplyDraftVersion => ({ ...draft, links: composeLinks(draft) });
    return ok({
        applyEmails: applyEmailsOf(run.data.sections),
        versions: latestChain(drafts, 'email').map(withLinks),
        messageVersions: latestChain(drafts.filter((draft) => APPLICATION_TARGETS.has(draft.target)), 'linkedin_message').map(withLinks),
        applyUrl: applyUrlOf(run.data.sections, run.data.input.url),
        applied: Boolean(workspace && APPLIED_STATUSES.has(workspace.applicationStatus)),
        attachment,
    });
}

// ───────────────────────────────────────────────────────────────── read

export async function getApplyEmailState(runId: string): Promise<Result<ApplyEmailState>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = IdSchema.safeParse(runId);
    if (!parsed.success) return err('Invalid run id', 'invalid_input');
    return stateFor(gate.userId, parsed.data);
}

// ──────────────────────────────────────────────────────────────── start

const StartSchema = z.object({ runId: IdSchema });

/**
 * Version 1 of the application email, To the posting's own address. One
 * chain per job: when one exists it is returned rather than charged again.
 */
export async function startApplyEmail(input: z.infer<typeof StartSchema>): Promise<Result<ApplyEmailState>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = StartSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const current = await stateFor(gate.userId, parsed.data.runId);
    if (!current.success) return current;
    if (current.data.versions.length > 0) return current;
    if (current.data.applyEmails.length === 0) {
        return err('This posting does not give an address to apply to. Use the application link instead.', 'no_apply_email');
    }

    const run = await getScoutRun(gate.userId, parsed.data.runId);
    const target = run.success && run.data.kind === 'hiring_post' ? 'poster' : 'recruiter';
    const created = await createDraftForRun(gate.userId, parsed.data.runId, { target, format: 'email' });
    if (!created.success) return err(created.error, created.code);
    return stateFor(gate.userId, parsed.data.runId);
}

// ─────────────────────────────────────────────────────────────── revise

const ReviseSchema = z
    .object({
        draftId: IdSchema,
        revision: z.enum(['shorter', 'stronger']).optional(),
        /** The user's own words ("mention my MCP work"), verbatim. */
        instruction: z.string().trim().min(1).max(500).optional(),
    })
    .refine((value) => Boolean(value.revision) !== Boolean(value.instruction), {
        message: 'Give either a revision or an instruction',
    });

/** Version n+1, from Shorter / Stronger or a typed instruction. */
export async function reviseApplyEmail(input: z.infer<typeof ReviseSchema>): Promise<Result<ApplyEmailState>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = ReviseSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const instruction = parsed.data.revision ? REVISION_INSTRUCTIONS[parsed.data.revision] : parsed.data.instruction!;
    const revised = await reviseDraft(gate.userId, parsed.data.draftId, instruction);
    if (!revised.success) return err(revised.error, revised.code);
    if (!revised.data.runId) return err('That draft is not tied to a job.', 'invalid_state');
    return stateFor(gate.userId, revised.data.runId);
}

// ─────────────────────────────────────────────────────────────── sent

const SentSchema = z.object({ draftId: IdSchema });

/**
 * "Mark as applied" under a draft: the web's "sent it". The same
 * `markApplicationSent` as Telegram: the job moves to Applied, never
 * backwards, and the follow-up reminder finds it.
 */
export async function markApplyDraftSent(input: z.infer<typeof SentSchema>): Promise<Result<ApplyEmailState>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = SentSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const draft = await getDraft(gate.userId, parsed.data.draftId);
    if (!draft?.runId) return err('I could not find that draft.', 'not_found');
    const { markApplicationSent } = await import('@/services/applyChain');
    const applied = await markApplicationSent(gate.userId, draft);
    if (!applied) return err('This draft is not the application, so the job was not marked. Use the status menu at the top.', 'not_applicable');
    return stateFor(gate.userId, draft.runId);
}

// ─────────────────────────────────────────────────────────────── opened

const OpenedSchema = z.object({ draftId: IdSchema, via: z.enum(['gmail', 'mail']) });

/** The user opened a version in their mail app. A second tap is a no-op. */
export async function markApplyEmailOpened(input: z.infer<typeof OpenedSchema>): Promise<Result<{ flipped: boolean }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = OpenedSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const draft = await getDraft(gate.userId, parsed.data.draftId);
    if (!draft) return err('I could not find that draft.', 'not_found');
    const flipped = await markDraftOpened(gate.userId, draft.id);
    if (flipped) await track(gate.userId, 'message_draft_opened', { version: draft.version, via: parsed.data.via === 'gmail' ? 'gmail' : 'mail_app', channel: 'web' });
    return ok({ flipped });
}
