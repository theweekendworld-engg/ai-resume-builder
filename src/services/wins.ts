/**
 * Work Log writes for a KNOWN user: no Clerk, no request.
 *
 * `src/actions/wins.ts` used to hold these paths inline, behind `auth()`. That
 * was fine while the dashboard was the only way in; the Telegram and WhatsApp
 * bots have a verified user id and no Clerk session, and a note sent to the bot
 * must become exactly the Win the Work Log would have made — same metering,
 * same structuring, same near-duplicate check, same telemetry. So the path
 * lives here once, and the server actions are auth + zod + a call into it.
 *
 * Confirmation is delegated to `winGraph.confirmWin` untouched: that is the
 * one transaction that writes Evidence(confirmedByUser=true) + ClaimLink
 * (CLAUDE.md rule 5). Nothing here re-implements it.
 */

import { Prisma, WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import { gateMeteredAction, isEntitlementError, type MeteredAction } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { track } from '@/lib/track';
import * as winGraph from '@/services/winGraph';
import { findNearDuplicate, resolveOccurredAt, structureWin } from '@/services/winDrafting';
import type { DismissReason, StructuredDraft, WinPatch, WinView } from '@/actions/wins.types';

/** See the note in `src/actions/wins.ts`: capture is never gated by plan. */
const WIN_DRAFT_ACTION = 'win_draft' as MeteredAction;

/** PRD 01 §11: every Work Log event is grouped by this tag. */
const FEATURE = { feature: 'work_log' } as const;

// ───────────────────────────────────────────────────────────── create

/** The already-validated create input (the action's zod output, or a bot's). */
export type CreateWinCoreInput = {
    userId: string;
    text?: string;
    draft?: Partial<StructuredDraft> & { title?: string };
    occurredAt?: Date;
    sensitivity?: WinSensitivity;
    source?: WinSource;
    sourceRef?: string | null;
    signalId?: string | null;
    employerId?: string | null;
    projectId?: string | null;
    /** Joins the structuring call's ApiUsageLog row to a caller's run. */
    sessionId?: string;
};

export type CreatedWin =
    | {
        kind: 'created';
        winId: string;
        title: string;
        narrative: string;
        category: WinCategory;
        skills: string[];
        degraded: boolean;
        /** Model spend for the structuring call; 0 when the draft was supplied. */
        costUsd: number;
    }
    /** A near-duplicate of an existing Win: nothing was written. */
    | { kind: 'duplicate'; existingWinId: string; title: string };

export async function createWinCore(input: CreateWinCoreInput): Promise<Result<CreatedWin>> {
    const { userId, text, draft: supplied, sensitivity, sourceRef, signalId } = input;
    const source = input.source ?? WinSource.manual;
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
    let costUsd = 0;

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
            occurredAt: input.occurredAt ?? supplied.occurredAt ?? now,
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
            structured = await structureWin({ userId, text: text as string, now, sessionId: input.sessionId });
        } catch (error) {
            console.error('[services/wins] structureWin failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return err('Could not structure that just now — try again', 'ai_unavailable');
        }

        const structuredDraft = structured.draft;
        degraded = structured.degraded;
        costUsd = structured.usage.costUsd;
        fields = {
            title: structuredDraft.title,
            narrative: structuredDraft.narrative,
            category: structuredDraft.category,
            skills: structuredDraft.skills,
            collaborators: structuredDraft.collaborators,
            confidence: structuredDraft.confidence,
            // The user's setting always wins; the model only proposes (§4.3).
            sensitivity: sensitivity ?? structuredDraft.suggestedSensitivity,
            occurredAt: input.occurredAt ?? resolveOccurredAt(structuredDraft, now),
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
        return ok({ kind: 'duplicate', existingWinId: duplicate.existingWinId, title: duplicate.title });
    }

    const created = (winId: string): CreatedWin => ({
        kind: 'created',
        winId,
        title: fields.title,
        narrative: fields.narrative,
        category: fields.category,
        skills: fields.skills,
        degraded,
        costUsd,
    });

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
            // Passing `undefined` keeps date-based inference; an explicit value
            // (including null) is honoured as stated.
            ...(input.employerId !== undefined ? { employerId: input.employerId } : {}),
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
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

        return ok(created(win.id));
    } catch (error) {
        // `Win.signalId` is unique: one Win per capture signal. A double-fire
        // returns the Win that already exists rather than an error.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && signalId) {
            const existing = await prisma.win.findFirst({ where: { userId, signalId }, select: { id: true } });
            if (existing) return ok(created(existing.id));
        }
        throw error;
    }
}

