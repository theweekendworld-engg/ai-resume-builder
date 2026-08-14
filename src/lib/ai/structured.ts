import { generateObject } from 'ai';
import { z } from 'zod';
import { aiOpenAI } from '@/lib/aiProvider';
import { calculateOpenAiCostUsd, logUsageEvent } from '@/lib/usageTracker';
import { resolveTaskModel, resolveTaskReasoningEffort, type TaskKey ,
} from '@/lib/ai/tasks';
import type { FeatureTag } from '@/lib/ai/features';
import {
    buildCorrectionPrompt,
    checkNumericGuard,
    stripViolations,
    type GuardViolation,
    type NumericGuard,
} from '@/lib/ai/guard';

/**
 * The single guarded entry point for structured AI calls (ADR-6).
 *
 * Everything a call site would otherwise hand-roll lives here exactly once:
 * model resolution from the per-task map, zod validation with a retry, the
 * numeric guard, cost/latency accounting, and the `ApiUsageLog` write.
 *
 * There is deliberately no way to pass a model id (PRD 08 §5.4).
 */

export type StructuredUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    /** number of model round-trips actually spent, including retries */
    calls: number;
    latencyMs: number;
};

export type GenerateStructuredOptions<T extends z.ZodType> = {
    task: TaskKey;
    feature: FeatureTag;
    userId: string;
    schema: T;
    system: string;
    prompt: string;
    /** validation retries; default 1 (so at most 2 validation attempts) */
    maxRetries?: number;
    /** no-fabrication post-validation, PRD 08 §5.1 */
    guard?: NumericGuard;
    sessionId?: string;
    temperature?: number;
    /** Override the per-task default in {@link TASK_REASONING_EFFORT}. */
    reasoningEffort?: ReasoningEffort;
};

export type GenerateStructuredResult<T> = {
    data: T;
    usage: StructuredUsage;
    /** true when the guard had to strip a field to keep the output honest */
    degraded: boolean;
    /** violations that survived the corrective retry and caused the strip */
    guardViolations: GuardViolation[];
};

// ───────────────────────────────────────────────────── injectable seams
//
// Two seams, both for tests only. The database is unreachable in CI and we never
// make real model calls in a unit test, so both are swappable. Production code
// must not touch these.

/**
 * How much the model is allowed to think before answering.
 *
 * Reasoning tokens are the dominant term in both latency and cost on the gpt-5
 * family, and they are invisible in the response — measured on a real capture
 * note, the same prompt took 3.0s at `minimal`, 3.5s at `low` and 6.1s at
 * `medium`, all three extracting the identical figures. Extraction tasks that
 * copy from a source do not benefit from the extra thinking; synthesis tasks
 * do. See {@link TASK_REASONING_EFFORT}.
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

type ObjectRunnerArgs = {
    model: string;
    schema: z.ZodType;
    system: string;
    prompt: string;
    temperature?: number;
    reasoningEffort?: ReasoningEffort;
};

type ObjectRunnerResult = {
    object: unknown;
    inputTokens: number;
    outputTokens: number;
};

export type ObjectRunner = (args: ObjectRunnerArgs) => Promise<ObjectRunnerResult>;

const defaultObjectRunner: ObjectRunner = async ({
    model,
    schema,
    system,
    prompt,
    temperature,
    reasoningEffort,
}) => {
    const result = await generateObject({
        model: aiOpenAI(model),
        schema,
        system,
        prompt,
        ...(temperature === undefined ? {} : { temperature }),
        ...(reasoningEffort === undefined
            ? {}
            : { providerOptions: { openai: { reasoningEffort } } }),
    });
    return {
        object: result.object,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
    };
};

type UsageLogger = typeof logUsageEvent;

let objectRunner: ObjectRunner = defaultObjectRunner;
let usageLogger: UsageLogger = logUsageEvent;

export const __testing = {
    setObjectRunner(runner: ObjectRunner) {
        objectRunner = runner;
    },
    setUsageLogger(logger: UsageLogger) {
        usageLogger = logger;
    },
    reset() {
        objectRunner = defaultObjectRunner;
        usageLogger = logUsageEvent;
    },
};

// ───────────────────────────────────────────────────── implementation

function formatValidationError(error: z.ZodError): string {
    return error.issues
        .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
}

/**
 * Cost/latency logging must never take a generation down with it. A Postgres
 * outage is an observability problem; failing the user's request over it would
 * turn it into a product outage.
 */
