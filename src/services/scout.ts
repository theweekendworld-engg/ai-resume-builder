/**
 * Scout's service layer — the one entry point for every surface.
 *
 * The dashboard's server actions, the Telegram and WhatsApp webhooks and the
 * extension all call these functions, so dedupe, metering and enqueueing
 * happen exactly once whatever the channel. Metering lives HERE rather than in
 * each action (the usual convention) because two of the four callers are
 * webhooks with no action in front of them; one gate in the shared path is
 * the only way the count cannot drift by channel.
 *
 * Never throws for expected failures: returns `Result`.
 */

import { randomUUID } from 'node:crypto';
import { start } from 'workflow/api';
import { Prisma, type Channel } from '@prisma/client';
import {
    appendResult,
    createOrGetRun,
    invalidateSections,
    loadRun,
    recordAnswer,
    type AgentRunRow,
    type PendingQuestion,
} from '@/lib/agent/run';
import { gateMeteredAction, isEntitlementError, refundMeteredAction } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { scoutInputKey } from '@/lib/scout/inputKey';
import { SCOUT_AGENT, type DraftFormat, type DraftTarget, type OutreachDraft, type ScoutInput, type ScoutRunSummary, type ScoutRunView } from '@/lib/scout/types';
import { toRunSummary, toRunView } from '@/lib/scout/view';
import { track } from '@/lib/track';

/**
 * Short on purpose: "shipped the retry queue today" is a complete Work Log
 * note (kind `work_note`). Anything below this is too little to classify.
 */
const MIN_TEXT = 15;
const MAX_TEXT = 100_000;

// ──────────────────────────────────────────────────────────────── enqueue

function shouldRunInline(): boolean {
    return process.env.NODE_ENV !== 'production';
}

/**
 * Hand the run to the workflow runtime, exactly once per claim.
 *
 * Claimed with a conditional `updateMany` (the repo's one concurrency pattern)
 * so a double-delivered webhook cannot start two workflows. `force` re-claims
 * a run that already ran — resuming after an answer, or a refresh.
 */
export async function enqueueScoutRun(runId: string, options: { force?: boolean } = {}): Promise<void> {
    const marker = `queued:${randomUUID()}`;
    const claimed = await prisma.agentRun.updateMany({
        where: { id: runId, ...(options.force ? {} : { workflowRunId: null }) },
        data: { workflowRunId: marker, status: 'queued' },
    });
    if (claimed.count === 0) return;

    try {
        if (shouldRunInline()) {
            const { runScoutStages } = await import('@/lib/scout/stages');
            const { INLINE_DRIVER } = await import('@/lib/scout/pipeline');
            // Detached: the caller is a request, and the user watches progress
            // by polling (dashboard) or by message edits (channels).
            void runScoutStages(runId, INLINE_DRIVER).catch((error: unknown) => {
                console.error('[scout] inline run failed', { runId, error: String(error) });
            });
            return;
        }
        const { handleScoutRunWorkflow } = await import('@/workflows/scoutRun');
        const run = await start(handleScoutRunWorkflow, [runId]);
        await prisma.agentRun.updateMany({
            where: { id: runId, workflowRunId: marker },
            data: { workflowRunId: run.runId },
        });
    } catch (error) {
        await prisma.agentRun.updateMany({
            where: { id: runId, workflowRunId: marker },
            data: { workflowRunId: null, status: 'failed', error: 'Could not start the analysis. Try again.' },
        });
        throw error;
    }
}

// ────────────────────────────────────────────────────────────────── start

export type StartScoutParams = {
    userId: string;
    input: ScoutInput;
    channel?: Channel;
    /** Channel handle for progress edits, e.g. `{chatId, messageId}`. */
    channelRef?: Record<string, unknown> | null;
};

export type StartScoutResult = { run: ScoutRunView; created: boolean };

function validateInput(input: ScoutInput): string | null {
    const url = input.url?.trim();
    const text = input.text?.trim();
    if (!url && !text) return 'Share a link or paste the post text';
    if (url) {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'That link is not a web page';
        } catch {
            return 'That does not look like a link';
        }
    }
    if (!url && text && text.length < MIN_TEXT) return 'That is too short to go on. Send a link, paste the post, or write a sentence about your work.';
    if (text && text.length > MAX_TEXT) return 'That is too long. Paste just the post or job description.';
    return null;
}

