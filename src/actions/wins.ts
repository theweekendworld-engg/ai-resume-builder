'use server';

/**
 * The eight Work Log server actions (PRD 01 §9.1, contract in `wins.types.ts`).
 *
 * Every one follows impl/00 §P-3 exactly and in this order:
 *   Clerk auth() -> zod parse -> gateMeteredAction (once, at entry) -> work ->
 *   FunnelEvent -> Result<T>.
 *
 * There is no business logic in this file on purpose. The data layer lives in
 * `src/services/winGraph.ts` and the model call in `src/services/winDrafting.ts`,
 * both of which take an explicit `userId` — which is what makes them testable
 * against a real database without standing up Clerk.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { Prisma, WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { isEntitlementError, gateMeteredAction, type MeteredAction } from '@/lib/entitlements';
import { track } from '@/lib/track';
import * as winGraph from '@/services/winGraph';
import {
    findNearDuplicate,
    mergeProposalCode,
    parseImpactAnswer,
    resolveOccurredAt,
    structureWin,
    toStructuredDraft,
} from '@/services/winDrafting';
import type {
    AddImpact,
    ArchiveWin,
    BulkConfirm,
    BulkResult,
    ConfirmWin,
    CreateWinFromText,
    CreateWinInput,
    DeleteWin,
    DismissReason,
    DismissWin,
    EmployerOption,
    GetLogSummary,
    ListEmployers,
    ListWins,
    LogSummary,
    StructureDraft,
    StructuredDraft,
    UnarchiveWin,
    UnconfirmWin,
    UpdateWin,
    WinCursor,
    WinFilters,
    WinPage,
    WinPatch,
    WinView,
} from '@/actions/wins.types';

// ───────────────────────────────────────────────────────────── metering
//
// PRD 01 §10 meters AI structuring as `win_draft` (Free 30/mo, Career/Search
// unlimited). `MeteredAction` lives in the orchestrator-owned
// `src/lib/entitlements.ts` and does not carry the key yet; until it does,
// `gateMeteredAction` resolves it as "not metered on this tier" and allows
// through — the fail-open direction, which is correct here because PRD 01 §10
// is explicit that we never gate capture. Adding `win_draft` to `MeteredAction`
// and to `planLimits()` turns real metering on with no change to this file.
const WIN_DRAFT_ACTION = 'win_draft' as MeteredAction;

// ───────────────────────────────────────────────────────────── schemas

const IsoDate = z.coerce.date();

const ImpactInputSchema = z.object({
    metric: z.string().min(1).max(120),
    baseline: z.string().max(80).nullable().optional(),
    result: z.string().max(80).nullable().optional(),
    delta: z.string().max(80).nullable().optional(),
    scope: z.string().max(120).nullable().optional(),
    timeframe: z.string().max(80).nullable().optional(),
});

/** The user-edited half of a `StructuredDraft`; every field is optional. */
const StructuredDraftPatchSchema = z.object({
    title: z.string().min(1).max(120).optional(),
    narrative: z.string().max(4_000).optional(),
    category: z.enum(WinCategory).optional(),
    occurredAt: IsoDate.optional(),
    skills: z.array(z.string().max(80)).max(20).optional(),
    collaborators: z.array(z.string().max(120)).max(20).optional(),
    suggestedSensitivity: z.enum(WinSensitivity).optional(),
    quantified: z.boolean().optional(),
    impact: ImpactInputSchema.nullable().optional(),
    quantifyPrompt: z.string().max(200).nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
});

const CreateWinSchema = z
    .object({
        text: z.string().min(1).max(8_000).optional(),
        draft: StructuredDraftPatchSchema.optional(),
        occurredAt: IsoDate.optional(),
        sensitivity: z.enum(WinSensitivity).optional(),
        source: z.enum(WinSource).optional(),
        sourceRef: z.string().max(2_000).optional(),
        signalId: z.string().max(64).optional(),
    })
    // A Win needs words from somewhere: either raw text to structure, or a
    // structured title the user has already seen and approved.
    .refine((value) => Boolean(value.text?.trim()) || Boolean(value.draft?.title?.trim()), {
        message: 'provide `text` to structure, or a `draft` with a title',
        path: ['text'],
    });

const WinPatchSchema = z.object({
    title: z.string().min(1).max(120).optional(),
    narrative: z.string().max(4_000).optional(),
    occurredAt: IsoDate.optional(),
    periodEnd: IsoDate.nullable().optional(),
    category: z.enum(WinCategory).optional(),
    sensitivity: z.enum(WinSensitivity).optional(),
    employerId: z.string().max(64).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
    skills: z.array(z.string().max(80)).max(20).optional(),
    collaborators: z.array(z.string().max(120)).max(20).optional(),
});