async function safeLog(
    logger: UsageLogger,
    payload: Parameters<UsageLogger>[0],
): Promise<void> {
    try {
        await logger(payload);
    } catch (error) {
        console.warn('[ai/structured] usage log write failed', {
            operation: payload.operation,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function generateStructured<T extends z.ZodType>(
    opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<z.infer<T>>> {
    const { task, feature, userId, schema, system, guard } = opts;
    const model = resolveTaskModel(task);
    // Explicit override wins; otherwise the per-task default, which is the
    // same discipline as the model map — no thinking budget at a call site.
    const reasoningEffort = opts.reasoningEffort ?? resolveTaskReasoningEffort(task);
    const maxRetries = Math.max(0, opts.maxRetries ?? 1);

    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let calls = 0;

    const usageSoFar = (): StructuredUsage => ({
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calculateOpenAiCostUsd({ model, inputTokens, outputTokens }),
        calls,
        latencyMs: Date.now() - startedAt,
    });

    const runOnce = async (prompt: string): Promise<unknown> => {
        const result = await objectRunner({
            model,
            schema,
            system,
            prompt,
            temperature: opts.temperature,
            reasoningEffort,
        });
        calls += 1;
        inputTokens += result.inputTokens ?? 0;
        outputTokens += result.outputTokens ?? 0;
        return result.object;
    };

    const log = async (status: 'success' | 'failed', extra: Record<string, unknown>) => {
        const usage = usageSoFar();
        await safeLog(usageLogger, {
            userId,
            sessionId: opts.sessionId,
            operation: `ai.${task}`,
            provider: 'openai',
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            costUsd: usage.costUsd,
            latencyMs: usage.latencyMs,
            status,
            metadata: {
                // PRD 08 §4.3 groups cost by these two. They are the point of the log line.
                feature,
                task,
                calls: usage.calls,
                ...extra,
            },
        });
    };

    // ── 1. generate + zod-validate, with `maxRetries` corrective attempts
    let prompt = opts.prompt;
    let data: z.infer<T> | undefined;
    let lastValidationError: z.ZodError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let raw: unknown;
        try {
            raw = await runOnce(prompt);
        } catch (error) {
            await log('failed', {
                stage: 'generate',
                attempt,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }

        const parsed = schema.safeParse(raw);
        if (parsed.success) {
            data = parsed.data;
            break;
        }

        lastValidationError = parsed.error;
        prompt = [
            opts.prompt,
            '',
            'Your previous response did not satisfy the required schema:',
            formatValidationError(parsed.error),
            '',
            'Return a corrected response that matches the schema exactly.',
        ].join('\n');
    }

    if (data === undefined) {
        const message = `generateStructured(${task}): schema validation failed after ${calls} attempt(s)`;
        await log('failed', {
            stage: 'validate',
            error: lastValidationError ? formatValidationError(lastValidationError) : 'unknown',
        });
        throw new Error(message);
    }

    // ── 2. the numeric guard (PRD 08 §5.1): one corrective retry, then strip
    let degraded = false;
    let guardViolations: GuardViolation[] = [];

    if (guard && guard.fields.length > 0) {
        let check = checkNumericGuard(data, guard);

        if (!check.ok) {
            const correctionPrompt = [opts.prompt, '', buildCorrectionPrompt(check.violations)].join('\n');
            let retried: unknown;
            try {
                retried = await runOnce(correctionPrompt);
            } catch {
                retried = undefined; // a failed corrective call degrades; it does not throw
            }

            const parsedRetry = retried === undefined ? undefined : schema.safeParse(retried);
            if (parsedRetry?.success) {
                const retryCheck = checkNumericGuard(parsedRetry.data, guard);
                if (retryCheck.ok) {
                    data = parsedRetry.data;
                    check = retryCheck;
                } else if (retryCheck.violations.length < check.violations.length) {
                    // the retry is strictly less wrong — keep it, then strip what remains
                    data = parsedRetry.data;
                    check = retryCheck;
                }
            }

            if (!check.ok) {
                guardViolations = check.violations;
                data = stripViolations(data, check.violations);
                degraded = true;
                console.warn('[ai/structured] ai_guard_violation', {
                    task,
                    feature,
                    userId,
                    fields: check.violatingFields,
                    quantities: check.violations.map((violation) => violation.quantity.raw),
                });
            }
        }
    }

    await log('success', {
        degraded,
        guardViolations: guardViolations.map((violation) => ({
            path: violation.path,
            quantity: violation.quantity.raw,
            kind: violation.quantity.kind,
        })),
    });

    return { data, usage: usageSoFar(), degraded, guardViolations };
}