export async function startScoutRun(params: StartScoutParams): Promise<Result<StartScoutResult>> {
    const invalid = validateInput(params.input);
    if (invalid) return err(invalid, 'invalid_input');

    const input: ScoutInput = {
        url: params.input.url?.trim() || null,
        text: params.input.text?.trim() || null,
        title: params.input.title?.trim() || null,
        author: params.input.author?.trim() || null,
        authorUrl: params.input.authorUrl?.trim() || null,
        source: params.input.source,
    };
    const inputKey = scoutInputKey(input);

    // Dedupe BEFORE metering: sharing the same link twice is free.
    const existing = await prisma.agentRun.findUnique({
        where: { userId_inputKey: { userId: params.userId, inputKey } },
    });
    if (existing) {
        await track(params.userId, 'scout_run_reused', { runId: existing.id, channel: params.channel ?? 'web' });
        // A run that never got going (start() failed) is retried, not returned dead.
        if (existing.status === 'failed' && !existing.startedAt) {
            await enqueueScoutRun(existing.id, { force: true }).catch(() => undefined);
        }
        await rebindChannel(existing, params);
        const fresh = (await loadRun(existing.id)) ?? existing;
        return ok({ run: toRunView(fresh), created: false });
    }

    try {
        await gateMeteredAction(params.userId, 'link_analysis');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    const { run, created } = await createOrGetRun({
        userId: params.userId,
        agent: SCOUT_AGENT,
        inputKey,
        input: input as unknown as Record<string, unknown>,
        channel: params.channel ?? 'web',
        channelRef: params.channelRef ?? null,
    });
    // Lost a create race to an identical share: that one was charged, not this.
    if (!created) await refundMeteredAction(params.userId, 'link_analysis', { reason: 'scout_dedupe_race' });

    if (created) {
        try {
            await enqueueScoutRun(run.id);
        } catch {
            await refundMeteredAction(params.userId, 'link_analysis', { reason: 'scout_enqueue_failed' });
            return err('Could not start the analysis. Try again in a minute.', 'enqueue_failed');
        }
        await track(params.userId, 'scout_run_started', {
            runId: run.id,
            channel: params.channel ?? 'web',
            source: input.source,
            hasUrl: Boolean(input.url),
        });
    }

    const fresh = (await loadRun(run.id)) ?? run;
    return ok({ run: toRunView(fresh), created });
}

/**
 * The same link shared from a different channel moves progress messages to
 * where the user now is — they are looking at Telegram, not at the dashboard
 * tab they closed an hour ago.
 */
async function rebindChannel(run: AgentRunRow, params: StartScoutParams): Promise<void> {
    if (!params.channel || !params.channelRef) return;
    await prisma.agentRun.update({
        where: { id: run.id },
        data: { channel: params.channel, channelRef: params.channelRef as object },
    });
}

// ─────────────────────────────────────────────────────────────── refresh

export async function refreshScoutRun(userId: string, runId: string): Promise<Result<ScoutRunView>> {
    const run = await ownedRun(userId, runId);
    if (!run) return err('Not found', 'not_found');
    if (run.status === 'running' || run.status === 'queued') return ok(toRunView(run));

    try {
        await gateMeteredAction(userId, 'link_analysis');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    const names = Object.keys((run.result as Record<string, unknown> | null) ?? {}).filter((key) => key !== 'drafts');
    await invalidateSections(run.id, names);
    await prisma.agentRun.update({ where: { id: run.id }, data: { error: null, pendingQuestion: Prisma.DbNull } });
    await enqueueScoutRun(run.id, { force: true });
    return ok(toRunView((await loadRun(run.id)) ?? run));
}

// ──────────────────────────────────────────────────────────────── answer

/**
 * Answer the run's pending question and resume it.
 *
 * The conditional status flip is the concurrency guard: the same answer
 * arriving from a Telegram button and a dashboard click resumes once.
 * The answer is also written to the profile (`applyAnswerToProfile`), so the
 * next job does not ask again — the whole point of asking.
 */
export async function answerScoutQuestion(
    userId: string,
    runId: string,
    value: string,
): Promise<Result<ScoutRunView>> {
    const run = await ownedRun(userId, runId);
    if (!run) return err('Not found', 'not_found');
    const question = run.pendingQuestion as unknown as PendingQuestion | null;
    if (run.status !== 'awaiting_input' || !question) return err('There is no open question on this run', 'no_question');

    const answer = value.trim().slice(0, 500);
    if (!answer) return err('Answer is empty', 'invalid_input');
    // Free text is accepted even when the question offered options: a user
    // typing "Bangalore, but open to Pune" is answering better than a button.

    const flipped = await prisma.agentRun.updateMany({
        where: { id: run.id, status: 'awaiting_input' },
        data: { status: 'queued' },
    });
    if (flipped.count === 0) return ok(toRunView((await loadRun(run.id)) ?? run));

    await recordAnswer(run.id, question.id, answer);
    // The tracker row copies the fit verdict, so an answer that changes fit
    // must re-run track too, or the job tracker keeps the pre-answer verdict.
    await invalidateSections(run.id, question.step === 'fit' ? ['fit', 'track'] : [question.step]);

    const { applyAnswerToProfile } = await import('@/lib/scout/preferences');
    await applyAnswerToProfile(userId, question.id, answer).catch((error: unknown) => {
        console.warn('[scout] could not save answer to profile', { runId, questionId: question.id, error: String(error) });
    });

    await track(userId, 'scout_question_answered', { runId: run.id, questionId: question.id });
    await enqueueScoutRun(run.id, { force: true });
    return ok(toRunView((await loadRun(run.id)) ?? run));
}

// ──────────────────────────────────────────────────────────────── drafts

export type DraftParams = {
    target: DraftTarget;
    format: DraftFormat;
    contactId?: string | null;
    /** Optional steer from the user, e.g. "mention I used their SDK". */
    note?: string | null;
};

/** On demand only: drafts are the one output nobody gets unless they ask. */
export async function draftScoutOutreach(
    userId: string,
    runId: string,
    params: DraftParams,
): Promise<Result<OutreachDraft>> {
    const run = await ownedRun(userId, runId);
    if (!run) return err('Not found', 'not_found');
    if (run.kind !== 'job_posting' && run.kind !== 'hiring_post') {
        return err('Drafts are available for job links and hiring posts', 'not_applicable');
    }

    try {
        await gateMeteredAction(userId, 'cover_letter');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    try {
        const { generateOutreachDraft } = await import('@/lib/scout/outreach');
        const { draft, costUsd } = await generateOutreachDraft({ userId, runId, ...params });
        await appendResult(run.id, 'drafts', draft, costUsd);
        await track(userId, 'scout_draft_created', { runId, target: params.target, format: params.format });
        return ok(draft);
    } catch (error) {
        await refundMeteredAction(userId, 'cover_letter', { reason: 'scout_draft_failed' });
        console.warn('[scout] draft failed', { runId, error: String(error) });
        return err('Could not write that draft. Try again.', 'draft_failed');
    }
}

// ────────────────────────────────────────────────────────────────── reads

async function ownedRun(userId: string, runId: string): Promise<AgentRunRow | null> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    return run && run.userId === userId && run.agent === SCOUT_AGENT ? run : null;
}

export async function getScoutRun(userId: string, runId: string): Promise<Result<ScoutRunView>> {
    const run = await ownedRun(userId, runId);
    return run ? ok(toRunView(run)) : err('Not found', 'not_found');
}

export async function listScoutRuns(userId: string, limit = 30): Promise<ScoutRunSummary[]> {
    const runs = await prisma.agentRun.findMany({
        where: { userId, agent: SCOUT_AGENT },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
    });
    return runs.map(toRunSummary);
}

/** The latest run awaiting an answer, for channels that reply in free text. */
export async function findOpenQuestionRun(userId: string): Promise<ScoutRunView | null> {
    const run = await prisma.agentRun.findFirst({
        where: { userId, agent: SCOUT_AGENT, status: 'awaiting_input' },
        orderBy: { updatedAt: 'desc' },
    });
    return run ? toRunView(run) : null;
}

/** Step timeline for the run detail page: the same rows the operator sees. */
export async function getScoutRunSteps(userId: string, runId: string) {
    const run = await ownedRun(userId, runId);
    if (!run) return [];
    return prisma.agentStep.findMany({
        where: { runId },
        orderBy: [{ startedAt: 'asc' }],
        select: {
            id: true,
            name: true,
            status: true,
            attempt: true,
            reason: true,
            sources: true,
            costUsd: true,
            latencyMs: true,
            startedAt: true,
            finishedAt: true,
        },
    });
}