const WinFiltersSchema = z.object({
    status: z.array(z.enum(WinStatus)).max(4).optional(),
    category: z.array(z.enum(WinCategory)).max(8).optional(),
    employerId: z.string().max(64).nullable().optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    search: z.string().max(200).optional(),
    includeBeyondHistoryLimit: z.boolean().optional(),
});

const WinIdSchema = z.string().min(1).max(64);

const EvidenceSourceSchema = z.object({ source: z.string().min(1).max(2_000) });

const DismissReasonSchema = z.enum(['not_a_win', 'noise', 'duplicate', 'expired', 'user']);

// ───────────────────────────────────────────────────────────── helpers

async function requireUserId(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
}

/** PRD 01 §11: every Work Log event is grouped by this tag. */
const FEATURE = { feature: 'work_log' } as const;

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

// ═══════════════════════════════════════════════════════════════ 1. create

export async function createWinFromText(input: CreateWinInput): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = CreateWinSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    const { text, draft: supplied, sensitivity, sourceRef, signalId } = parsed.data;
    const source = parsed.data.source ?? WinSource.manual;
    const now = new Date();

    // Two paths, and the distinction matters: when the caller supplies `draft`
    // the user has already seen and corrected the structuring, so re-running the
    // model would silently overwrite their edits — and there is no AI call to
    // meter, because `structureDraft` already charged for it.
    let fields: {
        title: string;
        narrative: string;
        category: WinCategory;
        skills: string[];
        collaborators: string[];
        confidence: number;
        sensitivity: WinSensitivity;
        occurredAt: Date;
        impact: winGraph.ImpactInput | null;
    };
    let degraded = false;

    if (supplied?.title?.trim()) {
        const quantified = supplied.quantified ?? supplied.impact != null;
        fields = {
            title: supplied.title,
            narrative: supplied.narrative ?? '',
            category: supplied.category ?? WinCategory.shipped,
            skills: supplied.skills ?? [],
            collaborators: supplied.collaborators ?? [],
            confidence: supplied.confidence ?? 0.5,
            sensitivity: sensitivity ?? supplied.suggestedSensitivity ?? WinSensitivity.shareable,
            occurredAt: parsed.data.occurredAt ?? supplied.occurredAt ?? now,
            impact: quantified ? supplied.impact ?? null : null,
        };
    } else {
        // Metered once, at entry — the AI structuring call is the cost (PRD 01 §10).
        try {
            await gateMeteredAction(userId, WIN_DRAFT_ACTION);
        } catch (error) {
            if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
            throw error;
        }

        let structured;
        try {
            structured = await structureWin({ userId, text: text as string, now });
        } catch (error) {
            console.error('[actions/wins] structureWin failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return err('Could not structure that just now — try again', 'ai_unavailable');
        }

        const structuredDraft = structured.draft;
        degraded = structured.degraded;
        fields = {
            title: structuredDraft.title,
            narrative: structuredDraft.narrative,
            category: structuredDraft.category,
            skills: structuredDraft.skills,
            collaborators: structuredDraft.collaborators,
            confidence: structuredDraft.confidence,
            // The user's setting always wins; the model only proposes (§4.3).
            sensitivity: sensitivity ?? structuredDraft.suggestedSensitivity,
            occurredAt: parsed.data.occurredAt ?? resolveOccurredAt(structuredDraft, now),
            impact: structuredDraft.quantified ? structuredDraft.impact : null,
        };
    }

    // PRD 01 §12: a near-duplicate is a merge proposal, not a second draft.
    const duplicate = await findNearDuplicate({
        userId,
        text: text?.trim() || `${fields.title}\n${fields.narrative}`,
        occurredAt: fields.occurredAt,
    });
    if (duplicate) {
        return err(
            `You already logged something very similar: "${duplicate.title}"`,
            mergeProposalCode(duplicate.existingWinId),
        );
    }

    try {
        const win = await winGraph.createWinRecord({
            userId,
            title: fields.title,
            narrative: fields.narrative,
            occurredAt: fields.occurredAt,
            category: fields.category,
            sensitivity: fields.sensitivity,
            source,
            sourceRef: sourceRef ?? null,
            signalId: signalId ?? null,
            skills: fields.skills,
            collaborators: fields.collaborators,
            confidence: fields.confidence,
            impact: fields.impact,
        });

        await track(userId, 'win_drafted', {
            ...FEATURE,
            source,
            confidence: fields.confidence,
            hasMetric: fields.impact !== null,
            degraded,
            prestructured: Boolean(supplied?.title?.trim()),
        });

        return winGraph.getWinView(userId, win.id);
    } catch (error) {
        // `Win.signalId` is unique: one Win per capture signal. A double-fire
        // returns the Win that already exists rather than an error.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && signalId) {
            const existing = await prisma.win.findFirst({ where: { userId, signalId }, select: { id: true } });
            if (existing) return winGraph.getWinView(userId, existing.id);
        }
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════ 2. confirm

export async function confirmWin(
    winId: string,
    patch?: WinPatch,
    evidence?: { source: string },
): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    const parsedPatch = patch === undefined ? undefined : WinPatchSchema.safeParse(patch);
    if (parsedPatch && !parsedPatch.success) return err(invalidInput(parsedPatch.error), 'invalid_input');

    const parsedEvidence = evidence === undefined ? undefined : EvidenceSourceSchema.safeParse(evidence);
    if (parsedEvidence && !parsedEvidence.success) {
        return err(invalidInput(parsedEvidence.error), 'invalid_input');
    }

    const before = await prisma.win.findFirst({
        where: { id: parsedId.data, userId },
        select: { source: true, createdAt: true, status: true },
    });

    const result = await winGraph.confirmWin({
        userId,
        winId: parsedId.data,
        patch: parsedPatch?.data,
        userSource: parsedEvidence?.data.source,
    });

    if (result.success && before && before.status !== WinStatus.confirmed) {
        await track(userId, 'win_confirmed', {
            ...FEATURE,
            source: before.source,
            surface: 'web',
            secondsFromDraft: Math.round((Date.now() - before.createdAt.getTime()) / 1000),
            edited: parsedPatch !== undefined,
            withUserEvidence: Boolean(parsedEvidence?.data.source),
        });
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════ 3. unconfirm

export async function unconfirmWin(winId: string): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    const result = await winGraph.unconfirmWin({ userId, winId: parsedId.data });
    if (result.success) await track(userId, 'win_unconfirmed', { ...FEATURE, winId: parsedId.data });
    return result;
}

// ═══════════════════════════════════════════════════════════════ 4. update

export async function updateWin(winId: string, patch: WinPatch): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    const parsedPatch = WinPatchSchema.safeParse(patch);
    if (!parsedPatch.success) return err(invalidInput(parsedPatch.error), 'invalid_input');

    const result = await winGraph.updateWin({ userId, winId: parsedId.data, patch: parsedPatch.data });

    if (result.success) {
        // The single most useful drafting-quality signal we collect: which field
        // the model gets wrong, and how often (PRD 01 §11).
        for (const field of Object.keys(parsedPatch.data)) {
            await track(userId, 'win_edited_field', { ...FEATURE, field, winId: parsedId.data });
        }
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════ 5. dismiss

export async function dismissWin(winId: string, reason: DismissReason): Promise<Result<void>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    const parsedReason = DismissReasonSchema.safeParse(reason);
    if (!parsedReason.success) return err('Invalid dismiss reason', 'invalid_input');

    const before = await prisma.win.findFirst({
        where: { id: parsedId.data, userId },
        select: { source: true },
    });

    const result = await winGraph.dismissWin({
        userId,
        winId: parsedId.data,
        reason: parsedReason.data,
    });

    if (result.success) {
        await track(userId, 'win_dismissed', {
            ...FEATURE,
            source: before?.source ?? null,
            reason: parsedReason.data,
        });
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════ 6. list

export async function listWins(
    filters: WinFilters,
    cursor?: WinCursor,
    limit?: number,
): Promise<Result<WinPage>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = WinFiltersSchema.safeParse(filters ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const parsedLimit = z.number().int().min(1).max(100).optional().safeParse(limit);
    if (!parsedLimit.success) return err('Invalid limit', 'invalid_input');

    const parsedCursor = z.string().max(200).optional().safeParse(cursor);
    if (!parsedCursor.success) return err('Invalid cursor', 'invalid_input');

    return winGraph.listWins({
        userId,
        filters: parsed.data as WinFilters,
        cursor: parsedCursor.data,
        limit: parsedLimit.data,
    });
}

// ═══════════════════════════════════════════════════════════════ 7. bulk

export async function bulkConfirm(winIds: string[]): Promise<Result<BulkResult>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z.array(WinIdSchema).min(1).max(100).safeParse(winIds);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const result = await winGraph.bulkConfirm({ userId, winIds: parsed.data });

    if (result.success && result.data.ok.length > 0) {
        await track(userId, 'win_confirmed', {
            ...FEATURE,
            surface: 'web',
            bulk: true,
            count: result.data.ok.length,
            failed: result.data.failed.length,
        });
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════ 8. summary

export async function getLogSummary(range?: { from?: Date; to?: Date }): Promise<Result<LogSummary>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z
        .object({ from: IsoDate.optional(), to: IsoDate.optional() })
        .optional()
        .safeParse(range);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    return winGraph.getLogSummary({ userId, range: parsed.data });
}

// ═════════════════════════════════════════ 9. structure without persisting

/**
 * Quick capture calls this on idle. Nothing is written, so an abandoned capture
 * leaves no draft behind — which is the whole reason it is separate from
 * `createWinFromText`. It is still the model call, so it is still metered and
 * still guarded.
 */
export async function structureDraft(text: string): Promise<Result<StructuredDraft>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z.string().min(1).max(8_000).safeParse(text);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    try {
        await gateMeteredAction(userId, WIN_DRAFT_ACTION);
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    const now = new Date();
    try {
        const structured = await structureWin({ userId, text: parsed.data, now });
        await track(userId, 'quick_capture_submitted', {
            ...FEATURE,
            charCount: parsed.data.length,
            confidence: structured.draft.confidence,
            degraded: structured.degraded,
        });
        return ok(toStructuredDraft(structured.draft, now));
    } catch (error) {
        console.error('[actions/wins] structureDraft failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return err('Could not structure that just now — try again', 'ai_unavailable');
    }
}

// ═══════════════════════════════════════════════════════════ 10. add impact

/**
 * The quantify prompt, answered — PRD 01 §6.3, and per §10 deliberately NOT
 * metered: the Context Interview mechanic is free in context.
 *
 * If the answer contains no figure, nothing is written and the failure says so.
 * Manufacturing a number here would poison the one field in the product whose
 * entire value is that it is true.
 */
export async function addImpact(winId: string, answer: string): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    const parsedAnswer = z.string().min(1).max(1_000).safeParse(answer);
    if (!parsedAnswer.success) return err(invalidInput(parsedAnswer.error), 'invalid_input');

    const win = await prisma.win.findFirst({
        where: { id: parsedId.data, userId },
        select: { title: true, narrative: true },
    });
    if (!win) return err('Win not found', 'not_found');

    let parsedImpact;
    try {
        parsedImpact = await parseImpactAnswer({ userId, answer: parsedAnswer.data, win });
    } catch (error) {
        console.error('[actions/wins] parseImpactAnswer failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return err('Could not read that answer just now — try again', 'ai_unavailable');
    }

    if (parsedImpact.kind === 'no_quantity') {
        // The Win is untouched. Say why, rather than inventing a figure.
        return err(
            'No number in that answer — try something like "about 40% faster" or "from 11 days to 7"',
            'no_quantity',
        );
    }

    const result = await winGraph.setWinImpact({
        userId,
        winId: parsedId.data,
        impact: parsedImpact.impact,
    });

    if (result.success) {
        await track(userId, 'quantify_prompt_answered', {
            ...FEATURE,
            winId: parsedId.data,
            degraded: parsedImpact.degraded,
        });
    }

    return result;
}

// ══════════════════════════════════════════ 11-13. archive / unarchive / delete

export async function archiveWin(winId: string): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    return winGraph.archiveWin({ userId, winId: parsedId.data });
}

export async function unarchiveWin(winId: string): Promise<Result<WinView>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    return winGraph.unarchiveWin({ userId, winId: parsedId.data });
}

/** Permanent. Distinct from dismiss, which is retained to train the noise filter. */
export async function deleteWin(winId: string): Promise<Result<void>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedId = WinIdSchema.safeParse(winId);
    if (!parsedId.success) return err('Invalid win id', 'invalid_input');

    return winGraph.deleteWin({ userId, winId: parsedId.data });
}

// ══════════════════════════════════════════════════════════ 14. employers

export async function listEmployers(): Promise<Result<EmployerOption[]>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    return winGraph.listEmployers({ userId });
}

