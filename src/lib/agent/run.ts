/**
 * The agent run ledger: `AgentRun` + `AgentStep` (docs/impl/06-scout-agent.md §3).
 *
 * Domain-agnostic on purpose. Scout is the first agent on it; the next one
 * should need no new table and no new dashboard, only new step functions.
 *
 * ── The four guarantees ────────────────────────────────────────────────────
 *
 * 1. Every step leaves a row, whatever happens inside it — success, a thrown
 *    error, a timeout, a budget stop. There is no code path where work
 *    happened and the timeline does not say so.
 * 2. A step that fails does not fail the run. It becomes a section with a
 *    reason, and the run ends `partial`. Only the steps a run cannot proceed
 *    without (`critical`) take the run down with them.
 * 3. Result and cost writes are single atomic SQL statements, because the
 *    job path runs five sections concurrently and a read-modify-write of one
 *    JSON column would lose four of them.
 * 4. A step whose result is already `ok` is not re-run. Resuming after a
 *    question, or a crashed workflow retrying, re-enters the same plan and only
 *    pays for what is missing.
 */

import { Prisma, type AgentRunStatus, type Channel } from '@prisma/client';
import { generateStructured, type GenerateStructuredOptions, type GenerateStructuredResult } from '@/lib/ai/structured';
import type { FeatureTag } from '@/lib/ai/features';
import { prisma } from '@/lib/prisma';
import { SourceSet, type SourceRef } from '@/lib/agent/sources';
import type { z } from 'zod';

// ─────────────────────────────────────────────────────────────────── types

export type PendingQuestion = {
    /** Stable id; answers are keyed by it. */
    id: string;
    /** Which step asked, so the answer invalidates exactly that step. */
    step: string;
    prompt: string;
    /** When present, the channel renders buttons instead of asking for text. */
    options?: { value: string; label: string }[];
    /** ISO time the run paused on it. Set by `pauseForInput`. */
    askedAt?: string;
};

/**
 * What a step function returns. `unavailable` and `skipped` are answers, not
 * errors: "we have no comp data for this company" is a true statement the user
 * is entitled to see, with its reason.
 */
export type StepOutcome<T> =
    | { status: 'ok'; data: T }
    | { status: 'unavailable'; reason: string; data?: T }
    | { status: 'skipped'; reason: string }
    | { status: 'needs_input'; question: PendingQuestion; data?: T };

/** How a section's outcome is stored in `AgentRun.result[name]`. */
export type StoredSection<T = unknown> =
    | { status: 'ok'; data: T; sources: SourceRef[]; finishedAt: string }
    | { status: 'unavailable'; reason: string; data?: T; sources: SourceRef[]; finishedAt: string }
    | { status: 'skipped'; reason: string; finishedAt: string }
    | { status: 'failed'; reason: string; finishedAt: string }
    | { status: 'needs_input'; question: PendingQuestion; data?: T; finishedAt: string };

export type StepContext = {
    runId: string;
    userId: string;
    stepName: string;
    /** Register everything fetched here; only these URLs may be cited. */
    sources: SourceSet;
    /** Aborted at the step deadline. Pass to fetch. */
    signal: AbortSignal;
    /**
     * `generateStructured` with the run's identity filled in: the userId, the
     * run id as `sessionId` (so `ApiUsageLog` rows join to the run) and cost
     * accounting onto the step. The only way a step talks to a model.
     */
    ai: <T extends z.ZodType>(
        opts: Omit<GenerateStructuredOptions<T>, 'userId' | 'sessionId' | 'feature'> & { feature?: FeatureTag },
    ) => Promise<GenerateStructuredResult<z.infer<T>>>;
    /** Non-model spend (search credits). Counted against the run budget. */
    addCost: (usd: number) => void;
    log: (message: string, extra?: Record<string, unknown>) => void;
};

export type StepOptions = {
    /** Default 25s. A hung vendor must not stall the whole run. */
    timeoutMs?: number;
    /** Attempts on a thrown error. Default 2 (one retry). */
    maxAttempts?: number;
    /** When true, a failure fails the run instead of degrading it. */
    critical?: boolean;
    /** Re-run even if a stored `ok` result exists. */
    force?: boolean;
    /** Feature tag for model calls made inside the step. */
    feature: FeatureTag;
};

export class RunAbortedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RunAbortedError';
    }
}

