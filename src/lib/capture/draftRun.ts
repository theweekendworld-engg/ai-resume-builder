/**
 * The drafting stage — stored signals in, Win drafts out. PRD 02 §4, §6.5.
 *
 * Split from `sync.ts` and run as its own job for two reasons. The pull is
 * network-bound and the drafting is model-bound, and mixing them means one
 * rate-limited GitHub call can eat the budget that forty model calls needed.
 * More importantly it lets the sync succeed and the drafting retry, which is
 * the shape that keeps the promise "never fail a digest because a sync was
 * incomplete".
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 * Signals are CLAIMED before the model call, with a conditional `updateMany`
 * that restates `processedAt IS NULL` — the same idiom as `gateMeteredAction`
 * (`src/lib/entitlements.ts:226`). Two overlapping runs therefore cannot both
 * pay for the same candidate. `Win.signalId` being unique is the backstop, not
 * the plan: by the time it fires we have already spent the money.
 */

import { CaptureRunStatus, WinCategory, WinSensitivity, WinSource, type CaptureSignal } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import { createWinRecord } from '@/services/winGraph';
import {
    BACKFILL_DRAFT_CAP,
    MODEL_CALLS_PER_RUN,
    WEEKLY_DRAFT_CAP,
} from './caps';
import { buildCandidateContext, draftCandidate, scoreCandidate, type SanitizedDraft } from './drafting';
import { NOISE_RULES } from './noise';
import { requireAdapter } from './registry';
import { shouldDraftAtConfidence } from './confidence';
import type { SyncTrigger } from './sync';
import { isSignalKind, type CaptureAdapter, type RawSignal, type SignalGroup } from './types';

export type DraftRunSummary = {
    candidates: number;
    drafted: number;
    skipped: number;
    modelCalls: number;
    costUsd: number;
    status: CaptureRunStatus;
    /** Win ids in the order they were created, strongest first. */
    winIds: string[];
};

/** §6.5 — 40 on the initial backfill, otherwise bounded by the model-call cap. */
export function draftCapFor(trigger: SyncTrigger): number {
    return trigger === 'initial' ? BACKFILL_DRAFT_CAP : MODEL_CALLS_PER_RUN;
}

/**
 * §6.5 — the weekly digest surfaces five. The rest are drafted and land in the
 * log's "Needs review", which is why this is a *selection* rather than a cap on
 * drafting: "+7 more in your log" is only true if the 7 exist.
 *
 * Exported for the digest composer so the cut is made in one place.
 */
export function selectDigestDrafts<T extends { confidence: number }>(
    drafts: readonly T[],
    cap: number = WEEKLY_DRAFT_CAP,
): { surfaced: T[]; overflow: number } {
    const ranked = [...drafts].sort((a, b) => b.confidence - a.confidence);
    return { surfaced: ranked.slice(0, cap), overflow: Math.max(0, ranked.length - cap) };
}

// ───────────────────────────────────────────────────── row → signal