// ───────────────────────────────────────────────────────────────────────────
// Compile-time proof that this module implements the orchestrator-owned
// contract. A drift in either direction is a type error here, not a runtime
// surprise in the log UI.
/* eslint-disable @typescript-eslint/no-unused-vars */
type Implements<A extends B, B> = A;
type _C1 = Implements<typeof createWinFromText, CreateWinFromText>;
type _C2 = Implements<typeof confirmWin, ConfirmWin>;
type _C3 = Implements<typeof unconfirmWin, UnconfirmWin>;
type _C4 = Implements<typeof updateWin, UpdateWin>;
type _C5 = Implements<typeof dismissWin, DismissWin>;
type _C6 = Implements<typeof listWins, ListWins>;
type _C7 = Implements<typeof bulkConfirm, BulkConfirm>;
type _C8 = Implements<typeof getLogSummary, GetLogSummary>;
type _C9 = Implements<typeof structureDraft, StructureDraft>;
type _C10 = Implements<typeof addImpact, AddImpact>;
type _C11 = Implements<typeof archiveWin, ArchiveWin>;
type _C12 = Implements<typeof unarchiveWin, UnarchiveWin>;
type _C13 = Implements<typeof deleteWin, DeleteWin>;
type _C14 = Implements<typeof listEmployers, ListEmployers>;
/* eslint-enable @typescript-eslint/no-unused-vars */
