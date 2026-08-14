/**
 * `structureWin` — free text in, a Win draft out (PRD 01 §8.1).
 *
 * This is the truthfulness invariant applied at capture. Everything downstream
 * (resume bullets, packets, apply answers) inherits whatever this function
 * lets through, so the five prompt rules below are not style guidance — they
 * are the product's central promise, and the numeric guard enforces rule 1
 * mechanically rather than hopefully (ADR-6).
 *
 * The model is reached only through `generateStructured`. There is deliberately
 * no other path, and no model id anywhere in this file.
 */

import { z } from 'zod';
import { WinCategory, WinSensitivity } from '@prisma/client';
import { generateStructured, type StructuredUsage } from '@/lib/ai/structured';
import { extractQuantities, type GuardViolation } from '@/lib/ai/guard';
import { searchQdrantByVector, generateEmbedding } from '@/actions/embed';
import { WIN_POINT_TYPE } from '@/lib/graph/visibility';
import type { ImpactInput, StructuredDraft } from '@/actions/wins.types';

// ═══════════════════════════════════════════════════════════════ the schema

const WIN_CATEGORIES = Object.values(WinCategory) as [WinCategory, ...WinCategory[]];
const SENSITIVITIES = Object.values(WinSensitivity) as [WinSensitivity, ...WinSensitivity[]];

export const OCCURRED_AT_HINTS = [
    'today',
    'yesterday',
    'this_week',
    'last_week',
    'earlier',
    'explicit',
] as const;

export const WinDraftSchema = z.object({
    title: z.string().max(120),
    narrative: z.string().max(600),
    category: z.enum(WIN_CATEGORIES),
    occurredAtHint: z.enum(OCCURRED_AT_HINTS),
    explicitDate: z.string().nullable(),
    skills: z.array(z.string()).max(8),
    collaborators: z.array(z.string()).max(6),
    suggestedSensitivity: z.enum(SENSITIVITIES),
    quantified: z.boolean(),
    impact: z
        .object({
            metric: z.string(),
            baseline: z.string().nullable(),
            result: z.string().nullable(),
            delta: z.string().nullable(),
            scope: z.string().nullable(),
            timeframe: z.string().nullable(),
        })
        .nullable(),
    /** Asked only when `quantified === false`. */
    quantifyPrompt: z.string().nullable(),
    confidence: z.number().min(0).max(1),
});

export type WinDraft = z.infer<typeof WinDraftSchema>;

/** Below this the input was too thin to be a Win; we keep the raw text (rule 5). */
export const LOW_CONFIDENCE_THRESHOLD = 0.3;

// ═══════════════════════════════════════════════════════════════ the prompt

export const STRUCTURE_WIN_SYSTEM = [
    'You turn a working professional\'s rough notes into one structured "Win" — a single',
    'accomplishment with a date, a category and, only when the notes actually contain one,',
    'a measured impact.',
    '',
    'THE FIVE RULES. They are not preferences. Breaking any one of them makes the output unusable.',
    '',
    '1. NEVER INVENT A NUMBER. If the user did not state a quantity, `impact` is null and',
    '   `quantified` is false. Do not estimate, do not infer, do not use a typical value, and do',
    '   not compute a new figure from figures that are present — a percentage derived from two',
    '   stated numbers is still a fabricated number. Every digit you write must appear in the notes.',
    '2. NEVER INVENT A SCOPE OR AN OUTCOME. Rephrase only what is present. No "for millions of',
    '   users", no "which unblocked the release", unless the notes say so.',
    '3. The title is a factual statement, not a brag. Never use "successfully", "spearheaded",',
    '   "leveraged", "utilized", or "world-class". Say what happened.',
    '4. `quantifyPrompt` must be answerable in under five words ("How much faster?", not',
    '   "Can you describe the performance improvement in detail?"). Set it only when',
    '   `quantified` is false; otherwise null.',
    '5. If the input is ambiguous or too thin to be a Win, return confidence below 0.3 and do not',
    '   embellish it into one.',
    '',
    'CATEGORY — pick exactly one:',
    '  shipped    — delivered something new that users or systems now depend on',
    '  improved   — made an existing thing measurably better',
    '  fixed      — resolved an incident, bug or risk',
    '  led        — owned a project, drove a decision, ran a process',
    '  influenced — changed what someone else did (design review, doc, mentoring, cross-team)',
    '  grew       — developed a person or the team',
    '  learned    — acquired a skill or domain that expanded your range',
    '  saved      — reduced cost, time or headcount need',
    'Resolve ties toward the RARER category: `influenced` beats `shipped`.',
    '',
    'SENSITIVITY — propose, never decide: `internal_only` for internal metrics or org detail,',
    '`confidential` for unreleased product, security incidents, personnel matters or named',
    'clients, `shareable` otherwise. The user\'s own setting always wins.',
    '',
    'DATE: `occurredAtHint` describes when the WORK happened, not when it was written down.',
    'Use `explicit` with an ISO `explicitDate` only when the notes name a date.',
].join('\n');

