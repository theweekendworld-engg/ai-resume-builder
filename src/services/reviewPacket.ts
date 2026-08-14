/**
 * The review packet (PRD 03 §3, §7).
 *
 * The feature that makes an employed person pay. Everything else in R1 builds
 * the input; this is the output they would miss.
 *
 * Three structural decisions worth knowing before you edit anything here:
 *
 * 1. **The numbers are never generated.** Every bullet under a theme is built
 *    deterministically from its Win — title, metric, date — so the figures in a
 *    packet are literally the figures in the log. The model writes the connective
 *    prose (theme titles, outcome sentences, the summary, the growth section) and
 *    that prose runs through the numeric guard. "Zero fabricated numbers" is
 *    therefore a property of the data flow, not a hope about the model.
 *
 * 2. **Nothing exists without a Win behind it.** Every block carries
 *    `sourceWinIds`. A block whose sources are empty or out of scope fails the
 *    truthfulness pass and renders a visible warning chip. Fail closed, always.
 *
 * 3. **Theme grouping is allowed to fail.** If the model call errors or returns
 *    something out of scope, {@link categoryThemes} groups by Win category with
 *    no error surfaced to the user. A deterministic packet beats no packet.
 */

import { WinCategory, WinSensitivity, WinStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import {
    extractQuantities,
    flattenQuantities,
    isQuantitySupported,
    type Quantity,
} from '@/lib/ai/guard';
import { claimRefIdFor } from '@/services/claimGrounding';
import type { GroundStateValue } from '@/lib/groundState';
import * as winGraph from '@/services/winGraph';
import type { WinView } from '@/actions/wins.types';
import {
    assessCompetencies,
    getFramework,
    mapWinsToCompetencies,
    PATRONUS_DEFAULT_FRAMEWORK,
    priorMappings,
    resolveTargetLevel,
    type CompetencyAssessment,
    type FrameworkCompetency,
    type FrameworkLevel,
    type FrameworkView,
} from '@/services/competency';

// ═══════════════════════════════════════════════════════════════ the model

export type PacketTypeValue = 'performance_review' | 'promotion_case' | 'self_appraisal' | 'brag_doc';
export type PacketAudience = 'manager' | 'skip_level' | 'self';

/** The Win, flattened to exactly what a packet needs. */
export type PacketWin = {
    id: string;
    title: string;
    narrative: string;
    occurredAt: Date;
    category: WinCategory;
    sensitivity: WinSensitivity;
    employerId: string | null;
    employerName: string | null;
    /** Pre-formatted headline figure, e.g. "p95 latency 800ms → 180ms". Null when unquantified. */
    metric: string | null;
    quantified: boolean;
    hasEvidence: boolean;
    /** First evidence chip label, e.g. "PR #482". */
    evidenceLabel: string | null;
    evidenceUrl: string | null;
};

/**
 * One editable unit of a packet. `key` is stable across regenerations so
 * `ReviewPacket.userEdits` can be merged back over new content by key.
 */
export type PacketBlock = {
    key: string;
    text: string;
    /** Never empty for a generated block that passed the truthfulness pass. */
    sourceWinIds: string[];
    ground: GroundStateValue;
    /** Set when `ground !== 'grounded'`. Rendered next to the ⚠ chip. */
    warning: string | null;
};

export type PacketTheme = {
    key: string;
    title: string;
    outcome: PacketBlock;
    /** The scope line ("2M weekly users"), only when a Win stated it. */
    impact: PacketBlock | null;
    strength: 'headline' | 'supporting';
    winIds: string[];
    /** One per member Win, built from the Win's own words. Always grounded. */
    bullets: PacketBlock[];
};

export type PacketHeader = {
    typeLabel: string;
    periodLabel: string;
    employerName: string | null;
    frameworkName: string | null;
    targetLevelName: string | null;
    audience: PacketAudience;
};

export type PacketWarning = { blockKey: string; reason: string };

export type PacketContent = {
    version: 1;
    header: PacketHeader;
    summary: PacketBlock;
    themes: PacketTheme[];
    /** Empty when no framework was selected — §10 says never render an empty section. */
    competencies: CompetencyAssessment[];
    growth: PacketBlock;
    appendix: { winIds: string[]; note: string | null };
    /** Set when the work genuinely does not group. Shown instead of invented coherence. */
    coherenceNote: string | null;
    unthemedWinIds: string[];
    warnings: PacketWarning[];
    wordCount: number;
    /** Wins carrying the 🔒 marker, for the pre-export prompt. */
    confidentialWinIds: string[];
    progress?: PacketProgress;
};

// ═══════════════════════════════════════════════════════════════ progress
//
// `ReviewPacket` has no step column and `prisma/schema.prisma` is
// orchestrator-owned, so the stage list lives in the `content` JSON while the
// packet is generating. It is durable, which is the requirement: the user can
// refresh mid-run and the theater picks up exactly where it was.

export const PACKET_STAGES = [
    { id: 'read', label: 'Reading your wins' },
    { id: 'themes', label: 'Grouping into themes' },
    { id: 'map', label: 'Mapping to your framework' },
    { id: 'select', label: 'Selecting your strongest evidence' },
    { id: 'compose', label: 'Writing in your voice' },
    // Named explicitly because the truthfulness pass is a feature, not plumbing.
    { id: 'verify', label: 'Checking every claim against your log' },
] as const;

export type PacketStageId = (typeof PACKET_STAGES)[number]['id'];
export type PacketStageStatus = 'pending' | 'active' | 'done' | 'error';

export type PacketStageState = {
    id: PacketStageId;
    label: string;
    status: PacketStageStatus;
    /** What the stage produced, shown inline: "found 5 themes". */
    result: string | null;
};

export type PacketProgress = { stages: PacketStageState[]; updatedAt: string };

export function initialProgress(): PacketProgress {
    return {
        stages: PACKET_STAGES.map((stage) => ({
            id: stage.id,
            label: stage.label,
            status: 'pending' as PacketStageStatus,
            result: null,
        })),
        updatedAt: new Date().toISOString(),
    };
}

export function advanceProgress(
    progress: PacketProgress,
    id: PacketStageId,
    patch: { status: PacketStageStatus; result?: string | null },
): PacketProgress {
    const index = progress.stages.findIndex((stage) => stage.id === id);
    return {
        updatedAt: new Date().toISOString(),
        stages: progress.stages.map((stage, position) => {
            if (position < index && stage.status === 'pending') return { ...stage, status: 'done' };
            if (stage.id !== id) return stage;
            return {
                ...stage,
                status: patch.status,
                result: patch.result === undefined ? stage.result : patch.result,
            };
        }),
    };
}

/**
 * Persist the stage list mid-run. Uses `updateMany` so a packet the user deleted
 * during generation is a no-op rather than a crash.
 */
export async function writeProgress(packetId: string, progress: PacketProgress): Promise<void> {
    const existing = await prisma.reviewPacket.findUnique({
        where: { id: packetId },
        select: { content: true },
    });
    const base =
        existing?.content && typeof existing.content === 'object' && !Array.isArray(existing.content)
            ? (existing.content as Record<string, unknown>)
            : {};
    await prisma.reviewPacket.updateMany({
        where: { id: packetId },
        data: { content: { ...base, progress } as unknown as Prisma.InputJsonValue },
    });
}

// ═══════════════════════════════════════════════════════════ packet types

export const PACKET_TYPE_CONFIG: Record<
    PacketTypeValue,
    { label: string; wordTarget: number; includeGrowth: boolean; includeCompetencies: boolean; guidance: string }
> = {
    performance_review: {
        label: 'Performance review',
        wordTarget: 800,
        includeGrowth: true,
        includeCompetencies: true,
        guidance: 'Balanced across categories. A case a busy manager can forward upward.',
    },
    promotion_case: {
        label: 'Promotion case',
        wordTarget: 1_200,
        includeGrowth: true,
        includeCompetencies: true,
        guidance:
            'Ruthlessly filtered to evidence at the target level. Lead with scope and influence, address each criterion for the target level, and end with what the person would need to keep doing.',
    },
    self_appraisal: {
        label: 'Self-appraisal',
        wordTarget: 600,
        includeGrowth: true,
        includeCompetencies: true,
        guidance: 'Short blocks that map onto accomplishments / challenges / goals form fields.',
    },
    brag_doc: {
        label: 'Brag doc',
        wordTarget: 300,
        includeGrowth: false,
        includeCompetencies: false,
        guidance: 'Raw and chronological. No narrative — the person just wants the list.',
    },
};

const AUDIENCE_GUIDANCE: Record<PacketAudience, string> = {
    manager: 'Written for the person\'s direct manager, who already knows the context.',
    skip_level: 'Written for a skip-level or calibration committee with no context. Name the systems and the teams.',
    self: 'Written for the person themselves. Plain and unvarnished; no selling.',
};

// ═══════════════════════════════════════════════════════════════ loading

/** Packets are an internal surface: archived Wins count, and so do confidential ones. */
const PACKET_STATUSES: WinStatus[] = [WinStatus.confirmed, WinStatus.archived];

function metricLabel(win: WinView): string | null {
    const impact = win.impact;
    if (!impact) return null;
    const arrow =
        impact.baseline && impact.result ? `${impact.baseline} → ${impact.result}` : impact.delta ?? impact.result ?? null;
    if (!arrow) return impact.metric;
    return `${impact.metric} ${arrow}`;
}

export function toPacketWin(win: WinView): PacketWin {
    const evidence = win.evidence.find((item) => item.available) ?? win.evidence[0] ?? null;
    return {
        id: win.id,
        title: win.title,
        narrative: win.narrative,
        occurredAt: win.occurredAt,
        category: win.category,
        sensitivity: win.sensitivity,
        employerId: win.employerId,
        employerName: win.employerName,
        metric: metricLabel(win),
        quantified: win.impact !== null,
        hasEvidence: win.evidence.length > 0,
        evidenceLabel: evidence?.label ?? null,
        evidenceUrl: evidence?.url ?? null,
    };
}

/**
 * Every Win in scope, read through the Work Log data layer so the sensitivity
 * and history rules stay in one place.
 *
 * `winGraph.listWins` rather than the `src/actions/wins.ts` wrapper because a
 * workflow step has no Clerk session — it is the same query, one layer down,
 * with `userId` passed explicitly.
 */
export async function loadPacketWins(params: {
    userId: string;
    periodStart: Date;
    periodEnd: Date;
    employerId?: string | null;
}): Promise<PacketWin[]> {
    const out: PacketWin[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 20; page += 1) {
        const result = await winGraph.listWins({
            userId: params.userId,
            filters: {
                status: PACKET_STATUSES,
                from: params.periodStart,
                to: params.periodEnd,
                ...(params.employerId ? { employerId: params.employerId } : {}),
                // A packet covers the period the user chose, not the period their
                // plan lets them scroll. The paywall for history lives in the log.
                includeBeyondHistoryLimit: true,
            },
            cursor,
            limit: 100,
        });
        if (!result.success) break;
        out.push(...result.data.items.map(toPacketWin));
        if (!result.data.nextCursor) break;
        cursor = result.data.nextCursor;
    }

    return out;
}

// ═══════════════════════════════════════════════════════════════ selection

const MAX_PACKET_WINS = 40;

/**
 * PRD 03 §10: with 200+ Wins in the period, take the strongest 40.
 *
 * `strength × recency × evidence` — a quantified Win outranks an unquantified
 * one, a recent Win outranks an old one within the same period, and a Win with
 * a source outranks a bare assertion. Ties break on date so the result is
 * stable across regenerations.
 */
export function scorePacketWin(win: PacketWin, periodEnd: Date): number {
    const monthsAgo = Math.max(0, (periodEnd.getTime() - win.occurredAt.getTime()) / (30 * 86_400_000));
    const recency = 1 / (1 + monthsAgo / 6);
    const strength = win.quantified ? 1.6 : 1.0;
    const evidence = win.hasEvidence ? 1.3 : 1.0;
    return strength * recency * evidence;
}

export function selectPacketWins(
    wins: readonly PacketWin[],
    periodEnd: Date,
    max = MAX_PACKET_WINS,
): { selected: PacketWin[]; omitted: number } {
    if (wins.length <= max) {
        return {
            selected: [...wins].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
            omitted: 0,
        };
    }
    const ranked = [...wins].sort((a, b) => {
        const delta = scorePacketWin(b, periodEnd) - scorePacketWin(a, periodEnd);
        if (Math.abs(delta) > 1e-9) return delta;
        return b.occurredAt.getTime() - a.occurredAt.getTime();
    });
    const selected = ranked
        .slice(0, max)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { selected, omitted: wins.length - max };
}

/**
 * Everything the model was allowed to draw numbers from — the words of the Wins
 * and nothing else. This is what the numeric guard polices generated prose against.
 */
export function guardSourceText(wins: readonly PacketWin[]): string {
    return wins
        .map((win) => [win.title, win.narrative, win.metric ?? ''].filter(Boolean).join(' '))
        .join('\n');
}

/**
 * The same source, plus the provenance labels a bullet renders ("PR #482").
 *
 * Deliberately wider than {@link guardSourceText}, and only ever used for
 * *verification*, never as licence for the model: an evidence label is part of
 * the Win's record, so a PR number in a bullet is a fact from the log — but it
 * is not in the generation prompt, so widening it here cannot loosen what the
 * model is allowed to write.
 */
export function verificationSourceText(wins: readonly PacketWin[]): string {
    return wins
        .map((win) =>
            [win.title, win.narrative, win.metric ?? '', win.evidenceLabel ?? '', win.evidenceUrl ?? '']
                .filter(Boolean)
                .join(' '),
        )
        .join('\n');
}

// ═══════════════════════════════════════════════════════ theme grouping

const ThemeResponseSchema = z.object({
    themes: z
        .array(
            z.object({
                title: z.string().min(1).max(80),
                outcomeSentence: z.string().min(1).max(240),
                winIds: z.array(z.string().min(1).max(64)).min(1),
                scope: z.string().max(160).nullable(),
                strength: z.enum(['headline', 'supporting']),
            }),
        )
        .min(1)
        .max(5),
    unthemed: z.array(z.string().min(1).max(64)),
    coherenceNote: z.string().max(400).nullable(),
});

export type RawTheme = z.infer<typeof ThemeResponseSchema>['themes'][number];
export type ThemeGrouping = {
    themes: RawTheme[];
    unthemed: string[];
    coherenceNote: string | null;
    /** True when the deterministic category grouping was used. Never surfaced as an error. */
    fellBack: boolean;
    costUsd: number;
};

const THEME_SYSTEM = [
    'You group a person\'s logged work into the 3–5 themes that make their case.',
    '',
    'This is the highest-value judgement in the document. Twelve wins about caching, queries and',
    'timeouts are one theme — "Made checkout reliable at peak" — not twelve bullet points.',
    '',
    'Rules:',
    '1. Between 1 and 5 themes. Never 6. Six themes reads as "I did a lot of unrelated things",',
    '   which is a Senior-not-Staff signal. Prefer 3–5.',
    '2. A theme title states an OUTCOME ("Made checkout reliable at peak"), never an activity',
    '   ("Performance work") and never a category name.',
    '3. Every `winId` must be one of the supplied ids. No win may appear in two themes.',
    '4. A win that genuinely does not belong anywhere goes in `unthemed`. Do not force it.',
    '5. `scope` only when a win explicitly states one. Otherwise null. Never estimate a scope.',
    '6. No number, percentage, currency amount, duration or multiplier may appear in a title,',
    '   outcome sentence or scope unless it appears verbatim in one of that theme\'s member wins.',
    '   Do not compute, infer or round. A percentage derived from two source numbers is fabricated.',
    '7. If the work genuinely does not group — several unrelated areas, no through-line — say so',
    '   in `coherenceNote` in one plain sentence. Inventing coherence is worse than naming its absence.',
].join('\n');

const CATEGORY_TITLE: Record<WinCategory, string> = {
    [WinCategory.shipped]: 'What I shipped',
    [WinCategory.improved]: 'What I made better',
    [WinCategory.fixed]: 'What I fixed',
    [WinCategory.led]: 'What I led',
    [WinCategory.influenced]: 'Where I changed the decision',
    [WinCategory.grew]: 'Who I grew',
    [WinCategory.learned]: 'What I learned and applied',
    [WinCategory.saved]: 'What I saved',
};

function fallbackThemeTitle(winIds: readonly string[], byId: ReadonlyMap<string, PacketWin>): string {
    const counts = new Map<WinCategory, number>();
    for (const id of winIds) {
        const win = byId.get(id);
        if (!win) continue;
        counts.set(win.category, (counts.get(win.category) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return dominant ? CATEGORY_TITLE[dominant] : 'Highlights';
}

/** Deterministic grouping by Win category. The fallback that never errors. */
export function categoryThemes(wins: readonly PacketWin[]): ThemeGrouping {
    const buckets = new Map<WinCategory, PacketWin[]>();
    for (const win of wins) {
        buckets.set(win.category, [...(buckets.get(win.category) ?? []), win]);
    }

    const ordered = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
    const kept = ordered.slice(0, 5);
    const spilled = ordered.slice(5).flatMap(([, items]) => items.map((win) => win.id));

    return {
        themes: kept.map(([category, items], index) => ({
            title: CATEGORY_TITLE[category],
            outcomeSentence: '',
            winIds: items.map((win) => win.id),
            scope: null,
            strength: index === 0 ? ('headline' as const) : ('supporting' as const),
        })),
        unthemed: spilled,
        coherenceNote:
            ordered.length > 5
                ? `Your work this period was spread across ${ordered.length} areas — that can read as unfocused. Consider leading with your three strongest.`
                : null,
        fellBack: true,
        costUsd: 0,
    };
}

/** Every referenced id in scope, no win in two themes, at most five themes. */
export function sanitizeThemes(
    raw: z.infer<typeof ThemeResponseSchema>,
    wins: readonly PacketWin[],
): { themes: RawTheme[]; unthemed: string[] } | null {
    const byId = new Map(wins.map((win) => [win.id, win]));
    const claimed = new Set<string>();
    const themes: RawTheme[] = [];

    for (const theme of raw.themes.slice(0, 5)) {
        const winIds = theme.winIds.filter((id) => byId.has(id) && !claimed.has(id));
        if (winIds.length === 0) continue;
        for (const id of winIds) claimed.add(id);
        // The numeric guard blanks a field rather than shipping a fabricated
        // figure in it, so a title can legitimately arrive empty. Fall back to
        // the deterministic category name rather than rendering a headless theme.
        const title = theme.title.trim() || fallbackThemeTitle(winIds, byId);
        themes.push({ ...theme, title, winIds });
    }

    if (themes.length === 0) return null;

    const unthemed = wins.map((win) => win.id).filter((id) => !claimed.has(id));
    return { themes, unthemed };
}

export async function groupWinsIntoThemes(params: {
    userId: string;
    wins: readonly PacketWin[];
    sessionId?: string;
}): Promise<ThemeGrouping> {
    if (params.wins.length === 0) {
        return { themes: [], unthemed: [], coherenceNote: null, fellBack: false, costUsd: 0 };
    }

    const sourceText = guardSourceText(params.wins);
    const winBlock = params.wins
        .map((win) =>
            [
                `- id: ${win.id}`,
                `  date: ${win.occurredAt.toISOString().slice(0, 10)}`,
                `  category: ${win.category}`,
                `  title: ${win.title}`,
                win.narrative ? `  detail: ${win.narrative.slice(0, 400)}` : null,
                win.metric ? `  metric: ${win.metric}` : null,
                win.employerName ? `  employer: ${win.employerName}` : null,
            ]
                .filter(Boolean)
                .join('\n'),
        )
        .join('\n');

    try {
        const result = await generateStructured({
            task: 'packetThemes',
            feature: 'review_packet',
            userId: params.userId,
            sessionId: params.sessionId,
            schema: ThemeResponseSchema,
            system: THEME_SYSTEM,
            prompt: ['Wins:', winBlock].join('\n'),
            guard: { sourceText, fields: ['themes'] },
        });

        const sanitized = sanitizeThemes(result.data, params.wins);
        if (!sanitized) return categoryThemes(params.wins);

        return {
            themes: sanitized.themes,
            unthemed: sanitized.unthemed,
            coherenceNote: result.data.coherenceNote,
            fellBack: false,
            costUsd: result.usage.costUsd,
        };
    } catch (error) {
        // PRD 03 §10: schema rejection or a model outage falls back to category
        // grouping, deterministically, with no error surfaced to the user.
        console.warn('[reviewPacket] theme grouping fell back to categories', {
            error: error instanceof Error ? error.message : String(error),
        });
        return categoryThemes(params.wins);
    }
}

// ═══════════════════════════════════════════════════════════ composition

/**
 * Field ceilings. Named because the truncation check needs the same numbers —
 * a literal repeated in two places would drift and silently disable the check.
 */
const COMPOSE_MAX = {
    summary: 1_400,
    outcomeSentence: 300,
    impact: 240,
    growth: 1_400,
} as const;

const ComposeResponseSchema = z.object({
    summary: z.string().min(1).max(COMPOSE_MAX.summary),
    themeOutcomes: z.array(
        z.object({
            index: z.number().int().min(0).max(4),
            outcomeSentence: z.string().min(1).max(COMPOSE_MAX.outcomeSentence),
            impact: z.string().max(COMPOSE_MAX.impact).nullable(),
        }),
    ),
    growth: z.string().max(COMPOSE_MAX.growth),
});

/**
 * Did the model run out of room rather than finish its sentence?
 *
 * A `maxLength` in a structured-output schema is not a request the model tries
 * to honour — the provider enforces it during generation and simply stops. A
 * real packet shipped a theme reading "…in four waves with a killwitch",
 * exactly 300 characters long, cut off mid-word. Zod saw a valid string, the
 * truthfulness pass saw grounded text, and the user got a sentence that ends
 * in a non-word.
 *
 * Both conditions are required. At the ceiling alone is not proof (a sentence
 * can legitimately land on 300), and missing punctuation alone is not either
 * (a fragment may be intentional). Together they are as close to certain as
 * this can get without a second call.
 */
export function hitCeiling(text: string, max: number): boolean {
    const trimmed = text.trimEnd();
    return trimmed.length >= max && !/[.!?]["')\]]?$/.test(trimmed);
}

/**
 * Salvage a truncated field by cutting back to its last complete thought.
 *
 * Discarding the whole paragraph is too blunt. Composition is expensive and
 * mostly good — the failure is confined to the tail — and the deterministic
 * fallback can be far worse: the first packet to hit this dropped 300
 * characters of usable prose in favour of a grouping sentence reading "no
 * rollback."
 *
 * Preference order is longest-safe-first:
 *   1. the last sentence terminator, keeping whole sentences;
 *   2. failing that, the last clause boundary (`;` or `—`), because these
 *      sentences are typically one long semicolon-joined chain with no
 *      internal full stop, and a clause is still a complete thought;
 *   3. nothing, leaving the caller to fall back.
 *
 * Only ever removes text, so it cannot introduce an unsupported claim; the
 * truthfulness pass still runs afterwards on whatever survives.
 */
export function trimToCompleteThought(text: string): string {
    const trimmed = text.trimEnd();

    const lastStop = Math.max(
        trimmed.lastIndexOf('.'),
        trimmed.lastIndexOf('!'),
        trimmed.lastIndexOf('?'),
    );
    if (lastStop > 0) return trimmed.slice(0, lastStop + 1);

    // No full stop anywhere: fall back to the last clause boundary and
    // terminate it ourselves.
    const lastClause = Math.max(trimmed.lastIndexOf(';'), trimmed.lastIndexOf(' — '));
    if (lastClause > 0) return `${trimmed.slice(0, lastClause).trimEnd()}.`;

    return '';
}

const BANNED_TOKENS = [
    'exceptional',
    'world-class',
    'world class',
    'rockstar',
    'ninja',
    'unparalleled',
    'best-in-class',
    'best in class',
    'incredible',
    'amazing',
];

const COMPOSE_SYSTEM = [
    'You write a performance review packet from a person\'s own confirmed record of their work.',
    '',
    'Rules, all of them hard:',
    '1. Every factual sentence must trace to at least one supplied win. If you cannot say it from',
    '   the wins, do not say it.',
    '2. No number, percentage, currency amount, duration or multiplier that does not appear',
    '   verbatim in a supplied win. Do not compute, infer, round, total or derive. A figure',
    '   calculated from two source figures is a fabricated figure.',
    `3. Banned words: ${BANNED_TOKENS.join(', ')}. No superlative the data did not earn.`,
    '4. The growth section must be specific and derived from the named gaps. "Continue learning"',
    '   is a failure. Name the competency, name what is missing, name what would close it.',
    '5. Plain declarative prose. First person. Never enthusiastic, never apologetic.',
    '6. `impact` is the scope line — who or what was affected. Null unless a win states it.',
].join('\n');

export type Composition = {
    summary: string;
    themeOutcomes: Map<number, { outcomeSentence: string; impact: string | null }>;
    growth: string;
    degraded: boolean;
    costUsd: number;
};

export async function composePacketProse(params: {
    userId: string;
    type: PacketTypeValue;
    audience: PacketAudience;
    wins: readonly PacketWin[];
    themes: readonly RawTheme[];
    assessments: readonly CompetencyAssessment[];
    targetLevel: FrameworkLevel | null;
    voiceDescriptor?: string | null;
    sessionId?: string;
}): Promise<Composition> {
    const config = PACKET_TYPE_CONFIG[params.type];
    const winById = new Map(params.wins.map((win) => [win.id, win]));
    const sourceText = guardSourceText(params.wins);

    const themeBlock = params.themes
        .map((theme, index) => {
            const members = theme.winIds
                .map((id) => winById.get(id))
                .filter((win): win is PacketWin => win !== undefined);
            return [
                `Theme ${index}: ${theme.title}`,
                ...members.map(
                    (win) => `  · ${win.title}${win.metric ? ` (${win.metric})` : ''}${win.narrative ? ` — ${win.narrative.slice(0, 240)}` : ''}`,
                ),
            ].join('\n');
        })
        .join('\n\n');

    const gapBlock = params.assessments
        .filter((item) => item.verdict === 'thin' || item.verdict === 'absent')
        .map((item) => `- ${item.name}: ${item.verdict} — ${item.rationale}`)
        .join('\n');

    const result = await generateStructured({
        task: 'packetCompose',
        feature: 'review_packet',
        userId: params.userId,
        sessionId: params.sessionId,
        schema: ComposeResponseSchema,
        system: params.voiceDescriptor
            ? `${COMPOSE_SYSTEM}\n\nMatch this person's writing voice: ${params.voiceDescriptor}`
            : COMPOSE_SYSTEM,
        prompt: [
            `Document type: ${config.label}. ${config.guidance}`,
            `Audience: ${AUDIENCE_GUIDANCE[params.audience]}`,
            params.targetLevel ? `Target level: ${params.targetLevel.name}. ${params.targetLevel.summary}` : null,
            `Approximate total length: ${config.wordTarget} words.`,
            '',
            'Write:',
            '- `summary`: about 120 words. Three sentences a busy manager could forward upward.',
            '- `themeOutcomes`: one entry per theme index below, an outcome sentence and an optional scope line.',
            config.includeGrowth
                ? '- `growth`: honest and forward-looking, written from the gaps below. Never flattering.'
                : '- `growth`: return an empty string.',
            '',
            'Themes:',
            themeBlock,
            '',
            gapBlock ? `Gaps in the record:\n${gapBlock}` : 'Gaps in the record: none identified.',
        ]
            .filter((line) => line !== null)
            .join('\n'),
        guard: { sourceText, fields: ['summary', 'growth', 'themeOutcomes'] },
    });

    // Drop any field the provider cut off at its ceiling. Assembly already
    // falls back to the deterministic sentence when a composed one is empty
    // (`composed?.outcomeSentence || theme.outcomeSentence`), so discarding
    // here yields the user's own words instead of a severed one — the same
    // fail-closed trade the numeric guard makes.
    const keep = (text: string, max: number): string => {
        if (!hitCeiling(text, max)) return stripBanned(text);

        const salvaged = trimToCompleteThought(text);
        console.warn('[reviewPacket] composed field hit its length ceiling', {
            max,
            ending: text.trimEnd().slice(-40),
            action: salvaged ? 'trimmed to the last complete thought' : 'dropped; using the fallback',
        });
        return salvaged ? stripBanned(salvaged) : '';
    };

    return {
        summary: keep(result.data.summary, COMPOSE_MAX.summary),
        themeOutcomes: new Map(
            result.data.themeOutcomes.map((entry) => [
                entry.index,
                {
                    outcomeSentence: keep(entry.outcomeSentence, COMPOSE_MAX.outcomeSentence),
                    impact:
                        entry.impact && hitCeiling(entry.impact, COMPOSE_MAX.impact)
                            ? null
                            : entry.impact,
                },
            ]),
        ),
        growth: keep(result.data.growth, COMPOSE_MAX.growth),
        degraded: result.degraded,
        costUsd: result.usage.costUsd,
    };
}

/** Rule 2 of §7.3, enforced rather than requested. */
export function stripBanned(text: string): string {
    let out = text;
    for (const token of BANNED_TOKENS) {
        out = out.replace(new RegExp(`\\b${token}\\b\\s*`, 'gi'), '');
    }
    return out.replace(/\s{2,}/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════ assembly

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodLabel(start: Date, end: Date): string {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    const left = `${MONTHS[start.getUTCMonth()]}${sameYear ? '' : ` ${start.getUTCFullYear()}`}`;
    return `${left} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

export function shortDate(date: Date): string {
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * A bullet is the Win, in the Win's own words. This is why a packet cannot
 * contain a fabricated number: the only place a figure appears is here, and here
 * it is copied.
 */
export function bulletFor(win: PacketWin): PacketBlock {
    const parts = [win.metric ? `${capitalize(win.metric)}` : win.title];
    if (win.metric && win.title !== win.metric) parts[0] = win.title;
    const trail = [win.metric, win.evidenceLabel, MONTHS[win.occurredAt.getUTCMonth()]].filter(Boolean);
    return {
        key: `bullet:${win.id}`,
        text: [parts[0], ...trail].join('  ·  '),
        sourceWinIds: [win.id],
        ground: 'grounded',
        warning: null,
    };
}

function capitalize(text: string): string {
    return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

export function countWords(content: PacketContent): number {
    const texts = [
        content.summary.text,
        content.growth.text,
        ...content.themes.flatMap((theme) => [
            theme.title,
            theme.outcome.text,
            theme.impact?.text ?? '',
            ...theme.bullets.map((bullet) => bullet.text),
        ]),
    ];
    return texts.join(' ').split(/\s+/).filter(Boolean).length;
}

export function assemblePacket(params: {
    type: PacketTypeValue;
    audience: PacketAudience;
    periodStart: Date;
    periodEnd: Date;
    employerName: string | null;
    framework: FrameworkView | null;
    targetLevel: FrameworkLevel | null;
    wins: readonly PacketWin[];
    grouping: ThemeGrouping;
    composition: Composition | null;
    assessments: readonly CompetencyAssessment[];
    omittedWinCount: number;
}): PacketContent {
    const config = PACKET_TYPE_CONFIG[params.type];
    const winById = new Map(params.wins.map((win) => [win.id, win]));

    const themes: PacketTheme[] = params.grouping.themes.map((theme, index) => {
        const composed = params.composition?.themeOutcomes.get(index) ?? null;
        const outcomeText = composed?.outcomeSentence || theme.outcomeSentence || '';
        const impactText = composed?.impact ?? theme.scope;
        const members = theme.winIds
            .map((id) => winById.get(id))
            .filter((win): win is PacketWin => win !== undefined)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

        return {
            key: `theme:${index}`,
            title: theme.title,
            outcome: {
                key: `theme:${index}:outcome`,
                text: outcomeText,
                sourceWinIds: theme.winIds,
                ground: 'grounded',
                warning: null,
            },
            impact: impactText
                ? {
                    key: `theme:${index}:impact`,
                    text: impactText,
                    sourceWinIds: theme.winIds,
                    ground: 'grounded',
                    warning: null,
                }
                : null,
            strength: theme.strength,
            winIds: theme.winIds,
            bullets: members.map(bulletFor),
        };
    });

    const allWinIds = params.wins.map((win) => win.id);

    const content: PacketContent = {
        version: 1,
        header: {
            typeLabel: config.label,
            periodLabel: periodLabel(params.periodStart, params.periodEnd),
            employerName: params.employerName,
            frameworkName: params.framework?.name ?? null,
            targetLevelName: params.targetLevel?.name ?? null,
            audience: params.audience,
        },
        summary: {
            key: 'summary',
            text: params.composition?.summary ?? '',
            sourceWinIds: allWinIds,
            ground: 'grounded',
            warning: null,
        },
        themes,
        competencies: config.includeCompetencies ? [...params.assessments] : [],
        growth: {
            key: 'growth',
            text: config.includeGrowth ? params.composition?.growth ?? '' : '',
            sourceWinIds: allWinIds,
            ground: 'grounded',
            warning: null,
        },
        appendix: {
            winIds: allWinIds,
            note:
                params.omittedWinCount > 0
                    ? `Showing your ${params.wins.length} strongest of ${params.wins.length + params.omittedWinCount}.`
                    : null,
        },
        coherenceNote: params.grouping.coherenceNote,
        unthemedWinIds: params.grouping.unthemed,
        warnings: [],
        wordCount: 0,
        confidentialWinIds: params.wins
            .filter((win) => win.sensitivity === WinSensitivity.confidential)
            .map((win) => win.id),
    };

    content.wordCount = countWords(content);
    return content;
}

// ═══════════════════════════════════════════════════════ truthfulness pass

/**
 * PRD 03 §7.4. Every generated sentence goes back through the grounding path
 * against the packet's own `winIds`. Fail closed: a sentence we cannot tie to a
 * Win resolves DOWN to `needs_confirmation`, and a sentence carrying a figure
 * that is not in the log resolves to `unsupported`.
 *
 * A packet may ship with warnings. It may never ship with a silent fabrication.
 */
export type GroundingVerdict = {
    blockKey: string;
    claimRefId: string;
    ground: GroundStateValue;
    warning: string | null;
};

export function verifyBlock(params: {
    packetId: string;
    block: PacketBlock;
    scopeWinIds: ReadonlySet<string>;
    sourceQuantities: readonly Quantity[];
}): GroundingVerdict {
    const { block } = params;
    const claimRefId = claimRefIdFor(params.packetId, block.text);

    if (!block.text.trim()) {
        return { blockKey: block.key, claimRefId, ground: 'needs_confirmation', warning: null };
    }

    const inScope = block.sourceWinIds.filter((id) => params.scopeWinIds.has(id));
    if (inScope.length === 0) {
        return {
            blockKey: block.key,
            claimRefId,
            ground: 'needs_confirmation',
            warning: 'We could not tie this to a win — edit or remove it.',
        };
    }

    for (const quantity of extractQuantities(block.text, 'strict')) {
        if (quantity.kind === 'year' || quantity.kind === 'date') continue;
        if (isQuantitySupported(quantity, params.sourceQuantities as Quantity[])) continue;
        return {
            blockKey: block.key,
            claimRefId,
            ground: 'unsupported',
            warning: `"${quantity.raw.trim()}" does not appear in any win — edit or remove it.`,
        };
    }

    return { blockKey: block.key, claimRefId, ground: 'grounded', warning: null };
}

export function collectBlocks(content: PacketContent): PacketBlock[] {
    const blocks: PacketBlock[] = [content.summary, content.growth];
    for (const theme of content.themes) {
        blocks.push(theme.outcome);
        if (theme.impact) blocks.push(theme.impact);
        blocks.push(...theme.bullets);
    }
    return blocks.filter((block) => block.text.trim().length > 0);
}

/**
 * Words the source corpus only ever capitalizes because they START a sentence.
 *
 * Composition lifts evidence verbatim, which is what keeps it grounded, but a
 * fragment that began a sentence in the note keeps its capital when the model
 * drops it mid-sentence. A real packet read "…migrating off the legacy queue
 * in Four waves…", because the source narrative was "Four waves with a kill
 * switch at each one." It happened twice in 389 words, so it is systematic for
 * anyone whose notes start with a capitalized common word.
 *
 * The rule is evidence-driven rather than lexical, because a dictionary cannot
 * tell "Four" from "Acme". A word is demoted only when the source both
 * capitalizes it at a sentence start AND never capitalizes it anywhere else.
 * "Acme" and "Stripe" appear mid-sentence in the corpus, so they can never
 * qualify — no proper-noun list to maintain and no way for one to leak in.
 */
function sentenceInitialOnlyWords(wins: readonly PacketWin[]): Set<string> {
    // Deliberately NOT `verificationSourceText`: that joins a win's fields with
    // spaces, which is fine for pulling quantities out but destroys the
    // boundaries this analysis depends on. Concatenated, the narrative "Four
    // waves…" lands mid-line after the title and looks like a mid-sentence
    // capital — the exact word we need to classify gets disqualified. Each
    // field is its own line here, so a field-initial word is sentence-initial.
    const corpus = wins
        .flatMap((win) => [win.title, win.narrative, win.metric ?? '', win.evidenceLabel ?? ''])
        .filter(Boolean)
        .join('\n');

    const initial = new Set<string>();
    const elsewhere = new Set<string>();

    // A sentence starts at the beginning of a line or after .!?; anything else
    // that is capitalized mid-sentence is a genuine proper noun or acronym.
    const WORD = /([A-Z][a-z]+)/g;
    for (const line of corpus.split('\n')) {
        for (const sentence of line.split(/(?<=[.!?])\s+/)) {
            const trimmed = sentence.trim();
            if (!trimmed) continue;
            let first = true;
            for (const match of trimmed.matchAll(WORD)) {
                const word = match[1];
                // Only the leading word of the sentence counts as initial, and
                // only when the sentence literally begins with it.
                if (first && match.index === 0) initial.add(word);
                else elsewhere.add(word);
                first = false;
            }
        }
    }

    for (const word of elsewhere) initial.delete(word);
    return initial;
}

/** Lowercase demotable words wherever they appear mid-sentence in `text`. */
function normalizeSplicedCase(text: string, demotable: ReadonlySet<string>): string {
    if (!text || demotable.size === 0) return text;

    let sentenceStart = true;
    return text.replace(/([A-Za-z][A-Za-z-]*)|([.!?]+\s*)|(\s+)|([^\sA-Za-z]+)/g, (token, word, stop) => {
        if (stop !== undefined) {
            sentenceStart = true;
            return token;
        }
        if (word === undefined) return token;

        const atStart = sentenceStart;
        sentenceStart = false;
        // Never touch the first word of a sentence — there the capital is correct.
        if (atStart) return token;
        return demotable.has(word) ? word[0].toLowerCase() + word.slice(1) : token;
    });
}

export function runTruthfulnessPass(params: {
    packetId: string;
    content: PacketContent;
    wins: readonly PacketWin[];
}): PacketContent {
    const scopeWinIds = new Set(params.wins.map((win) => win.id));
    const sourceQuantities = flattenQuantities(extractQuantities(verificationSourceText(params.wins), 'lenient'));

    const verdicts = new Map<string, GroundingVerdict>();
    for (const block of collectBlocks(params.content)) {
        verdicts.set(
            block.key,
            verifyBlock({ packetId: params.packetId, block, scopeWinIds, sourceQuantities }),
        );
    }

    const apply = (block: PacketBlock): PacketBlock => {
        const verdict = verdicts.get(block.key);
        if (!verdict) return block;
        return { ...block, ground: verdict.ground, warning: verdict.warning };
    };

    /**
     * Case-normalize model-composed prose only.
     *
     * Bullets are win titles reproduced verbatim, so their capitalization is
     * the user's own and must not be touched. Grounding is computed before
     * this runs and is unaffected: demoting a letter changes no quantity, no
     * entity and no word.
     */
    const demotable = sentenceInitialOnlyWords(params.wins);
    const applyProse = (block: PacketBlock): PacketBlock => {
        const verified = apply(block);
        return { ...verified, text: normalizeSplicedCase(verified.text, demotable) };
    };

    const content: PacketContent = {
        ...params.content,
        summary: applyProse(params.content.summary),
        growth: applyProse(params.content.growth),
        themes: params.content.themes.map((theme) => ({
            ...theme,
            outcome: applyProse(theme.outcome),
            impact: theme.impact ? applyProse(theme.impact) : null,
            bullets: theme.bullets.map(apply),
        })),
        warnings: [...verdicts.values()]
            .filter((verdict) => verdict.warning !== null)
            .map((verdict) => ({ blockKey: verdict.blockKey, reason: verdict.warning as string })),
    };

    return content;
}

/**
 * The independent digit check used by the eval corpus (§11, hard launch gate).
 * Deliberately *not* the same code path as the guard inside `generateStructured`:
 * a gate that shares its implementation with the thing it is gating proves nothing.
 */
export function auditPacketNumbers(
    content: PacketContent,
    wins: readonly PacketWin[],
): { path: string; text: string; quantity: string }[] {
    const sourceQuantities = flattenQuantities(extractQuantities(verificationSourceText(wins), 'lenient'));
    const violations: { path: string; text: string; quantity: string }[] = [];

    const check = (path: string, text: string) => {
        for (const quantity of extractQuantities(text, 'strict')) {
            if (quantity.kind === 'year' || quantity.kind === 'date') continue;
            if (isQuantitySupported(quantity, sourceQuantities)) continue;
            violations.push({ path, text, quantity: quantity.raw.trim() });
        }
    };

    check('summary', content.summary.text);
    check('growth', content.growth.text);
    if (content.coherenceNote) check('coherenceNote', content.coherenceNote);
    content.themes.forEach((theme, index) => {
        check(`themes.${index}.title`, theme.title);
        check(`themes.${index}.outcome`, theme.outcome.text);
        if (theme.impact) check(`themes.${index}.impact`, theme.impact.text);
        theme.bullets.forEach((bullet, position) => check(`themes.${index}.bullets.${position}`, bullet.text));
    });

    return violations;
}

// ═══════════════════════════════════════════════════════════ user edits

export type UserEdits = Record<string, string>;

/**
 * PRD 03 §10: "regenerate after edits" merges `userEdits` over new content by
 * block key. An edited block keeps the user's words *and* keeps its
 * `sourceWinIds` — the provenance belongs to the block, not to the sentence.
 */
export function applyUserEdits(content: PacketContent, edits: UserEdits): PacketContent {
    if (Object.keys(edits).length === 0) return content;

    const patch = (block: PacketBlock): PacketBlock => {
        const edited = edits[block.key];
        if (edited === undefined) return block;
        return { ...block, text: edited };
    };

    const next: PacketContent = {
        ...content,
        summary: patch(content.summary),
        growth: patch(content.growth),
        themes: content.themes.map((theme) => ({
            ...theme,
            title: edits[`${theme.key}:title`] ?? theme.title,
            outcome: patch(theme.outcome),
            impact: theme.impact ? patch(theme.impact) : null,
            bullets: theme.bullets.map(patch),
        })),
    };
    next.wordCount = countWords(next);
    return next;
}

export function parseUserEdits(value: Prisma.JsonValue | null | undefined): UserEdits {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: UserEdits = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'string') out[key] = entry;
    }
    return out;
}

export function parsePacketContent(value: Prisma.JsonValue | null | undefined): PacketContent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Partial<PacketContent>;
    if (candidate.version !== 1 || !candidate.summary || !Array.isArray(candidate.themes)) return null;
    // Dates do not survive the JSON round trip; nothing in `PacketContent` stores one.
    return candidate as PacketContent;
}

export function readProgress(value: Prisma.JsonValue | null | undefined): PacketProgress | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const progress = (value as Record<string, unknown>).progress;
    if (!progress || typeof progress !== 'object' || !Array.isArray((progress as PacketProgress).stages)) {
        return null;
    }
    return progress as PacketProgress;
}

// ═══════════════════════════════════════════════════════════════ export

export type ExportOptions = {
    /** §3.3: the choice is remembered per packet, not globally. */
    includeConfidential: boolean;
    includeAppendix?: boolean;
};

/**
 * Markdown is the primary real use: this gets pasted into Workday, Lattice and
 * Google Docs. Which is why there are no tables, no HTML, and no reference-style
 * links — all three survive the round trip badly. Headings, bullets and bold do.
 */
export function renderMarkdown(
    content: PacketContent,
    wins: readonly PacketWin[],
    options: ExportOptions,
): string {
    const winById = new Map(wins.map((win) => [win.id, win]));
    const hidden = new Set(options.includeConfidential ? [] : content.confidentialWinIds);
    const visible = (id: string) => !hidden.has(id);

    const lines: string[] = [];
    const header = content.header;

    lines.push(
        `# ${[header.typeLabel, header.periodLabel, header.employerName].filter(Boolean).join(' · ')}`,
    );
    if (header.targetLevelName) lines.push('', `**Target level:** ${header.targetLevelName}`);
    lines.push('');

    if (content.summary.text.trim()) {
        lines.push('## Summary', '', content.summary.text.trim(), '');
    }

    const themes = content.themes.filter((theme) => theme.winIds.some(visible));
    if (themes.length > 0) {
        lines.push('## Highlights', '');
        for (const theme of themes) {
            lines.push(`### ${theme.title}`, '');
            if (theme.outcome.text.trim()) lines.push(theme.outcome.text.trim(), '');
            for (const bullet of theme.bullets) {
                if (!bullet.sourceWinIds.every(visible)) continue;
                const locked = bullet.sourceWinIds.some(
                    (id) => winById.get(id)?.sensitivity === WinSensitivity.confidential,
                );
                lines.push(`- ${locked ? '🔒 ' : ''}${bullet.text}`);
            }
            lines.push('');
            if (theme.impact?.text.trim()) lines.push(`**Scope:** ${theme.impact.text.trim()}`, '');
        }
    }

    if (content.coherenceNote) {
        lines.push(`> ${content.coherenceNote}`, '');
    }

    if (content.competencies.length > 0) {
        lines.push('## By competency', '');
        for (const item of content.competencies) {
            lines.push(`- **${item.name}** — ${item.verdict}. ${item.rationale}`);
        }
        lines.push('');
    }

    if (content.growth.text.trim()) {
        lines.push("## Growth & what's next", '', content.growth.text.trim(), '');
    }

    if (options.includeAppendix !== false) {
        const appendixWins = content.appendix.winIds
            .filter(visible)
            .map((id) => winById.get(id))
            .filter((win): win is PacketWin => win !== undefined)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

        if (appendixWins.length > 0) {
            lines.push('## Appendix — full win list', '');
            if (content.appendix.note) lines.push(`_${content.appendix.note}_`, '');
            for (const win of appendixWins) {
                const locked = win.sensitivity === WinSensitivity.confidential ? '🔒 ' : '';
                const trail = [win.metric, win.evidenceLabel, shortDate(win.occurredAt)].filter(Boolean);
                lines.push(`- ${locked}${win.title}${trail.length > 0 ? ` — ${trail.join(' · ')}` : ''}`);
            }
            lines.push('');
        }
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Plain text: the same document with the markdown syntax removed, not a different one. */
export function renderPlainText(
    content: PacketContent,
    wins: readonly PacketWin[],
    options: ExportOptions,
): string {
    return renderMarkdown(content, wins, options)
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^- /gm, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/_(.+?)_/g, '$1');
}

// ═══════════════════════════════════════════════════════════ readiness

export type UnloggedEvidence = {
    competencyKey: string;
    competencyName: string;
    count: number;
    /** At most three, for the card. */
    samples: { id: string; title: string; url: string | null; occurredAt: Date; kind: string }[];
};

export type ReadinessReport = {
    frameworkId: string | null;
    frameworkName: string;
    targetLevelKey: string | null;
    targetLevelName: string | null;
    periodStart: Date;
    periodEnd: Date;
    winCount: number;
    competencies: CompetencyAssessment[];
    /** Paragraphs. Honest, specific, never flattering. */
    honestRead: string[];
    /** Concrete, checkable actions. */
    whatWouldCloseIt: string[];
    unloggedEvidence: UnloggedEvidence | null;
    /** True when the mapping came from the deterministic priors alone. */
    degraded: boolean;
};

/**
 * The honest read (§4.3), composed deterministically.
 *
 * Tone is a design constraint here, and a template that can only restate counts
 * and quote the framework verbatim cannot drift into flattery between one run
 * and the next. There is also no score out of 100, deliberately: a number
 * invites optimising the number.
 */
export function writeHonestRead(params: {
    assessments: readonly CompetencyAssessment[];
    competencies: readonly FrameworkCompetency[];
    targetLevel: FrameworkLevel | null;
    winsById: ReadonlyMap<string, PacketWin>;
}): string[] {
    const { assessments } = params;
    if (assessments.length === 0) return [];

    const strong = assessments.filter((item) => item.verdict === 'strong');
    const weak = assessments.filter((item) => item.verdict === 'thin' || item.verdict === 'absent');
    const paragraphs: string[] = [];

    if (strong.length === 0 && weak.length === assessments.length) {
        paragraphs.push(
            'Nothing in this period reaches the bar on any competency in this framework. That is a record problem as often as it is a work problem — but as it stands, there is no case here yet.',
        );
    } else if (strong.length > 0 && weak.length > 0) {
        paragraphs.push(
            `Your ${strong[0].name.toLowerCase()} case is strong. Your ${weak[0].name.toLowerCase()} case is not.`,
        );
    } else if (weak.length === 0) {
        paragraphs.push(
            'Every competency in this framework has evidence behind it. The question is depth, not coverage — the thinnest column is what a calibration room will ask about.',
        );
    } else {
        paragraphs.push(`Your ${weak[0].name.toLowerCase()} case is the one that is not there yet.`);
    }

    const decider = weak[0];
    if (decider) {
        const definition = params.competencies.find((item) => item.key === decider.key);
        const expectation = params.targetLevel
            ? definition?.levelExpectations?.[params.targetLevel.key]
            : undefined;
        const example = decider.winIds
            .map((id) => params.winsById.get(id))
            .find((win): win is PacketWin => win !== undefined);

        const sentences: string[] = [];
        if (expectation && params.targetLevel) {
            const quoted = expectation.replace(/"/g, "'").replace(/\s*\.\s*$/, '');
            sentences.push(`${params.targetLevel.name} requires "${quoted}".`);
        }
        if (decider.verdict === 'absent') {
            sentences.push(`Your log has nothing under ${decider.name.toLowerCase()} for this period.`);
        } else if (example) {
            sentences.push(
                `Your log shows ${decider.coverage === 1 ? 'one' : decider.coverage} ${decider.name.toLowerCase()} ${decider.coverage === 1 ? 'win' : 'wins'} — ${example.title} (${shortDate(example.occurredAt)}).`,
            );
        }
        sentences.push('That is the gap that decides this.');
        paragraphs.push(sentences.join(' '));
    }

    const unquantified = assessments.filter(
        (item) => item.coverage > 0 && item.quantifiedCount === 0,
    );
    if (unquantified.length > 0) {
        paragraphs.push(
            `${unquantified.map((item) => item.name).join(', ')} ${unquantified.length === 1 ? 'has' : 'have'} evidence but no numbers. An unquantified claim is arguable, and therefore ignorable.`,
        );
    }

    return paragraphs;
}

export function writeWhatWouldCloseIt(assessments: readonly CompetencyAssessment[]): string[] {
    const out: string[] = [];
    for (const item of assessments) {
        if (item.verdict === 'absent') {
            out.push(`Any ${item.name.toLowerCase()} you are already doing but have not logged.`);
        } else if (item.verdict === 'thin') {
            out.push(
                `Two more ${item.name.toLowerCase()} contributions with a named outcome — you have ${item.coverage}.`,
            );
        } else if (item.coverage > 0 && item.quantifiedCount === 0) {
            out.push(`A number on at least one of your ${item.coverage} ${item.name.toLowerCase()} wins.`);
        }
    }
    return out.slice(0, 5);
}

/** Keywords that make an unconverted capture signal plausibly relevant to a competency. */
const COMPETENCY_SIGNAL_KEYWORDS: Record<string, string[]> = {
    mentorship: ['review', 'mentor', 'onboard', 'pair', 'interview', 'intern', 'coach'],
    influence: ['rfc', 'proposal', 'design review', 'adr', 'decision', 'align'],
    communication: ['doc', 'write-up', 'postmortem', 'post-mortem', 'presentation', 'rfc'],
    scope_ambiguity: ['migration', 'platform', 'cross-team', 'cross team', 'architecture', 'roadmap'],
    execution: ['ship', 'release', 'launch', 'deploy', 'fix', 'incident'],
    technical_depth: ['refactor', 'performance', 'latency', 'optimiz', 'optimis', 'debug'],
};

function keywordsFor(assessment: CompetencyAssessment): string[] {
    const explicit = COMPETENCY_SIGNAL_KEYWORDS[assessment.key];
    if (explicit) return explicit;
    // An uploaded rubric has its own vocabulary; the competency's own words are
    // the only honest thing to match on.
    return assessment.name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((word) => word.length >= 4);
}

/**
 * PRD 03 §4.3 — the strongest single interaction in the spec: find the evidence
 * the user already has but has not logged, and link to it.
 *
 * `CaptureSignal` is built by another workstream and may be empty or absent.
 * Every failure mode here degrades to `null`, which hides the card.
 */
export async function findUnloggedEvidence(params: {
    userId: string;
    assessments: readonly CompetencyAssessment[];
    periodStart: Date;
    periodEnd: Date;
}): Promise<UnloggedEvidence | null> {
    const weak = params.assessments.filter(
        (item) => item.verdict === 'absent' || item.verdict === 'thin',
    );
    if (weak.length === 0) return null;

    try {
        const signals = await prisma.captureSignal.findMany({
            where: {
                userId: params.userId,
                winId: null,
                isNoise: false,
                occurredAt: { gte: params.periodStart, lte: params.periodEnd },
            },
            select: { id: true, title: true, body: true, url: true, occurredAt: true, kind: true },
            orderBy: { occurredAt: 'desc' },
            take: 200,
        });
        if (signals.length === 0) return null;

        for (const assessment of weak) {
            const keywords = keywordsFor(assessment);
            if (keywords.length === 0) continue;
            const matches = signals.filter((signal) => {
                const haystack = `${signal.title} ${signal.body} ${signal.kind}`.toLowerCase();
                return keywords.some((keyword) => haystack.includes(keyword));
            });
            if (matches.length === 0) continue;

            return {
                competencyKey: assessment.key,
                competencyName: assessment.name,
                count: matches.length,
                samples: matches.slice(0, 3).map((signal) => ({
                    id: signal.id,
                    title: signal.title,
                    url: signal.url,
                    occurredAt: signal.occurredAt,
                    kind: signal.kind,
                })),
            };
        }

        return null;
    } catch (error) {
        // The capture tables may not exist yet in every environment. A missing
        // card is a smaller failure than a readiness page that will not render.
        console.warn('[reviewPacket] unlogged-evidence lookup unavailable', {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * The standalone readiness report (§4.3). Available year-round at
 * `/log/readiness`, independent of review season — which is the point of it.
 */
export async function buildReadinessReport(params: {
    userId: string;
    frameworkId?: string | null;
    targetLevel?: string | null;
    periodStart: Date;
    periodEnd: Date;
    employerId?: string | null;
    /** Skip the model refinement; priors only. Used by the cached/free path. */
    deterministicOnly?: boolean;
}): Promise<ReadinessReport> {
    const framework = params.frameworkId
        ? await getFramework({ userId: params.userId, frameworkId: params.frameworkId })
        : null;
    const shape = framework ?? {
        ...PATRONUS_DEFAULT_FRAMEWORK,
        id: 'patronus-default',
        userId: null,
        sourceType: 'default' as const,
        isConfidential: false,
        attribution: null,
    };

    const wins = await loadPacketWins({
        userId: params.userId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        employerId: params.employerId ?? null,
    });

    const { level } = resolveTargetLevel(shape.levels, params.targetLevel);

    const mapping = params.deterministicOnly
        ? { mappings: [], fellBack: true, costUsd: 0 }
        : await mapWinsToCompetencies({
            userId: params.userId,
            wins: wins.map((win) => ({
                id: win.id,
                category: win.category,
                title: win.title,
                narrative: win.narrative,
                occurredAt: win.occurredAt,
                metric: win.metric,
            })),
            competencies: shape.competencies,
            targetLevel: level ? { key: level.key, name: level.name } : null,
        });

    const mappings =
        mapping.mappings.length > 0
            ? mapping.mappings
            : priorMappings(wins, shape.competencies);

    const assessments = assessCompetencies({
        competencies: shape.competencies,
        mappings,
        wins: wins.map((win) => ({
            id: win.id,
            title: win.title,
            occurredAt: win.occurredAt,
            quantified: win.quantified,
        })),
    });

    const winsById = new Map(wins.map((win) => [win.id, win]));

    return {
        frameworkId: framework?.id ?? null,
        frameworkName: shape.name,
        targetLevelKey: level?.key ?? null,
        targetLevelName: level?.name ?? null,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        winCount: wins.length,
        competencies: assessments,
        honestRead: writeHonestRead({
            assessments,
            competencies: shape.competencies,
            targetLevel: level,
            winsById,
        }),
        whatWouldCloseIt: writeWhatWouldCloseIt(assessments),
        unloggedEvidence: await findUnloggedEvidence({
            userId: params.userId,
            assessments,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
        }),
        degraded: mapping.fellBack,
    };
}
