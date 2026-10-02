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
    // R3 — resume generation v2. Each is a distinct judgement, so each is its
    // own task rather than one call that does the whole document.
    'postingRead',
    'bulletSelect',
    'bulletWrite',
    // R4 — agentic assembly. One model orchestrates the evidence tools and
    // emits the whole document, so this is a single key rather than one per
    // judgement: the point of the loop is that the judgements interact.
    'resumeAssemble',
    // Scout (docs/impl/06-scout-agent.md). Code owns the plan; each of these
    // is one extraction or one piece of language inside a fixed section.
    'scoutClassify',
    'scoutFitExplain',
    'scoutResearchExtract',
    'scoutDigest',
    'outreachDraft',
    // Requirement ↔ record-line matching inside fit: its own key so its cost
    // is not folded into the explanation's in ApiUsageLog.
    'scoutFitMatch',
    // The posting read, on Scout's model. Same prompt as `postingRead`; the
    // resume path keeps its measured model, Scout takes the cheaper one.
    'scoutPostingRead',
    // Chat (docs/prd/10-chat.md): one routing call per message. It picks an
    // action from a closed list; the code runs it.
    'chatRoute',
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
    // Scout extraction. `low` rather than `minimal`: gpt-6-luna has no
    // `minimal` effort, and `low` is valid on both model families.
    scoutClassify: 'low',
    scoutResearchExtract: 'low',
    scoutDigest: 'low',
    scoutFitMatch: 'low',
    scoutPostingRead: 'low',
    // A person is waiting on every message; routing is classification.
    chatRoute: 'low',
};

export function resolveTaskReasoningEffort(
    task: TaskKey,
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    return TASK_REASONING_EFFORT[task];
}

/**
 * Sampling temperature is NOT configurable here, and that is a finding rather
 * than an omission.
 *
 * The 8 Aug audit ran the free checker twice on identical input and got job
 * match 38 then 33. The obvious fix is `temperature: 0` on the reading and
 * judging tasks — so it was built, as a per-task map exactly like the model
 * and effort maps above.
 *
 * It does nothing. Every model this product uses is from the gpt-5 family, and
 * the provider answers:
 *
 *   AI SDK Warning (openai.responses / gpt-5): The feature "temperature" is
 *   not supported. temperature is not supported for reasoning models
 *
 * A WARNING, not an error — so the call succeeds, the setting is dropped, and
 * a `temperature: 0` sitting in config would read for years as though
 * determinism had been handled. That is the same shape as the "kept in sync"
 * comment on the extension tokens: configuration that cannot fail and is not
 * true.
 *
 * ── What the variance actually is ───────────────────────────────────────────
 *
 * Measured, three live runs of `readPosting` over one posting:
 *
 *   run 1  12 requirements   6 must   0 tenure-satisfiable
 *   run 2  11 requirements   6 must   1 tenure-satisfiable
 *   run 3  12 requirements   6 must   0 tenure-satisfiable
 *
 * The must-have count did not move. The difference was one duty split two ways
 * ("Mentor engineers." + "Raise the technical bar." vs the single sentence),
 * which changes the denominator slightly and nothing a candidate would notice.
 *
 * `satisfiedByTenure` DID flip, and that one matters — it decides whether the
 * resume's date range credits a requirement. It fails closed (no flag, no
 * credit), so the variance costs a coverage point rather than inventing a
 * qualification, which is the right direction to be wrong in. It is not fixed.
 *
 * If reproducibility becomes a promise rather than an aspiration, the lever is
 * a `seed` on the provider call plus caching the parsed brief per posting hash
 * — not a temperature the provider ignores.
 */

