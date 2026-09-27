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
import { METER_KEY, readMeter, recordCharge, refreshCharge, refundCharge } from '@/lib/scout/metering';
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

type Starter = (runId: string) => Promise<{ runId: string }>;
type StagesRunner = (runId: string) => Promise<void>;

const defaultStarter: Starter = async (runId) => {
    const { handleScoutRunWorkflow } = await import('@/workflows/scoutRun');
    return start(handleScoutRunWorkflow, [runId]);
};
const defaultStagesRunner: StagesRunner = async (runId) => {
    const { runScoutStages } = await import('@/lib/scout/stages');
    const { INLINE_DRIVER } = await import('@/lib/scout/pipeline');
    await runScoutStages(runId, INLINE_DRIVER);
};

let starter: Starter = defaultStarter;
let stagesRunner: StagesRunner = defaultStagesRunner;

export const __testing = {
    setStarter(next: Starter | null) {
        starter = next ?? defaultStarter;
    },
    setStagesRunner(next: StagesRunner | null) {
        stagesRunner = next ?? defaultStagesRunner;
    },
};

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

    if (shouldRunInline()) {
        await runInRequest(runId, marker, 'dev');
        return;
    }

    try {
        const run = await starter(runId);
        await prisma.agentRun.updateMany({
            where: { id: runId, workflowRunId: marker },
            data: { workflowRunId: run.runId },
        });
    } catch (error) {
        // Durable start failed. Log WHY, loudly — the first production run
        // failed here and the reason was swallowed, which is the one thing an
        // observable agent must never do — then run the same stages inside
        // this request instead. A run is ~20–45s, well inside the 300s function
        // limit; losing durability is better than losing the run.
        console.error('[scout] workflow start failed; running in-request', {
            runId,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        await runInRequest(runId, marker, 'fallback');
    }
}

/**
 * Run the stages in the current request, kept alive past the response with
 * `after()` where there is a request to extend (webhooks, actions, routes).
 * Outside a request scope `after` throws, and the run proceeds detached, which
 * is what local development always did.
 */
async function runInRequest(runId: string, marker: string, why: 'dev' | 'fallback'): Promise<void> {
    await prisma.agentRun.updateMany({
        where: { id: runId, workflowRunId: marker },
        data: { workflowRunId: `inline:${why}:${marker.slice('queued:'.length)}` },
    });
    const work = () => stagesRunner(runId).catch(async (error: unknown) => {
        console.error('[scout] in-request run failed', { runId, error: String(error) });
        await prisma.agentRun.updateMany({
            where: { id: runId, status: { in: ['queued', 'running'] } },
            data: { status: 'failed', error: 'The analysis stopped unexpectedly. Try again.' },
        }).catch(() => undefined);
    });
    try {
        const { after } = await import('next/server');
        after(work);
    } catch {
        void work();
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
        // Rebind FIRST: a restarted run must edit the progress message the
        // user just received, not the one from their previous attempt.
        await rebindChannel(existing, params);
        // A run that never got going (start() failed) is retried, not returned
        // dead, and reported as started so the channel shows progress instead
        // of replaying the old failure. Free: it was never charged to success.
        if (existing.status === 'failed' && !existing.startedAt) {
            // Its unit was refunded when the start failed; the retry is the
            // analysis the user gets, so it takes one again. Kinds that turn
            // out not to be jobs still get it back at classify.
            const meter = readMeter(existing.result);
            if (!meter || meter.refunded) {
                try {
                    await gateMeteredAction(params.userId, 'link_analysis');
                } catch (error) {
                    if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
                    throw error;
                }
                await recordCharge(existing.id);
            }
            try {
                await enqueueScoutRun(existing.id, { force: true });
                const restarted = (await loadRun(existing.id)) ?? existing;
                return ok({ run: toRunView(restarted), created: true });
            } catch (error) {
                console.error('[scout] restart failed', { runId: existing.id, error: String(error) });
                await refundCharge(existing.id, params.userId, 'scout_enqueue_failed');
            }
        }
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
        // The receipt goes on BEFORE the run starts, so classification can
        // hand the unit back for non-job kinds (see src/lib/scout/metering.ts).
        await recordCharge(run.id);
        try {
            await enqueueScoutRun(run.id);
        } catch (error) {
            console.error('[scout] could not start run', { runId: run.id, error: String(error) });
            await refundCharge(run.id, params.userId, 'scout_enqueue_failed');
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

    // Refreshing a job within 7 days of its last charge is free; a non-job run
    // is always free (src/lib/scout/metering.ts: `refreshCharge`).
    const charge = refreshCharge(run);
    if (charge) {
        try {
            await gateMeteredAction(userId, 'link_analysis');
        } catch (error) {
            if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
            throw error;
        }
        await recordCharge(run.id);
    }

    // `drafts` and the meter receipt are not sections and must survive.
    const names = Object.keys((run.result as Record<string, unknown> | null) ?? {})
        .filter((key) => key !== 'drafts' && key !== METER_KEY);
    await invalidateSections(run.id, names);
    await prisma.agentRun.update({ where: { id: run.id }, data: { error: null, pendingQuestion: Prisma.DbNull } });
    try {
        await enqueueScoutRun(run.id, { force: true });
    } catch (error) {
        if (charge) await refundCharge(run.id, userId, 'scout_refresh_enqueue_failed');
        throw error;
    }
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