export class StepTimeoutError extends Error {
    constructor(step: string, ms: number) {
        super(`${step} timed out after ${ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`}`);
        this.name = 'StepTimeoutError';
    }
}

// ────────────────────────────────────────────────────────────── budgets

export type RunBudget = { maxSteps: number; maxCostUsd: number };

/**
 * Default ceilings per agent. Scout's covers a cold research cache: up to ~8
 * searches at $0.008 plus ~$0.01 of gpt-6-luna. A warm cache costs a fraction
 * of this. Hitting the ceiling skips the remaining sections with a stated
 * reason; it never fails the run.
 */
const DEFAULT_BUDGETS: Record<string, RunBudget> = {
    scout: { maxSteps: 24, maxCostUsd: 0.15 },
};

/** Per-agent ceilings. Env-overridable so a bad day is a config change. */
export function budgetFor(agent: string): RunBudget {
    const upper = agent.toUpperCase();
    const steps = Number(process.env[`AGENT_${upper}_MAX_STEPS`]);
    const cost = Number(process.env[`AGENT_${upper}_MAX_COST_USD`]);
    const fallback = DEFAULT_BUDGETS[agent] ?? { maxSteps: 24, maxCostUsd: 0.1 };
    return {
        maxSteps: Number.isFinite(steps) && steps > 0 ? steps : fallback.maxSteps,
        maxCostUsd: Number.isFinite(cost) && cost > 0 ? cost : fallback.maxCostUsd,
    };
}

// ──────────────────────────────────────────────────────────── run CRUD

export type RunInit = {
    userId: string;
    agent: string;
    inputKey: string;
    input: Record<string, unknown>;
    channel?: Channel;
    channelRef?: Record<string, unknown> | null;
};

/**
 * Create the run, or return the existing one for the same input.
 *
 * The unique `(userId, inputKey)` is the idempotency: a user who shares the
 * same link from Telegram and then from the dashboard gets one run, and a
 * double-delivered webhook cannot start two.
 */
export async function createOrGetRun(init: RunInit): Promise<{ run: AgentRunRow; created: boolean }> {
    const existing = await prisma.agentRun.findUnique({
        where: { userId_inputKey: { userId: init.userId, inputKey: init.inputKey } },
    });
    if (existing) return { run: existing, created: false };

    try {
        const run = await prisma.agentRun.create({
            data: {
                userId: init.userId,
                agent: init.agent,
                inputKey: init.inputKey,
                input: init.input as Prisma.InputJsonValue,
                channel: init.channel ?? 'web',
                channelRef: (init.channelRef ?? undefined) as Prisma.InputJsonValue | undefined,
            },
        });
        return { run, created: true };
    } catch (error) {
        // Lost a race with a concurrent create for the same input.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const run = await prisma.agentRun.findUniqueOrThrow({
                where: { userId_inputKey: { userId: init.userId, inputKey: init.inputKey } },
            });
            return { run, created: false };
        }
        throw error;
    }
}

export type AgentRunRow = Awaited<ReturnType<typeof prisma.agentRun.findUniqueOrThrow>>;

export async function loadRun(runId: string): Promise<AgentRunRow | null> {
    return prisma.agentRun.findUnique({ where: { id: runId } });
}

export function readSections(run: Pick<AgentRunRow, 'result'>): Record<string, StoredSection> {
    const value = run.result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as unknown as Record<string, StoredSection>;
}

export function readAnswers(run: Pick<AgentRunRow, 'answers'>): Record<string, string> {
    const value = run.answers;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string') out[key] = raw;
    }
    return out;
}

export async function markRunning(runId: string): Promise<void> {
    await prisma.agentRun.updateMany({
        where: { id: runId, status: { in: ['queued', 'awaiting_input', 'partial', 'succeeded', 'failed'] } },
        data: { status: 'running', startedAt: new Date(), finishedAt: null, error: null },
    });
}

/**
 * Merge one section into `result` and add cost — one statement, so concurrent
 * sections cannot overwrite each other (guarantee 3).
 */
async function writeSection(runId: string, name: string, section: StoredSection, costUsd: number): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = COALESCE("result", '{}'::jsonb) || jsonb_build_object(${name}::text, ${JSON.stringify(section)}::jsonb),
            "costUsd" = "costUsd" + ${costUsd},
            "stepCount" = "stepCount" + 1,
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

/** Drop sections so the next pass recomputes them (e.g. after an answer). */
export async function invalidateSections(runId: string, names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = COALESCE("result", '{}'::jsonb) - ${[...names]}::text[],
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

export async function recordAnswer(runId: string, questionId: string, value: string): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "answers" = COALESCE("answers", '{}'::jsonb) || jsonb_build_object(${questionId}::text, ${value}::text),
            "pendingQuestion" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

/** Merge arbitrary keys into `result` without counting a step (drafts, etc). */
export async function mergeResult(runId: string, key: string, value: unknown, costUsd = 0): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = COALESCE("result", '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb),
            "costUsd" = "costUsd" + ${costUsd},
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

/** Append one item to an array under `result[key]`, atomically. */
export async function appendResult(runId: string, key: string, item: unknown, costUsd = 0): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = jsonb_set(
                COALESCE("result", '{}'::jsonb),
                ARRAY[${key}::text],
                COALESCE("result"->${key}, '[]'::jsonb) || jsonb_build_array(${JSON.stringify(item)}::jsonb)
            ),
            "costUsd" = "costUsd" + ${costUsd},
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

export async function setRunKind(runId: string, kind: string): Promise<void> {
    await prisma.agentRun.update({ where: { id: runId }, data: { kind } });
}

export async function pauseForInput(runId: string, question: PendingQuestion): Promise<void> {
    // `askedAt` lets channels tell a reply from new input (answerMatch.ts).
    const asked = { ...question, askedAt: new Date().toISOString() };
    await prisma.agentRun.update({
        where: { id: runId },
        data: { status: 'awaiting_input', pendingQuestion: asked as unknown as Prisma.InputJsonValue },
    });
}

/**
 * Settle the run's status from its sections.
 *
 * `failed` only when a critical step failed (caller passes `error`) or nothing
 * at all succeeded. Anything unavailable or failed alongside something that
 * worked is `partial` — the honest word for "here is most of it".
 */
export function settleStatus(sections: Record<string, StoredSection>, error?: string | null): AgentRunStatus {
    if (error) return 'failed';
    const values = Object.values(sections);
    if (values.some((section) => section.status === 'needs_input')) return 'awaiting_input';
    const ok = values.filter((section) => section.status === 'ok').length;
    const degraded = values.filter((section) => section.status === 'failed' || section.status === 'unavailable').length;
    if (ok === 0 && degraded > 0) return 'failed';
    return degraded > 0 ? 'partial' : 'succeeded';
}

export async function finishRun(runId: string, error?: string | null): Promise<AgentRunStatus> {
    const run = await loadRun(runId);
    if (!run) return 'failed';
    const status = settleStatus(readSections(run), error);
    await prisma.agentRun.update({
        where: { id: runId },
        data: {
            status,
            error: error ?? null,
            finishedAt: status === 'awaiting_input' ? null : new Date(),
        },
    });
    return status;
}

// ─────────────────────────────────────────────────────────────── steps

async function nextAttempt(runId: string, name: string): Promise<number> {
    const last = await prisma.agentStep.findFirst({
        where: { runId, name },
        orderBy: { attempt: 'desc' },
        select: { attempt: true },
    });
    return (last?.attempt ?? 0) + 1;
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, name: string): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new StepTimeoutError(name, ms));
        }, ms);
    });
    return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

function reasonFrom(error: unknown): string {
    if (error instanceof StepTimeoutError) return error.message;
    if (error instanceof Error) return error.message.slice(0, 300);
    return String(error).slice(0, 300);
}

/**
 * Run one named step of a run, durably recorded.
 *
 * Returns the stored section. Never throws for a step failure unless the step
 * is `critical`; then it throws `RunAbortedError` so the pipeline stops and the
 * run is marked failed with the reason.
 */
export async function runStep<T>(
    runId: string,
    name: string,
    fn: (ctx: StepContext) => Promise<StepOutcome<T>>,
    options: StepOptions,
): Promise<StoredSection<T>> {
    const run = await loadRun(runId);
    if (!run) throw new RunAbortedError(`run ${runId} not found`);

    const existing = readSections(run)[name] as StoredSection<T> | undefined;
    if (existing && existing.status === 'ok' && !options.force) return existing;

    const budget = budgetFor(run.agent);
    const finishedAt = () => new Date().toISOString();

    if (run.stepCount >= budget.maxSteps || run.costUsd >= budget.maxCostUsd) {
        const reason = run.costUsd >= budget.maxCostUsd
            ? `Stopped: this run reached its $${budget.maxCostUsd.toFixed(2)} budget`
            : `Stopped: this run reached its ${budget.maxSteps}-step limit`;
        const section: StoredSection<T> = { status: 'skipped', reason, finishedAt: finishedAt() };
        await prisma.agentStep.create({
            data: { runId, name, status: 'skipped', reason, attempt: await nextAttempt(runId, name), finishedAt: new Date() },
        });
        await writeSection(runId, name, section, 0);
        return section;
    }

    const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    const timeoutMs = options.timeoutMs ?? 25_000;
    let lastError: unknown = null;

    for (let i = 0; i < maxAttempts; i += 1) {
        const attempt = await nextAttempt(runId, name);
        const started = Date.now();
        const step = await prisma.agentStep.create({ data: { runId, name, attempt } });
        const sources = new SourceSet();
        let cost = 0;

        try {
            const outcome = await withTimeout(async (signal) => {
                const ctx: StepContext = {
                    runId,
                    userId: run.userId,
                    stepName: name,
                    sources,
                    signal,
                    ai: async (opts) => {
                        if (signal.aborted) throw new StepTimeoutError(name, timeoutMs);
                        const result = await generateStructured({
                            ...opts,
                            feature: opts.feature ?? options.feature,
                            userId: run.userId,
                            sessionId: runId,
                        });
                        cost += result.usage.costUsd;
                        return result;
                    },
                    addCost: (usd) => {
                        if (Number.isFinite(usd) && usd > 0) cost += usd;
                    },
                    log: (message, extra) => {
                        console.info(`[agent:${run.agent}] ${name} ${message}`, { runId, ...extra });
                    },
                };
                return fn(ctx);
            }, timeoutMs, name);

            const refs = sources.refs();
            const section: StoredSection<T> = toStored(outcome, refs, finishedAt());
            await prisma.agentStep.update({
                where: { id: step.id },
                data: {
                    status: outcome.status === 'ok'
                        ? 'succeeded'
                        : outcome.status === 'skipped'
                            ? 'skipped'
                            : outcome.status === 'needs_input'
                                ? 'succeeded'
                                : 'unavailable',
                    reason: 'reason' in outcome ? outcome.reason : outcome.status === 'needs_input' ? `Asked: ${outcome.question.prompt}` : null,
                    sources: refs as unknown as Prisma.InputJsonValue,
                    output: jsonOrNull('data' in outcome ? outcome.data : null),
                    costUsd: cost,
                    latencyMs: Date.now() - started,
                    finishedAt: new Date(),
                },
            });
            await writeSection(runId, name, section, cost);
            return section;
        } catch (error) {
            lastError = error;
            await prisma.agentStep.update({
                where: { id: step.id },
                data: {
                    status: 'failed',
                    error: reasonFrom(error),
                    reason: reasonFrom(error),
                    sources: sources.refs() as unknown as Prisma.InputJsonValue,
                    costUsd: cost,
                    latencyMs: Date.now() - started,
                    finishedAt: new Date(),
                },
            });
            // Cost was spent even though the step failed; the run must carry it.
            if (cost > 0) {
                await prisma.$executeRaw`UPDATE "AgentRun" SET "costUsd" = "costUsd" + ${cost} WHERE "id" = ${runId}`;
            }
            console.warn(`[agent:${run.agent}] step failed`, { runId, name, attempt, error: reasonFrom(error) });
        }
    }

    const reason = friendlyFailure(lastError);
    const section: StoredSection<T> = { status: 'failed', reason, finishedAt: finishedAt() };
    await writeSection(runId, name, section, 0);
    if (options.critical) throw new RunAbortedError(`${name}: ${reason}`);
    return section;
}

function toStored<T>(outcome: StepOutcome<T>, sources: SourceRef[], finishedAt: string): StoredSection<T> {
    switch (outcome.status) {
        case 'ok':
            return { status: 'ok', data: outcome.data, sources, finishedAt };
        case 'unavailable':
            return { status: 'unavailable', reason: outcome.reason, data: outcome.data, sources, finishedAt };
        case 'skipped':
            return { status: 'skipped', reason: outcome.reason, finishedAt };
        case 'needs_input':
            return { status: 'needs_input', question: outcome.question, data: outcome.data, finishedAt };
    }
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** What the user reads. The raw error stays on the AgentStep row. */
function friendlyFailure(error: unknown): string {
    if (error instanceof StepTimeoutError) return `${error.message}; the rest of the analysis is unaffected`;
    return 'This part failed after a retry. The rest of the analysis is unaffected.';
}