export function toRawSignal(row: CaptureSignal): RawSignal {
    return {
        externalId: row.externalId,
        kind: isSignalKind(row.kind) ? row.kind : 'pr_merged',
        occurredAt: row.occurredAt,
        title: row.title,
        body: row.body,
        url: row.url,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
}

// ───────────────────────────────────────────────────── role context

/** "Senior Backend Engineer at Acme" — §4.2's `user's role context`. */
export async function roleContextFor(userId: string): Promise<string | null> {
    const experience = await prisma.userExperience.findFirst({
        where: { userId },
        orderBy: [{ current: 'desc' }, { updatedAt: 'desc' }],
        select: { role: true, company: true },
    });
    if (!experience?.role) return null;
    return experience.company ? `${experience.role} at ${experience.company}` : experience.role;
}

// ───────────────────────────────────────────────────── candidate ranking

export type RankedCandidate = {
    group: SignalGroup;
    /** DB ids of every member, for claiming. */
    signalIds: string[];
    primarySignalId: string;
    confidence: number;
};

export function rankCandidates(
    adapter: CaptureAdapter,
    rows: readonly CaptureSignal[],
    roleContext: string | null,
): RankedCandidate[] {
    const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
    const groups = adapter.group(rows.map(toRawSignal));

    return groups
        .map((group) => {
            const context = buildCandidateContext(group, roleContext);
            const signalIds = group.signals
                .map((signal) => byExternalId.get(signal.externalId)?.id)
                .filter((id): id is string => Boolean(id));
            return {
                group,
                signalIds,
                primarySignalId: byExternalId.get(group.primary.externalId)?.id ?? '',
                confidence: scoreCandidate(context).score,
            };
        })
        .filter((candidate) => candidate.primarySignalId !== '')
        .sort((a, b) => b.confidence - a.confidence);
}

// ───────────────────────────────────────────────────── claiming

/**
 * Take exclusive ownership of a candidate's signals.
 *
 * All-or-nothing on the primary: if another run already claimed it we do not
 * proceed, even if the secondary members are still free. Half a group is a
 * different Win from the whole group.
 */
export async function claimCandidate(candidate: RankedCandidate, now: Date): Promise<boolean> {
    const primary = await prisma.captureSignal.updateMany({
        where: { id: candidate.primarySignalId, processedAt: null },
        data: { processedAt: now, groupKey: candidate.group.key },
    });
    if (primary.count !== 1) return false;

    const others = candidate.signalIds.filter((id) => id !== candidate.primarySignalId);
    if (others.length > 0) {
        await prisma.captureSignal.updateMany({
            where: { id: { in: others }, processedAt: null },
            data: { processedAt: now, groupKey: candidate.group.key },
        });
    }
    return true;
}

/** Release a claim so a later run can retry a candidate we could not finish. */
async function releaseCandidate(candidate: RankedCandidate): Promise<void> {
    await prisma.captureSignal.updateMany({
        where: { id: { in: candidate.signalIds }, winId: null },
        data: { processedAt: null },
    });
}

// ───────────────────────────────────────────────────── the run

export type DraftRunParams = {
    userId: string;
    sourceId: string;
    runId: string | null;
    trigger: SyncTrigger;
    now?: Date;
    /** Injected by tests. */
    adapter?: CaptureAdapter;
    maxDrafts?: number;
    maxModelCalls?: number;
};

export async function runDrafting(params: DraftRunParams): Promise<DraftRunSummary> {
    const now = params.now ?? new Date();
    const source = await prisma.captureSource.findUnique({ where: { id: params.sourceId } });

    const empty: DraftRunSummary = {
        candidates: 0,
        drafted: 0,
        skipped: 0,
        modelCalls: 0,
        costUsd: 0,
        status: CaptureRunStatus.success,
        winIds: [],
    };
    if (!source) return empty;

    const adapter = params.adapter ?? requireAdapter(source.kind);
    const maxDrafts = params.maxDrafts ?? draftCapFor(params.trigger);
    const maxModelCalls = params.maxModelCalls ?? MODEL_CALLS_PER_RUN;

    const rows = await prisma.captureSignal.findMany({
        where: { sourceId: source.id, processedAt: null, isNoise: false, winId: null },
        orderBy: { occurredAt: 'desc' },
        // A generous read bound: grouping needs to see neighbours to cluster them,
        // but an unbounded read on a 400-PR backfill is a memory hazard.
        take: 500,
    });
    if (rows.length === 0) return empty;

    const roleContext = await roleContextFor(source.userId);
    const candidates = rankCandidates(adapter, rows, roleContext);

    // Below 0.20 we do not draft at all (§4.3). Mark them terminal so they never
    // re-enter the queue — the signal is kept, the decision is recorded.
    const tooThin = candidates.filter((candidate) => !shouldDraftAtConfidence(candidate.confidence));
    if (tooThin.length > 0) {
        await prisma.captureSignal.updateMany({
            where: { id: { in: tooThin.flatMap((candidate) => candidate.signalIds) }, processedAt: null },
            data: { processedAt: now, isNoise: true, noiseRule: NOISE_RULES.belowDraftThreshold },
        });
    }

    const eligible = candidates.filter((candidate) => shouldDraftAtConfidence(candidate.confidence));

    let drafted = 0;
    let skipped = 0;
    let modelCalls = 0;
    let costUsd = 0;
    let hitCap = false;
    const winIds: string[] = [];

    for (const candidate of eligible) {
        if (drafted >= maxDrafts || modelCalls >= maxModelCalls) {
            hitCap = true;
            break;
        }

        const claimed = await claimCandidate(candidate, now);
        if (!claimed) continue; // another run owns it

        const context = buildCandidateContext(candidate.group, roleContext);
        const outcome = await draftCandidate({
            userId: source.userId,
            context,
            confidence: candidate.confidence,
        });

        if (outcome.usage) {
            modelCalls += outcome.usage.calls;
            costUsd += outcome.usage.costUsd;
        }

        if (!outcome.drafted) {
            skipped += 1;
            // The claim stands: a candidate the model declined is a decision, not
            // a failure, and re-asking next week would just spend again.
            await prisma.captureSignal.updateMany({
                where: { id: { in: candidate.signalIds } },
                data: { isNoise: true, noiseRule: outcome.reason.slice(0, 80) },
            });
            continue;
        }

        try {
            const winId = await persistDraft({
                userId: source.userId,
                candidate,
                draft: outcome.draft,
                degraded: outcome.degraded,
            });
            winIds.push(winId);
            drafted += 1;
        } catch (error: unknown) {
            // A failed write must not strand the signals — release so the next
            // run can retry rather than losing the Win permanently.
            await releaseCandidate(candidate);
            console.error('[capture/draftRun] persist failed', {
                sourceId: source.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const status = hitCap ? CaptureRunStatus.degraded : CaptureRunStatus.success;

    if (params.runId) {
        await prisma.captureRun.update({
            where: { id: params.runId },
            data: {
                candidates: eligible.length,
                winsDrafted: drafted,
                costUsd,
                status,
                finishedAt: new Date(),
            },
        });
    }

    return { candidates: eligible.length, drafted, skipped, modelCalls, costUsd, status, winIds };
}

// ───────────────────────────────────────────────────── persistence

/**
 * Write the Win and bind every member signal to it.
 *
 * `occurredAt` is the earliest member and `periodEnd` the latest — a refactor
 * spread over six PRs is one Win that took two weeks, and the log renders that
 * as a period rather than pretending it happened on the merge date of the last
 * commit.
 */
async function persistDraft(params: {
    userId: string;
    candidate: RankedCandidate;
    draft: SanitizedDraft;
    degraded: boolean;
}): Promise<string> {
    const occurrences = params.candidate.group.signals.map((signal) => signal.occurredAt.getTime());
    const occurredAt = new Date(Math.min(...occurrences));
    const latest = new Date(Math.max(...occurrences));
    const periodEnd = latest.getTime() > occurredAt.getTime() ? latest : null;

    const win = await createWinRecord({
        userId: params.userId,
        title: params.draft.title,
        narrative: params.draft.narrative,
        occurredAt,
        periodEnd,
        category: params.draft.category ?? WinCategory.shipped,
        sensitivity: params.draft.suggestedSensitivity ?? WinSensitivity.shareable,
        source: WinSource.github,
        sourceRef: params.candidate.group.primary.url,
        signalId: params.candidate.primarySignalId,
        skills: params.draft.skills,
        collaborators: params.draft.collaborators,
        confidence: params.draft.confidence,
        impact: params.draft.quantified ? params.draft.impact : null,
    });

    await prisma.captureSignal.updateMany({
        where: { id: { in: params.candidate.signalIds } },
        data: { winId: win.id },
    });

    await track(params.userId, 'win_drafted', {
        feature: 'github_capture',
        source: WinSource.github,
        confidence: params.draft.confidence,
        hasMetric: params.draft.impact !== null,
        degraded: params.degraded,
        groupSize: params.candidate.group.signals.length,
        signalKind: params.candidate.group.kind,
    });

    return win.id;
}
