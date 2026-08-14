/**
 * Competency frameworks and rubric mapping (PRD 03 §4).
 *
 * This is the differentiated half of the review packet: anyone can summarize a
 * list of wins; mapping them onto *your company's actual leveling framework*
 * and naming the gaps is what nobody else does.
 *
 * Everything here takes an explicit `userId` and returns plain data, so the
 * whole layer is testable against a real database without Clerk. Auth, zod
 * parsing, metering and telemetry live one level up in `src/actions/packets.ts`.
 *
 * Two rules that shape the code:
 *
 *  1. **Never generate against an unconfirmed framework.** `parseFrameworkText`
 *     returns a *draft* and writes nothing. Only `createFramework` — called
 *     after the user has seen the confirmation screen — persists a row. That
 *     makes the PRD §10 edge case ("rubric parse produces garbage") structurally
 *     impossible rather than merely unlikely.
 *  2. **Under-claiming is correct; over-claiming is a failure.** `absent` is
 *     returned honestly. A gap report that always says you are ready is worthless.
 */

import { FrameworkSource, WinCategory, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';

// ═══════════════════════════════════════════════════════════════ shapes

export const FrameworkLevelSchema = z.object({
    key: z.string().min(1).max(60),
    name: z.string().min(1).max(80),
    order: z.number().int().min(0).max(50),
    summary: z.string().max(400).default(''),
});

export const FrameworkCompetencySchema = z.object({
    key: z.string().min(1).max(60),
    name: z.string().min(1).max(80),
    description: z.string().max(600).default(''),
    /** levelKey -> what this competency looks like at that level. */
    levelExpectations: z.record(z.string(), z.string().max(800)).default({}),
});

export const FrameworkShapeSchema = z.object({
    name: z.string().min(1).max(120),
    companyName: z.string().max(120).nullable().default(null),
    levels: z.array(FrameworkLevelSchema).min(1).max(12),
    competencies: z.array(FrameworkCompetencySchema).min(1).max(20),
});

export type FrameworkLevel = z.infer<typeof FrameworkLevelSchema>;
export type FrameworkCompetency = z.infer<typeof FrameworkCompetencySchema>;
export type FrameworkShape = z.infer<typeof FrameworkShapeSchema>;

/** A framework as the UI and the packet pipeline consume it. */
export type FrameworkView = FrameworkShape & {
    id: string;
    sourceType: FrameworkSource;
    /** Null for the system-owned public templates. */
    userId: string | null;
    isConfidential: boolean;
    /** Attribution line for a public template; null otherwise. */
    attribution: string | null;
};

// ═══════════════════════════════════════════════════ the Patronus default

/**
 * PRD 03 §4.1 path 3 — the six-competency generic ladder used when the user has
 * nothing else. Deliberately the same six the category priors map onto, so the
 * deterministic fallback and the AI mapping speak the same vocabulary.
 */
export const DEFAULT_COMPETENCY_KEYS = [
    'execution',
    'technical_depth',
    'scope_ambiguity',
    'influence',
    'communication',
    'mentorship',
] as const;

export type DefaultCompetencyKey = (typeof DEFAULT_COMPETENCY_KEYS)[number];

const GENERIC_LEVELS: FrameworkLevel[] = [
    { key: 'l1', name: 'Junior', order: 0, summary: 'Delivers well-scoped tasks with support.' },
    { key: 'l2', name: 'Mid', order: 1, summary: 'Owns features end to end.' },
    { key: 'l3', name: 'Senior', order: 2, summary: 'Owns a system; unblocks others.' },
    { key: 'l4', name: 'Staff', order: 3, summary: 'Impact across at least two teams.' },
    { key: 'l5', name: 'Principal', order: 4, summary: 'Sets technical direction for an org.' },
];

export const PATRONUS_DEFAULT_FRAMEWORK: FrameworkShape = {
    name: 'General (Patronus default)',
    companyName: null,
    levels: GENERIC_LEVELS,
    competencies: [
        {
            key: 'execution',
            name: 'Execution',
            description: 'Ships work that lands, on a predictable cadence, without leaving a mess.',
            levelExpectations: {
                l3: 'Delivers a system-sized body of work without close supervision.',
                l4: 'Delivers work whose outcome is felt outside the immediate team.',
            },
        },
        {
            key: 'technical_depth',
            name: 'Technical depth',
            description: 'Understands the system deeply enough to make non-obvious calls correctly.',
            levelExpectations: {
                l3: 'Is the person consulted on the hardest problems in one area.',
                l4: 'Sets the technical approach others build on.',
            },
        },
        {
            key: 'scope_ambiguity',
            name: 'Scope & ambiguity',
            description: 'Takes on problems that arrive undefined and returns them defined.',
            levelExpectations: {
                l3: 'Turns a vague team goal into a plan.',
                l4: 'Impact across at least two teams; picks the problem, not just the solution.',
            },
        },
        {
            key: 'influence',
            name: 'Influence',
            description: 'Changes what other people and other teams decide to do.',
            levelExpectations: {
                l3: 'Moves the team to a better decision.',
                l4: 'Moves other teams to a better decision without authority.',
            },
        },
        {
            key: 'communication',
            name: 'Communication',
            description: 'Written and spoken work that makes complex things decidable.',
            levelExpectations: {
                l3: 'Writes documents that get decisions made.',
                l4: 'Communicates upward and outward; represents the work to leadership.',
            },
        },
        {
            key: 'mentorship',
            name: 'Mentorship',
            description: 'Makes other engineers better in ways they would name themselves.',
            levelExpectations: {
                l3: 'Grows one or two engineers deliberately.',
                l4: 'Raises the bar of a group — reviews, standards, onboarding.',
            },
        },
    ],
};

// ═══════════════════════════════════════════════════ the six public templates

/**
 * PRD 03 §4.1 path 2. Publicly published ladders, stored as system-owned rows
 * (`userId: null`, `sourceType: 'template'`) with attribution. These are
 * summaries of public documents, not copies of them.
 */
export type PublicTemplate = FrameworkShape & { attribution: string };

function ladder(names: string[]): FrameworkLevel[] {
    return names.map((name, index) => ({
        key: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        name,
        order: index,
        summary: '',
    }));
}

function competency(key: string, name: string, description: string): FrameworkCompetency {
    return { key, name, description, levelExpectations: {} };
}

export const PUBLIC_FRAMEWORK_TEMPLATES: PublicTemplate[] = [
    {
        name: 'Google SWE ladder',
        companyName: 'Google',
        attribution: "Summarized from Google's publicly described SWE levels.",
        levels: ladder(['L3', 'L4', 'L5', 'L6', 'L7']),
        competencies: [
            competency('impact', 'Impact', 'The measurable effect of the work on users and the business.'),
            competency('technical_ability', 'Technical ability', 'Design and implementation quality at increasing scale.'),
            competency('leadership', 'Leadership', 'Driving projects and people without needing authority.'),
            competency('scope', 'Scope', 'Team, multi-team, organization, or company-wide.'),
            competency('communication', 'Communication', 'Design docs, reviews, and cross-functional alignment.'),
        ],
    },
    {
        name: 'Meta E-series',
        companyName: 'Meta',
        attribution: "Summarized from Meta's publicly described E3–E7 engineering levels.",
        levels: ladder(['E3', 'E4', 'E5', 'E6', 'E7']),
        competencies: [
            competency('project_impact', 'Project impact', 'Outcomes delivered, measured in product or infrastructure terms.'),
            competency('engineering_excellence', 'Engineering excellence', 'Code, design, and operational quality.'),
            competency('direction', 'Direction', 'Choosing the right problem and setting the approach.'),
            competency('people', 'People', 'Mentorship, onboarding, and raising the team.'),
            competency('embodying_values', 'Embodying values', 'How the work gets done, not only what ships.'),
        ],
    },
    {
        name: 'Dropbox engineering ladder',
        companyName: 'Dropbox',
        attribution: "Summarized from Dropbox's published engineering career framework.",
        levels: ladder(['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'IC6']),
        competencies: [
            competency('results', 'Results', 'Delivering outcomes at the expected scope.'),
            competency('direction', 'Direction', 'Setting technical direction and prioritising.'),
            competency('talent', 'Talent', 'Growing others and hiring.'),
            competency('culture', 'Culture', 'Improving how the team works.'),
            competency('craft', 'Craft', 'Depth and quality of engineering work.'),
        ],
    },
    {
        name: 'CircleCI engineering competency matrix',
        companyName: 'CircleCI',
        attribution: "Summarized from CircleCI's published engineering competency matrix.",
        levels: ladder(['Engineer', 'Senior Engineer', 'Staff Engineer', 'Principal Engineer']),
        competencies: [
            competency('technical_skill', 'Technical skill', 'Building and operating systems well.'),
            competency('getting_stuff_done', 'Getting stuff done', 'Consistent, predictable delivery.'),
            competency('impact', 'Impact', 'How far the effect of the work reaches.'),
            competency('communication', 'Communication', 'Clarity in writing, review, and discussion.'),
            competency('leadership', 'Leadership', 'Raising the effectiveness of others.'),
        ],
    },
    {
        name: 'Rent the Runway engineering ladder',
        companyName: 'Rent the Runway',
        attribution: "Summarized from Rent the Runway's published engineering ladder.",
        levels: ladder(['Engineer I', 'Engineer II', 'Senior Engineer', 'Staff Engineer', 'Principal Engineer']),
        competencies: [
            competency('technical_skills', 'Technical skills', 'Depth, breadth, and judgement.'),
            competency('execution', 'Execution', 'Shipping reliably at the expected scope.'),
            competency('leadership', 'Leadership', 'Influence, mentorship, and ownership.'),
            competency('communication', 'Communication', 'Written and verbal clarity across audiences.'),
            competency('process', 'Process', 'Improving how work happens.'),
        ],
    },
    {
        name: 'Generic IC ladder',
        companyName: null,
        attribution: 'A neutral five-level individual-contributor ladder.',
        levels: ladder(['IC1', 'IC2', 'IC3', 'IC4', 'IC5']),
        competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
    },
];

// ═══════════════════════════════════════════════════════════ persistence

function asShape(row: {
    name: string;
    companyName: string | null;
    levels: Prisma.JsonValue;
    competencies: Prisma.JsonValue;
}): FrameworkShape | null {
    const parsed = FrameworkShapeSchema.safeParse({
        name: row.name,
        companyName: row.companyName,
        levels: row.levels,
        competencies: row.competencies,
    });
    return parsed.success ? parsed.data : null;
}

const ATTRIBUTION_BY_NAME = new Map(
    PUBLIC_FRAMEWORK_TEMPLATES.map((template) => [template.name, template.attribution]),
);

function toView(row: {
    id: string;
    userId: string | null;
    name: string;
    sourceType: FrameworkSource;
    companyName: string | null;
    levels: Prisma.JsonValue;
    competencies: Prisma.JsonValue;
    isConfidential: boolean;
}): FrameworkView | null {
    const shape = asShape(row);
    if (!shape) return null;
    return {
        ...shape,
        id: row.id,
        userId: row.userId,
        sourceType: row.sourceType,
        isConfidential: row.isConfidential,
        attribution: row.sourceType === FrameworkSource.template
            ? ATTRIBUTION_BY_NAME.get(row.name) ?? null
            : null,
    };
}

/**
 * Idempotent. Safe to run on every deploy: matches on
 * `(userId: null, sourceType: template, name)` and refreshes the payload.
 */
export async function seedFrameworkTemplates(): Promise<number> {
    let written = 0;
    for (const template of PUBLIC_FRAMEWORK_TEMPLATES) {
        const existing = await prisma.competencyFramework.findFirst({
            where: { userId: null, sourceType: FrameworkSource.template, name: template.name },
            select: { id: true },
        });
        const data = {
            name: template.name,
            companyName: template.companyName,
            levels: template.levels as unknown as Prisma.InputJsonValue,
            competencies: template.competencies as unknown as Prisma.InputJsonValue,
            // A public ladder is public. Only uploaded rubrics are confidential.
            isConfidential: false,
        };
        if (existing) {
            await prisma.competencyFramework.update({ where: { id: existing.id }, data });
        } else {
            await prisma.competencyFramework.create({
                data: { ...data, userId: null, sourceType: FrameworkSource.template },
            });
        }
        written += 1;
    }
    return written;
}

let templatesEnsured = false;

/**
 * Self-heal the seed.
 *
 * `ensureFlagsSeeded` has no deploy hook calling it either, and an empty "use a
 * public ladder" list is a broken screen rather than a degraded one. Guarded
 * in-process and by a count, so the steady-state cost is one `count` per boot.
 */
export async function ensureTemplatesSeeded(): Promise<void> {
    if (templatesEnsured) return;
    templatesEnsured = true;
    try {
        const existing = await prisma.competencyFramework.count({
            where: { userId: null, sourceType: FrameworkSource.template },
        });
        if (existing < PUBLIC_FRAMEWORK_TEMPLATES.length) await seedFrameworkTemplates();
    } catch (error) {
        templatesEnsured = false;
        console.warn('[competency] template seed check failed', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** The user's own frameworks plus the system templates, user's first. */
export async function listFrameworks(params: { userId: string }): Promise<FrameworkView[]> {
    await ensureTemplatesSeeded();
    const rows = await prisma.competencyFramework.findMany({
        where: { OR: [{ userId: params.userId }, { userId: null }] },
        orderBy: [{ userId: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toView).filter((view): view is FrameworkView => view !== null);
}

/** Scoped read. A framework belonging to another user is `null`, not an error. */
export async function getFramework(params: {
    userId: string;
    frameworkId: string;
}): Promise<FrameworkView | null> {
    const row = await prisma.competencyFramework.findFirst({
        where: { id: params.frameworkId, OR: [{ userId: params.userId }, { userId: null }] },
    });
    return row ? toView(row) : null;
}

/**
 * The only write path for a user framework, and it is deliberately downstream of
 * the confirmation screen — nothing reaches the database until a human has read
 * the parse result (PRD 03 §10, "rubric parse produces garbage").
 */
export async function createFramework(params: {
    userId: string;
    shape: FrameworkShape;
    sourceType?: FrameworkSource;
    rawSourceRef?: string | null;
}): Promise<FrameworkView> {
    const row = await prisma.competencyFramework.create({
        data: {
            userId: params.userId,
            name: params.shape.name,
            sourceType: params.sourceType ?? FrameworkSource.uploaded,
            companyName: params.shape.companyName,
            levels: params.shape.levels as unknown as Prisma.InputJsonValue,
            competencies: params.shape.competencies as unknown as Prisma.InputJsonValue,
            rawSourceRef: params.rawSourceRef ?? null,
            // An internal leveling rubric is confidential by default (§4.1).
            isConfidential: true,
        },
    });
    return toView(row) as FrameworkView;
}

export async function deleteFramework(params: { userId: string; frameworkId: string }): Promise<boolean> {
    const result = await prisma.competencyFramework.deleteMany({
        where: { id: params.frameworkId, userId: params.userId },
    });
    return result.count > 0;
}

// ═══════════════════════════════════════════════════════════ rubric parsing

const ParsedFrameworkSchema = z.object({
    name: z.string().min(1).max(120),
    companyName: z.string().max(120).nullable(),
    levels: z
        .array(
            z.object({
                key: z.string().min(1).max(60),
                name: z.string().min(1).max(80),
                order: z.number().int().min(0).max(50),
                summary: z.string().max(400),
            }),
        )
        .min(1)
        .max(12),
    competencies: z
        .array(
            z.object({
                key: z.string().min(1).max(60),
                name: z.string().min(1).max(80),
                description: z.string().max(600),
                levelExpectations: z.record(z.string(), z.string().max(800)),
            }),
        )
        .min(1)
        .max(20),
});

export type FrameworkParseResult = {
    shape: FrameworkShape;
    /** True when the guard had to strip a field to keep the output honest. */
    degraded: boolean;
    costUsd: number;
};

const RUBRIC_PARSE_SYSTEM = [
    'You extract a company leveling framework from a document into structured data.',
    '',
    'Rules:',
    '- Extract only what the document states. Never invent a level or a competency.',
    '- `levels` are the rungs of the ladder, ordered lowest first, `order` starting at 0.',
    '- `competencies` are the dimensions people are assessed on, not the levels.',
    '- `key` is a lowercase snake_case slug derived from the name.',
    '- `levelExpectations` maps a level `key` to what the document says that competency',
    '  looks like at that level. Omit a level rather than paraphrasing something absent.',
    '- If the document is not a leveling framework, return the single best-effort reading',
    '  you can and keep every field short; the user confirms the result before it is used.',
].join('\n');

/**
 * Parse a pasted / uploaded rubric into a framework **draft**. Writes nothing.
 *
 * Model task: `packetMap` — the mid-tier, schema-constrained key. There is no
 * dedicated `rubricParse` key in the task map and `src/lib/ai/**` is owned
 * elsewhere; `packetMap` is the correct tier for constrained extraction and
 * keeps the cost line grouped with the rest of the packet feature.
 */
export async function parseFrameworkText(params: {
    userId: string;
    text: string;
    companyName?: string | null;
}): Promise<FrameworkParseResult> {
    const text = params.text.trim().slice(0, 60_000);

    const result = await generateStructured({
        task: 'packetMap',
        feature: 'review_packet',
        userId: params.userId,
        schema: ParsedFrameworkSchema,
        system: RUBRIC_PARSE_SYSTEM,
        prompt: [
            params.companyName ? `Company: ${params.companyName}` : 'Company: unknown',
            '',
            'Document:',
            text,
        ].join('\n'),
        guard: {
            // Level names are routinely numeric ("L5", "E4"); the source text is
            // the document itself, so any figure we emit has to come from it.
            sourceText: text,
            fields: ['levels', 'competencies'],
        },
    });

    const shape = FrameworkShapeSchema.parse({
        name: result.data.name,
        companyName: params.companyName ?? result.data.companyName,
        levels: normalizeLevelOrder(result.data.levels),
        competencies: dedupeByKey(result.data.competencies),
    });

    return { shape, degraded: result.degraded, costUsd: result.usage.costUsd };
}

function normalizeLevelOrder(levels: FrameworkLevel[]): FrameworkLevel[] {
    return dedupeByKey(levels)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((level, index) => ({ ...level, order: index }));
}

function dedupeByKey<T extends { key: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        const key = slug(item.key);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...item, key });
    }
    return out;
}

export function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
}

// ═══════════════════════════════════════════════════════════ the mapping

export type MappingStrength = 'strong' | 'supporting';

export type WinCompetencyMapping = {
    winId: string;
    competencyKey: string;
    strength: MappingStrength;
};

/** The weights in PRD 03 §4.2. */
export const STRENGTH_WEIGHT: Record<MappingStrength, number> = {
    strong: 1.0,
    supporting: 0.4,
};

/**
 * PRD 03 §4.2 deterministic priors: the win taxonomy seeds the mapping so it
 * stays stable across regenerations, and the model only refines it.
 *
 * Expressed against the Patronus default keys; {@link resolvePriorKeys} maps
 * them onto an arbitrary framework's vocabulary.
 */
export const CATEGORY_PRIORS: Record<WinCategory, { key: DefaultCompetencyKey; strength: MappingStrength }[]> = {
    [WinCategory.shipped]: [
        { key: 'execution', strength: 'strong' },
        { key: 'technical_depth', strength: 'supporting' },
    ],
    [WinCategory.improved]: [
        { key: 'technical_depth', strength: 'strong' },
        { key: 'execution', strength: 'supporting' },
    ],
    [WinCategory.fixed]: [
        { key: 'execution', strength: 'strong' },
        { key: 'technical_depth', strength: 'supporting' },
    ],
    [WinCategory.led]: [
        { key: 'scope_ambiguity', strength: 'strong' },
        { key: 'influence', strength: 'supporting' },
    ],
    [WinCategory.influenced]: [
        { key: 'influence', strength: 'strong' },
        { key: 'communication', strength: 'supporting' },
    ],
    [WinCategory.grew]: [
        { key: 'mentorship', strength: 'strong' },
        { key: 'influence', strength: 'supporting' },
    ],
    [WinCategory.learned]: [{ key: 'technical_depth', strength: 'supporting' }],
    [WinCategory.saved]: [
        { key: 'execution', strength: 'strong' },
        { key: 'scope_ambiguity', strength: 'supporting' },
    ],
};

/**
 * Synonyms that let the default-key priors land on a real company ladder. A
 * Google "Impact" column and a Patronus "Execution" column are the same idea
 * wearing different clothes, and refusing to connect them would leave every
 * uploaded rubric with no deterministic floor at all.
 */
const PRIOR_SYNONYMS: Record<DefaultCompetencyKey, string[]> = {
    execution: ['execution', 'impact', 'results', 'delivery', 'getting stuff done', 'project impact', 'ownership'],
    technical_depth: ['technical', 'craft', 'engineering excellence', 'technical ability', 'technical skill', 'quality', 'depth'],
    scope_ambiguity: ['scope', 'ambiguity', 'direction', 'strategy', 'problem selection', 'autonomy'],
    influence: ['influence', 'leadership', 'collaboration', 'cross-functional', 'alignment'],
    communication: ['communication', 'writing', 'documentation', 'presentation'],
    mentorship: ['mentor', 'people', 'talent', 'coaching', 'growing', 'teaching', 'culture'],
};

/**
 * Which of `competencies` a default-key prior should attach to. Returns at most
 * one key: a prior that matches three columns is not a prior, it is noise.
 */
export function resolvePriorKey(
    competencies: readonly FrameworkCompetency[],
    priorKey: DefaultCompetencyKey,
): string | null {
    const needles = PRIOR_SYNONYMS[priorKey];
    let best: { key: string; score: number } | null = null;

    for (const item of competencies) {
        const haystack = `${item.key} ${item.name}`.toLowerCase().replace(/_/g, ' ');
        for (let index = 0; index < needles.length; index += 1) {
            if (!haystack.includes(needles[index])) continue;
            // Earlier synonyms are stronger signals than later ones.
            const score = needles.length - index;
            if (!best || score > best.score) best = { key: item.key, score };
            break;
        }
    }

    return best?.key ?? null;
}

export type PriorWin = { id: string; category: WinCategory };

/** The deterministic floor: a mapping that exists with no model call at all. */
export function priorMappings(
    wins: readonly PriorWin[],
    competencies: readonly FrameworkCompetency[],
): WinCompetencyMapping[] {
    const resolved = new Map<DefaultCompetencyKey, string | null>();
    for (const key of DEFAULT_COMPETENCY_KEYS) {
        resolved.set(key, resolvePriorKey(competencies, key));
    }

    const out: WinCompetencyMapping[] = [];
    for (const win of wins) {
        for (const prior of CATEGORY_PRIORS[win.category] ?? []) {
            const competencyKey = resolved.get(prior.key);
            if (!competencyKey) continue;
            out.push({ winId: win.id, competencyKey, strength: prior.strength });
        }
    }
    return dedupeMappings(out);
}

/** At most 2 competencies per win (§4.2), strongest kept. */
export function dedupeMappings(mappings: readonly WinCompetencyMapping[]): WinCompetencyMapping[] {
    const byWin = new Map<string, Map<string, MappingStrength>>();
    for (const mapping of mappings) {
        const bucket = byWin.get(mapping.winId) ?? new Map<string, MappingStrength>();
        const existing = bucket.get(mapping.competencyKey);
        if (!existing || (existing === 'supporting' && mapping.strength === 'strong')) {
            bucket.set(mapping.competencyKey, mapping.strength);
        }
        byWin.set(mapping.winId, bucket);
    }

    const out: WinCompetencyMapping[] = [];
    for (const [winId, bucket] of byWin) {
        const entries = [...bucket.entries()].sort(
            (a, b) => STRENGTH_WEIGHT[b[1]] - STRENGTH_WEIGHT[a[1]],
        );
        for (const [competencyKey, strength] of entries.slice(0, 2)) {
            out.push({ winId, competencyKey, strength });
        }
    }
    return out;
}

// ═══════════════════════════════════════════════════════════ the verdicts

export type Verdict = 'strong' | 'adequate' | 'thin' | 'absent';

/** PRD 03 §4.2. Tunable; env-overridable so a calibration change is a deploy. */
export const VERDICT_THRESHOLDS = {
    strong: numberFromEnv('COMPETENCY_STRONG_THRESHOLD', 3.0),
    adequate: numberFromEnv('COMPETENCY_ADEQUATE_THRESHOLD', 1.5),
    evidenceForStrong: numberFromEnv('COMPETENCY_STRONG_EVIDENCE_SHARE', 0.5),
} as const;

function numberFromEnv(key: string, fallback: number): number {
    const raw = Number(process.env[key]);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export type AssessmentWin = {
    id: string;
    title: string;
    occurredAt: Date;
    /** True when the Win carries an `ImpactMetric`. */
    quantified: boolean;
};

export type CompetencyAssessment = {
    key: string;
    name: string;
    /** Number of wins mapped to this competency. */
    coverage: number;
    /** Weighted: strong = 1.0, supporting = 0.4. */
    strength: number;
    /** Share of mapped wins that carry a metric, 0–1. */
    evidenceShare: number;
    quantifiedCount: number;
    verdict: Verdict;
    /** Mapped win ids, most recent first. */
    winIds: string[];
    /** One sentence, citing real wins. Never flattering. */
    rationale: string;
    /** Filled dots out of five, for `StatTile variant="verdict"`. */
    dots: number;
};

export function verdictFor(strength: number, evidenceShare: number): Verdict {
    if (strength <= 0) return 'absent';
    if (strength >= VERDICT_THRESHOLDS.strong && evidenceShare >= VERDICT_THRESHOLDS.evidenceForStrong) {
        return 'strong';
    }
    if (strength >= VERDICT_THRESHOLDS.adequate) return 'adequate';
    return 'thin';
}

const VERDICT_DOTS: Record<Verdict, number> = { strong: 5, adequate: 3, thin: 1, absent: 0 };

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The honest read, per competency. Deterministic on purpose: the tone rule in
 * §4.3 is a product constraint, and a template that cites real counts cannot
 * drift into flattery between one generation and the next.
 */
function rationaleFor(
    verdict: Verdict,
    name: string,
    coverage: number,
    quantifiedCount: number,
    exampleTitle: string | null,
): string {
    switch (verdict) {
        case 'absent':
            return `No evidence logged for ${name.toLowerCase()} in this period.`;
        case 'thin':
            return exampleTitle
                ? `${plural(coverage, 'win')} in this period — ${exampleTitle}. That is thin for a case built on ${name.toLowerCase()}.`
                : `${plural(coverage, 'win')} in this period. That is thin.`;
        case 'adequate':
            return quantifiedCount > 0
                ? `${plural(coverage, 'win')}, ${quantifiedCount} quantified. Present, not yet decisive.`
                : `${plural(coverage, 'win')}, none quantified. Present, but hard to argue without numbers.`;
        case 'strong':
            return `${plural(coverage, 'win')}, ${quantifiedCount} quantified.`;
    }
}

export function assessCompetencies(params: {
    competencies: readonly FrameworkCompetency[];
    mappings: readonly WinCompetencyMapping[];
    wins: readonly AssessmentWin[];
}): CompetencyAssessment[] {
    const winById = new Map(params.wins.map((win) => [win.id, win]));
    const valid = params.mappings.filter((mapping) => winById.has(mapping.winId));

    return params.competencies.map((competency) => {
        const mine = valid.filter((mapping) => mapping.competencyKey === competency.key);
        const mineWins = mine
            .map((mapping) => winById.get(mapping.winId))
            .filter((win): win is AssessmentWin => win !== undefined)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

        const coverage = mineWins.length;
        const strength = mine.reduce((total, mapping) => total + STRENGTH_WEIGHT[mapping.strength], 0);
        const quantifiedCount = mineWins.filter((win) => win.quantified).length;
        const evidenceShare = coverage === 0 ? 0 : quantifiedCount / coverage;
        const verdict = verdictFor(strength, evidenceShare);

        return {
            key: competency.key,
            name: competency.name,
            coverage,
            strength: Math.round(strength * 100) / 100,
            evidenceShare: Math.round(evidenceShare * 100) / 100,
            quantifiedCount,
            verdict,
            winIds: mineWins.map((win) => win.id),
            rationale: rationaleFor(
                verdict,
                competency.name,
                coverage,
                quantifiedCount,
                mineWins[0]?.title ?? null,
            ),
            dots: VERDICT_DOTS[verdict],
        };
    });
}

// ═══════════════════════════════════════════════════════ the AI refinement

const MappingResponseSchema = z.object({
    mappings: z
        .array(
            z.object({
                winId: z.string().min(1).max(64),
                competencyKey: z.string().min(1).max(60),
                strength: z.enum(['strong', 'supporting']),
            }),
        )
        .max(400),
});

const MAPPING_SYSTEM = [
    'You map a person\'s logged work onto their company\'s competency framework.',
    '',
    'Rules, in priority order:',
    '1. Under-claiming is CORRECT. Over-claiming is a failure. If a win does not clearly',
    '   demonstrate a competency, do not map it. A competency with no evidence must end up',
    '   with no mappings — that is a useful, honest answer, not a gap in your work.',
    '2. Assign 0, 1 or 2 competencies per win. Never more than 2.',
    '3. `strong` means the win is direct evidence of that competency. `supporting` means it',
    '   is adjacent — it helps, but nobody would cite it as the proof.',
    '4. Use only the exact `competencyKey` values supplied. Use only the exact `winId` values supplied.',
    '5. Do not invent, restate, or summarize the wins. Return mappings only.',
].join('\n');

export type MappingResult = {
    mappings: WinCompetencyMapping[];
    /** True when the model call failed and the deterministic priors stand alone. */
    fellBack: boolean;
    costUsd: number;
};

export type MappableWin = PriorWin & {
    title: string;
    narrative: string;
    occurredAt: Date;
    metric: string | null;
};

/**
 * Priors first, then the model refines. If the model call fails or returns
 * nothing usable, the priors stand on their own — a mapping always exists.
 */
export async function mapWinsToCompetencies(params: {
    userId: string;
    wins: readonly MappableWin[];
    competencies: readonly FrameworkCompetency[];
    targetLevel?: { key: string; name: string } | null;
    sessionId?: string;
}): Promise<MappingResult> {
    const priors = priorMappings(params.wins, params.competencies);
    if (params.wins.length === 0 || params.competencies.length === 0) {
        return { mappings: priors, fellBack: false, costUsd: 0 };
    }

    const validWinIds = new Set(params.wins.map((win) => win.id));
    const validKeys = new Set(params.competencies.map((item) => item.key));

    const competencyBlock = params.competencies
        .map((item) => {
            const expectation = params.targetLevel
                ? item.levelExpectations[params.targetLevel.key]
                : undefined;
            return [
                `- ${item.key}: ${item.name}`,
                item.description ? `  ${item.description}` : null,
                expectation ? `  At ${params.targetLevel?.name}: ${expectation}` : null,
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n');

    const winBlock = params.wins
        .map((win) =>
            [
                `- id: ${win.id}`,
                `  category: ${win.category}`,
                `  title: ${win.title}`,
                win.narrative ? `  detail: ${win.narrative.slice(0, 400)}` : null,
                win.metric ? `  metric: ${win.metric}` : null,
            ]
                .filter(Boolean)
                .join('\n'),
        )
        .join('\n');

    try {
        const result = await generateStructured({
            task: 'packetMap',
            feature: 'review_packet',
            userId: params.userId,
            sessionId: params.sessionId,
            schema: MappingResponseSchema,
            system: MAPPING_SYSTEM,
            prompt: [
                params.targetLevel
                    ? `Target level: ${params.targetLevel.name}`
                    : 'Target level: the person\'s current level',
                '',
                'Competencies:',
                competencyBlock,
                '',
                'Wins:',
                winBlock,
            ].join('\n'),
        });

        const refined = result.data.mappings.filter(
            (mapping) => validWinIds.has(mapping.winId) && validKeys.has(mapping.competencyKey),
        );

        // The model output replaces the priors for wins it actually addressed and
        // the priors cover the rest. Refinement, not override: a win the model
        // declined to map keeps its deterministic floor only if the model said
        // nothing about it at all.
        const addressed = new Set(refined.map((mapping) => mapping.winId));
        const merged = [
            ...refined,
            ...priors.filter((mapping) => !addressed.has(mapping.winId)),
        ];

        return { mappings: dedupeMappings(merged), fellBack: false, costUsd: result.usage.costUsd };
    } catch (error) {
        console.warn('[competency] mapWinsToCompetencies fell back to priors', {
            error: error instanceof Error ? error.message : String(error),
        });
        return { mappings: priors, fellBack: true, costUsd: 0 };
    }
}

// ═══════════════════════════════════════════════════════════ level helpers

/**
 * PRD 03 §10: "user's target level doesn't exist in the framework" — validate at
 * scope time and offer the nearest level rather than silently generating against
 * something that is not in the ladder.
 */
export function resolveTargetLevel(
    levels: readonly FrameworkLevel[],
    requested: string | null | undefined,
): { level: FrameworkLevel | null; substituted: boolean } {
    if (!requested) return { level: null, substituted: false };
    const wanted = requested.trim().toLowerCase();

    const exact = levels.find(
        (level) => level.key.toLowerCase() === wanted || level.name.toLowerCase() === wanted,
    );
    if (exact) return { level: exact, substituted: false };

    const partial = levels.find(
        (level) => level.name.toLowerCase().includes(wanted) || wanted.includes(level.name.toLowerCase()),
    );
    if (partial) return { level: partial, substituted: true };

    return { level: null, substituted: true };
}