export function buildStructureWinPrompt(params: { text: string; now?: Date }): string {
    const now = params.now ?? new Date();
    return [
        `Today is ${now.toISOString().slice(0, 10)}.`,
        '',
        'Notes from the user (this is the ONLY source of facts; every number you output must appear here verbatim):',
        '"""',
        params.text.trim(),
        '"""',
    ].join('\n');
}

// ═══════════════════════════════════════════════════════════════ date hints

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function mondayOfWeek(date: Date): Date {
    const day = startOfUtcDay(date);
    const daysSinceMonday = (day.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - daysSinceMonday * DAY_MS);
}

/**
 * The work's date, never the logging date (PRD 01 §4.1). A hint that resolves
 * into the future is not a work date, so it clamps to today.
 */
export function resolveOccurredAt(draft: Pick<WinDraft, 'occurredAtHint' | 'explicitDate'>, now: Date = new Date()): Date {
    const today = startOfUtcDay(now);

    const resolved = (() => {
        switch (draft.occurredAtHint) {
            case 'yesterday':
                return new Date(today.getTime() - DAY_MS);
            case 'this_week':
                return mondayOfWeek(now);
            case 'last_week':
                return new Date(mondayOfWeek(now).getTime() - 7 * DAY_MS);
            case 'explicit': {
                if (!draft.explicitDate) return today;
                const parsed = new Date(`${draft.explicitDate.slice(0, 10)}T00:00:00.000Z`);
                return Number.isNaN(parsed.getTime()) ? today : parsed;
            }
            case 'earlier':
            case 'today':
            default:
                return today;
        }
    })();

    return resolved.getTime() > today.getTime() ? today : resolved;
}

// ═══════════════════════════════════════════════════════════════ sanitizing

function violatedFields(violations: GuardViolation[]): Set<string> {
    return new Set(violations.map((violation) => violation.field));
}

/**
 * What the guard leaves behind is not yet shippable: a stripped string field is
 * blank, and a stripped `impact` leaf leaves a metric with holes in it. Rule 1
 * says the honest end state is `impact: null, quantified: false` — never a
 * half-populated metric, and never a blank title.
 */
export function sanitizeDraft(params: {
    draft: WinDraft;
    sourceText: string;
    violations: GuardViolation[];
}): WinDraft {
    const draft = { ...params.draft };
    const violated = violatedFields(params.violations);

    if (violated.has('impact') || !draft.impact || !draft.impact.metric.trim()) {
        draft.impact = null;
    }
    // Rule 1, applied as a post-condition rather than a hope.
    draft.quantified = draft.impact !== null;

    if (!draft.title.trim()) {
        draft.title = params.sourceText.trim().slice(0, 120);
    }
    if (violated.has('narrative') && !draft.narrative.trim()) {
        draft.narrative = '';
    }

    if (draft.quantified) {
        draft.quantifyPrompt = null;
    } else if (!draft.quantifyPrompt || !draft.quantifyPrompt.trim()) {
        draft.quantifyPrompt = 'What changed, in numbers?';
    }

    // Rule 5: too thin to be a Win — keep what the user actually wrote.
    if (draft.confidence < LOW_CONFIDENCE_THRESHOLD) {
        draft.title = params.sourceText.trim().slice(0, 120);
    }

    draft.skills = draft.skills.map((skill) => skill.trim()).filter(Boolean).slice(0, 8);
    draft.collaborators = draft.collaborators.map((name) => name.trim()).filter(Boolean).slice(0, 6);

    return draft;
}

// ═══════════════════════════════════════════════════════════════ structureWin

export type StructureWinResult = {
    draft: WinDraft;
    usage: StructuredUsage;
    /** True when the guard had to strip a fabricated quantity. */
    degraded: boolean;
    guardViolations: GuardViolation[];
};

export async function structureWin(params: {
    userId: string;
    text: string;
    now?: Date;
    sessionId?: string;
}): Promise<StructureWinResult> {
    const sourceText = params.text;

    const { data, usage, degraded, guardViolations } = await generateStructured({
        task: 'winStructure',
        feature: 'work_log',
        userId: params.userId,
        schema: WinDraftSchema,
        system: STRUCTURE_WIN_SYSTEM,
        prompt: buildStructureWinPrompt({ text: sourceText, now: params.now }),
        // The no-fabrication contract, declared once. `impact` is an object; the
        // guard walks it and reports each offending leaf.
        guard: { sourceText, fields: ['title', 'narrative', 'impact'] },
        sessionId: params.sessionId,
    });

    return {
        draft: sanitizeDraft({ draft: data, sourceText, violations: guardViolations }),
        usage,
        degraded,
        guardViolations,
    };
}

