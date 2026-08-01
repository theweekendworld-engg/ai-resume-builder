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