// ───────────────────────────────────────────────────────────── confirm

/** Where a confirmation came from. Telemetry only; the write is identical. */
export type ConfirmSurface = 'web' | 'chat';

export async function confirmWinCore(params: {
    userId: string;
    winId: string;
    patch?: WinPatch;
    userSource?: string;
    surface: ConfirmSurface;
}): Promise<Result<WinView>> {
    const { userId, winId } = params;
    const before = await prisma.win.findFirst({
        where: { id: winId, userId },
        select: { source: true, createdAt: true, status: true },
    });

    const result = await winGraph.confirmWin({
        userId,
        winId,
        patch: params.patch,
        userSource: params.userSource,
    });

    if (result.success && before && before.status !== WinStatus.confirmed) {
        await track(userId, 'win_confirmed', {
            ...FEATURE,
            source: before.source,
            surface: params.surface,
            secondsFromDraft: Math.round((Date.now() - before.createdAt.getTime()) / 1000),
            edited: params.patch !== undefined,
            withUserEvidence: Boolean(params.userSource),
        });
    }

    return result;
}

export async function dismissWinCore(params: {
    userId: string;
    winId: string;
    reason: DismissReason;
}): Promise<Result<void>> {
    const before = await prisma.win.findFirst({
        where: { id: params.winId, userId: params.userId },
        select: { source: true },
    });

    const result = await winGraph.dismissWin(params);

    if (result.success) {
        await track(params.userId, 'win_dismissed', {
            ...FEATURE,
            source: before?.source ?? null,
            reason: params.reason,
        });
    }

    return result;
}

// ───────────────────────────────────────────────────── bot-facing contract

export type WinDraftOutcome = {
    winId: string;
    title: string;
    narrative: string;
    category: string;
    skills: string[];
    status: 'draft' | 'merge_proposed';
    duplicateOfWinId: string | null;
    degraded: boolean;
    /** Model spend for the structuring call, for callers with their own ledger. */
    costUsd: number;
};

/** Create a Win DRAFT from free text for a known user (no Clerk session). */
export async function createWinDraftForUser(params: {
    userId: string;
    text: string;
    source: WinSource;
    sourceRef?: string | null;
    sessionId?: string;
}): Promise<Result<WinDraftOutcome>> {
    const text = params.text.trim();
    if (!text) return err('Nothing to log', 'invalid_input');

    const result = await createWinCore({
        userId: params.userId,
        text: text.slice(0, 8_000),
        source: params.source,
        sourceRef: params.sourceRef ?? null,
        sessionId: params.sessionId,
    });
    if (!result.success) return result;

    const value = result.data;
    if (value.kind === 'duplicate') {
        const existing = await prisma.win.findFirst({
            where: { id: value.existingWinId, userId: params.userId },
            select: { title: true, narrative: true, category: true },
        });
        return ok({
            winId: value.existingWinId,
            title: existing?.title ?? value.title,
            narrative: existing?.narrative ?? '',
            category: existing?.category ?? WinCategory.shipped,
            skills: [],
            status: 'merge_proposed',
            duplicateOfWinId: value.existingWinId,
            degraded: false,
            costUsd: 0,
        });
    }

    return ok({
        winId: value.winId,
        title: value.title,
        narrative: value.narrative,
        category: value.category,
        skills: value.skills,
        status: 'draft',
        duplicateOfWinId: null,
        degraded: value.degraded,
        costUsd: value.costUsd,
    });
}

/** Confirm a Win for a known user: Evidence + ClaimLink in one transaction (rule 5). */
export async function confirmWinForUser(userId: string, winId: string): Promise<Result<{ winId: string; title: string }>> {
    const result = await confirmWinCore({ userId, winId, surface: 'chat' });
    if (!result.success) return result;
    return ok({ winId: result.data.id, title: result.data.title });
}

export async function dismissWinForUser(userId: string, winId: string): Promise<Result<void>> {
    return dismissWinCore({ userId, winId, reason: 'user' });
}
