import { config } from '@/lib/config';

/**
 * Task keys (ADR-6, PRD 08 §5.4 "model configuration discipline").
 *
 * A call site names a *task*; the model is resolved from the per-task map in
 * `src/lib/config.ts`. A model id must never appear at a call site, and
 * `generateStructured()` deliberately has no parameter that would accept one.
 */
export const TASK_KEYS = [
    // pre-R1 surfaces, already in the map
    'general',
    'jdParse',
    'paraphrase',
    'atsScore',
    'assembly',
    'claimValidation',
    'resumeParse',
    // R1 (P0.4)
    'winDraft',
    'winDraftLarge',
    'winStructure',
    'digestCompose',
    'monthReview',
    'packetThemes',
    'packetMap',
    'packetCompose',
    'interviewTurn',
    'interviewExtract',
    'radarNormalize',
    'radarReason',
] as const;

export type TaskKey = (typeof TASK_KEYS)[number];

/**
 * Compile-time proof that TASK_KEYS and the config model map stay in sync.
 * Adding a key to one and not the other is a type error, not a runtime surprise.
 */
type ConfigModelKey = keyof typeof config.openai.models;
type AssertExtends<A extends B, B> = A;
/* eslint-disable @typescript-eslint/no-unused-vars */
type _TasksCoverConfig = AssertExtends<ConfigModelKey, TaskKey>;
type _ConfigCoversTasks = AssertExtends<TaskKey, ConfigModelKey>;
/* eslint-enable @typescript-eslint/no-unused-vars */

const TASK_KEY_SET: ReadonlySet<string> = new Set<string>(TASK_KEYS);

export function isTaskKey(value: unknown): value is TaskKey {
    return typeof value === 'string' && TASK_KEY_SET.has(value);
}

/**
 * The only sanctioned way to turn a task into a model id.
 * Throws rather than silently falling back, so a typo surfaces at the call, not in a bill.
 */
export function resolveTaskModel(task: TaskKey): string {
    const model = config.openai.models[task];
    if (!model || typeof model !== 'string') {
        throw new Error(`No model configured for AI task "${task}" (src/lib/config.ts openai.models)`);
    }
    return model;
}

/**
 * Per-task reasoning effort. Same discipline as the model map: a call site
 * names a task, never a thinking budget.
 *
 * Reasoning tokens dominate latency on the gpt-5 family and are invisible in
 * the output. Measured against a real capture note, one prompt ran 3.0s at
 * `minimal`, 3.5s at `low` and 6.1s at `medium` — and all three extracted the
 * same figures, because copying a number out of a sentence is not a reasoning
 * problem.
 *
 * The split is by KIND OF WORK, not by importance:
 *
 * - **Extraction / classification** — the answer is present in the input and
 *   the job is to find and shape it. Low effort. `winStructure` is also the
 *   only task on the interactive path: a person is watching a spinner, so its
 *   latency is felt directly in a way no background task's is.
 * - **Synthesis / judgement** — grouping, mapping to a ladder, writing prose
 *   that must hold together across many inputs. Left at the model default,
 *   where the thinking is doing real work.
 *
 * Tasks absent from this map use the provider default. Do not add one without
 * measuring; the numbers above are the standard of evidence.
 */
export const TASK_REASONING_EFFORT: Partial<Record<TaskKey, 'minimal' | 'low' | 'medium' | 'high'>> = {
    // Extraction from a note the user just typed, while they wait.
    winStructure: 'low',
    // Pulling wins out of an interview answer — same shape of work.
    interviewExtract: 'low',
    // Parsing structured documents into fields.
    resumeParse: 'low',
    jdParse: 'low',
};

export function resolveTaskReasoningEffort(
    task: TaskKey,
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    return TASK_REASONING_EFFORT[task];
}