/**
 * The wire shape for quick capture: everything the user is about to edit, with
 * the date already resolved, and nothing written to the database. An abandoned
 * capture must leave no row behind.
 */
export function toStructuredDraft(draft: WinDraft, now: Date = new Date()): StructuredDraft {
    return {
        title: draft.title,
        narrative: draft.narrative,
        category: draft.category,
        occurredAt: resolveOccurredAt(draft, now),
        skills: draft.skills,
        collaborators: draft.collaborators,
        suggestedSensitivity: draft.suggestedSensitivity,
        quantified: draft.quantified,
        impact: draft.quantified ? draft.impact : null,
        quantifyPrompt: draft.quantifyPrompt,
        confidence: draft.confidence,
    };
}

// ═══════════════════════════════════════════════════════════ impact answers

const ImpactAnswerSchema = z.object({
    metric: z.string().max(120),
    baseline: z.string().max(80).nullable(),
    result: z.string().max(80).nullable(),
    delta: z.string().max(80).nullable(),
    scope: z.string().max(120).nullable(),
    timeframe: z.string().max(80).nullable(),
});

export const IMPACT_ANSWER_SYSTEM = [
    'You convert one short answer about a work accomplishment into a structured impact metric.',
    '',
    'THE RULE THAT MATTERS: never invent a number. Every figure you emit must appear in the',
    'answer or in the accomplishment it describes. Do not estimate, do not round, and do not',
    'compute a delta from a baseline and a result — a derived percentage is a fabricated number.',
    'If a field has no value in the source, it is null. Never guess.',
    '',
    '`metric` names WHAT was measured ("checkout p95 latency", "onboarding time"), never the',
    'figure itself. Take the wording from the accomplishment where you can.',
    '`baseline` is the before value, `result` the after value, `delta` the stated change,',
    '`scope` the stated size of the thing affected, `timeframe` the stated period. All optional.',
].join('\n');

export function buildImpactAnswerPrompt(params: {
    answer: string;
    title: string;
    narrative: string;
}): string {
    return [
        'The accomplishment:',
        `  ${params.title}`,
        params.narrative ? `  ${params.narrative}` : '',
        '',
        'The question asked was how to quantify it. The user answered:',
        '"""',
        params.answer.trim(),
        '"""',
    ]
        .filter((line) => line !== '')
        .join('\n');
}

export type ImpactAnswerResult =
    | { kind: 'no_quantity' }
    | { kind: 'impact'; impact: ImpactInput; degraded: boolean };

/** True when the text states any figure at all. Cheap, deterministic, no model. */
export function statesAQuantity(text: string): boolean {
    return extractQuantities(text ?? '', 'lenient').length > 0;
}

/**
 * PRD 01 §6.3 — the quantify prompt, answered.
 *
 * Fail-closed twice over. Before the model: an answer with no figure in it
 * returns `no_quantity` and never reaches a prompt, so there is nothing to
 * hallucinate from. After the model: the numeric guard checks every field
 * against the answer plus the Win's own text, and anything that survives with
 * no figure left is discarded rather than written as an empty metric.
 */
export async function parseImpactAnswer(params: {
    userId: string;
    answer: string;
    win: { title: string; narrative: string };
    sessionId?: string;
}): Promise<ImpactAnswerResult> {
    const answer = params.answer.trim();
    if (!statesAQuantity(answer)) return { kind: 'no_quantity' };

    // The Win's own text is admissible source: its figures already passed the
    // guard against the original notes when the Win was drafted.
    const sourceText = [answer, params.win.title, params.win.narrative].filter(Boolean).join('\n');

    const { data, degraded } = await generateStructured({
        task: 'winStructure',
        feature: 'work_log',
        userId: params.userId,
        schema: ImpactAnswerSchema,
        system: IMPACT_ANSWER_SYSTEM,
        prompt: buildImpactAnswerPrompt({
            answer,
            title: params.win.title,
            narrative: params.win.narrative,
        }),
        guard: {
            sourceText,
            fields: ['metric', 'baseline', 'result', 'delta', 'scope', 'timeframe'],
        },
        sessionId: params.sessionId,
    });

    const clean = (value: string | null): string | null => {
        const trimmed = (value ?? '').trim();
        return trimmed ? trimmed : null;
    };

    const impact: ImpactInput = {
        // A blanked metric name is not a reason to lose the user's number.
        metric: clean(data.metric) ?? 'impact',
        baseline: clean(data.baseline),
        result: clean(data.result),
        delta: clean(data.delta),
        scope: clean(data.scope),
        timeframe: clean(data.timeframe),
    };

    // If the guard stripped every figure, there is no metric left to write —
    // an ImpactMetric with no quantity is worse than no ImpactMetric.
    const hasFigure = [impact.baseline, impact.result, impact.delta, impact.scope, impact.timeframe].some(
        (value) => value != null && statesAQuantity(value),
    );
    if (!hasFigure) return { kind: 'no_quantity' };

    return { kind: 'impact', impact, degraded };
}

