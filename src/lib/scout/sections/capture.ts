/**
 * A note about the user's own work → a Work Log Win DRAFT.
 *
 * The same path the Work Log's quick capture takes (`createWinDraftForUser`):
 * the same metering, structuring, numeric guard and near-duplicate check. It
 * never confirms. Confirming is what writes Evidence (CLAUDE.md rule 5), and
 * that is the user's act: a Confirm button in chat, or the Work Log.
 *
 * Idempotent on `sourceRef = scout:<runId>`: a retried step, or a replayed
 * workflow, finds the draft it already made instead of making a second one.
 */

import { WinSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ScoutSection } from '@/lib/scout/section';
import { dataOf } from '@/lib/scout/section';
import type { CaptureData } from '@/lib/scout/types';
import { createWinDraftForUser, type WinDraftOutcome } from '@/services/wins';

type DraftCreator = typeof createWinDraftForUser;
let creator: DraftCreator = createWinDraftForUser;

export const __testing = {
    setCreator(next: DraftCreator | null) {
        creator = next ?? createWinDraftForUser;
    },
};

export function captureSourceRef(runId: string): string {
    return `scout:${runId}`;
}

function toCapture(outcome: WinDraftOutcome): CaptureData {
    return {
        winId: outcome.winId,
        title: outcome.title,
        narrative: outcome.narrative,
        category: outcome.category,
        skills: outcome.skills,
        status: outcome.status,
        duplicateOfWinId: outcome.duplicateOfWinId,
        degraded: outcome.degraded,
    };
}

export const captureSection: ScoutSection<'capture'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    const text = ingest?.text.trim() ?? '';
    if (!text) return { status: 'unavailable', reason: 'There was no text to add to your Work Log.' };

    const sourceRef = captureSourceRef(ctx.runId);
    const existing = await prisma.win.findFirst({
        where: { userId: ctx.userId, sourceRef },
        select: { id: true, title: true, narrative: true, category: true, skills: true },
    });
    if (existing) {
        ctx.step.log('capture reused existing draft', { winId: existing.id });
        return {
            status: 'ok',
            data: {
                winId: existing.id,
                title: existing.title,
                narrative: existing.narrative,
                category: existing.category,
                skills: Array.isArray(existing.skills) ? (existing.skills as string[]) : [],
                status: 'draft',
                duplicateOfWinId: null,
                degraded: false,
            },
        };
    }

    const source = ctx.input.source === 'telegram' || ctx.input.source === 'whatsapp' ? WinSource.chat : WinSource.manual;
    const result = await creator({ userId: ctx.userId, text, source, sourceRef, sessionId: ctx.runId });

    if (!result.success) {
        // A plan limit is an answer the user can act on; a model outage is a
        // failure the harness should retry and then report.
        if (result.code === 'entitlement_required') return { status: 'unavailable', reason: result.error };
        throw new Error(result.error);
    }

    ctx.step.addCost(result.data.costUsd);
    return { status: 'ok', data: toCapture(result.data) };
};