// ═══════════════════════════════════════════════════════ near-duplicate merge

/** PRD 01 §12: cosine similarity above this, inside the window, is a merge. */
export const NEAR_DUPLICATE_THRESHOLD = 0.92;
export const NEAR_DUPLICATE_WINDOW_DAYS = 14;

export type MergeProposal = {
    existingWinId: string;
    similarity: number;
    title: string;
    occurredAt: Date;
};

export type VectorHit = {
    id: string | number;
    score: number;
    payload?: Record<string, unknown> | null;
};

/**
 * Pure selection so the threshold and the window are testable without a vector
 * store. Only Wins already in the index participate — which in R1 means
 * confirmed, shareable ones. A duplicate of an unconfirmed draft is caught by
 * the review queue instead, where both are visible side by side.
 */
export function selectNearDuplicate(hits: readonly VectorHit[], occurredAt: Date): MergeProposal | null {
    const windowMs = NEAR_DUPLICATE_WINDOW_DAYS * DAY_MS;

    const candidates = hits
        .map((hit) => {
            const payload = hit.payload ?? {};
            const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : null;
            const rawDate = typeof payload.occurredAt === 'string' ? payload.occurredAt : null;
            if (!sourceId || !rawDate) return null;
            const hitDate = new Date(rawDate);
            if (Number.isNaN(hitDate.getTime())) return null;
            if (Math.abs(hitDate.getTime() - occurredAt.getTime()) > windowMs) return null;
            if (!(hit.score > NEAR_DUPLICATE_THRESHOLD)) return null;
            return {
                existingWinId: sourceId,
                similarity: hit.score,
                title: typeof payload.title === 'string' ? payload.title : '',
                occurredAt: hitDate,
            };
        })
        .filter((candidate): candidate is MergeProposal => candidate !== null)
        .sort((a, b) => b.similarity - a.similarity);

    return candidates[0] ?? null;
}

const MERGE_PROPOSAL_PREFIX = 'merge_proposal:';

/**
 * `Result` carries only `error` and `code`, so the id of the Win to merge into
 * rides in the code. `wins.types.ts` is orchestrator-owned and cannot grow a
 * third field, so this is the seam — parse it, do not string-match it.
 */
export function mergeProposalCode(existingWinId: string): string {
    return `${MERGE_PROPOSAL_PREFIX}${existingWinId}`;
}

export function parseMergeProposalCode(code: string | undefined): string | null {
    if (!code || !code.startsWith(MERGE_PROPOSAL_PREFIX)) return null;
    const id = code.slice(MERGE_PROPOSAL_PREFIX.length);
    return id.length > 0 ? id : null;
}

// ───────────────────────────────────────────────────── injectable seam

export type DraftEmbedder = (text: string, userId: string) => Promise<number[]>;

const defaultEmbedder: DraftEmbedder = (text, userId) =>
    generateEmbedding({
        text,
        userId,
        operation: 'embedding_generate',
        metadata: { itemType: 'win_draft', reason: 'near_duplicate_check' },
    });

let embedder: DraftEmbedder = defaultEmbedder;

export const __testing = {
    setEmbedder(fn: DraftEmbedder) {
        embedder = fn;
    },
    reset() {
        embedder = defaultEmbedder;
    },
};

/**
 * Best-effort: a vector-store hiccup must never stop someone logging a win.
 * Returns null on any failure, which just means "not a duplicate".
 */
export async function findNearDuplicate(params: {
    userId: string;
    text: string;
    occurredAt: Date;
}): Promise<MergeProposal | null> {
    try {
        const vector = await embedder(params.text, params.userId);
        const hits = await searchQdrantByVector({
            userId: params.userId,
            vector,
            type: WIN_POINT_TYPE,
            limit: 10,
        });
        return selectNearDuplicate(hits as VectorHit[], params.occurredAt);
    } catch (error) {
        console.warn('[winDrafting] near-duplicate check skipped', {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
