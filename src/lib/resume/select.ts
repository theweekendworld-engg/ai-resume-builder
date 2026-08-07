/**
 * Choosing what earns space on the page.
 *
 * This is the step the old pipeline did not have, and its absence is why the
 * 7 Aug audit resume dropped "Mentored 3 engineers; two were promoted" from an
 * application whose posting said, in as many words, "Mentor engineers and raise
 * the technical bar".
 *
 * ── What went wrong before ──────────────────────────────────────────────────
 *
 * One model call rewrote the whole document, then hard caps truncated whatever
 * came back: four bullets per role, four roles. A role with five good bullets
 * lost one, and which one it lost was decided by nothing — array order and the
 * model's mood. Relevance existed, but it was computed per ROLE, so within a
 * role every bullet looked identical to the system.
 *
 * ── What a person does instead ──────────────────────────────────────────────
 *
 * They read the posting, then go through their own history line by line asking
 * "does this answer something they asked for?". A merely impressive bullet
 * loses to a less impressive one that answers a stated requirement, because the
 * resume's job is to answer the posting.
 *
 * That is exactly what {@link selectBullets} does, and the ordering of its two
 * passes is the whole point: cover the must-haves first, then spend what is
 * left on strength. It is a greedy set cover, and greedy is the right amount of
 * clever here — the caps are small, and a person doing this by hand is also
 * greedy.
 *
 * The scoring is a model call; the selection is pure and tested without one.
 */

import { z } from 'zod';

import { generateStructured } from '@/lib/ai/structured';
import type { JobRequirement, PostingBrief } from './posting';

// ─────────────────────────────────────────────────────────── types

/** One line of the candidate's own history, before anything is rewritten. */
export type SourceBullet = {
    /** Stable across the run — `e1:2` is the third bullet of the first role. */
    id: string;
    /** The role or project it belongs to. */
    groupId: string;
    text: string;
};

export type ScoredBullet = SourceBullet & {
    /** Requirement ids this bullet answers. Empty is normal and fine. */
    answers: string[];
    /**
     * 0–5, how strong this line is ON ITS OWN — concrete, quantified, senior.
     * Deliberately independent of relevance: relevance is expressed by
     * `answers`, and keeping them apart is what lets selection trade one off
     * against the other rather than collapsing both into a single number.
     */
    strength: number;
};

export type SelectionCaps = {
    maxPerGroup: number;
    maxGroups: number;
};

export type Selection = {
    kept: ScoredBullet[];
    /** Dropped, with the reason — surfaced in the editor, never silent. */
    dropped: Array<{ bullet: ScoredBullet; reason: 'cap' | 'weak' }>;
    /** Requirement ids no kept bullet answers. This becomes the gap report. */
    uncovered: string[];
};

/** Below this a bullet is filler even if nothing better exists. */
export const MIN_STRENGTH = 2;

// ─────────────────────────────────────────────────────────── the selection

/**
 * Pick the bullets, per group, under the caps.
 *
 * Two passes, in this order and for this reason:
 *
 *   1. COVER. Walk the must-have requirements in the posting's own emphasis
 *      order. For each, take the strongest unclaimed bullet that answers it.
 *      This is the pass that saves the mentoring bullet — it is not the
 *      strongest line on the page, but it is the only one answering a stated
 *      must, so it is taken before anything competes for the slot.
 *
 *   2. FILL. Spend the remaining slots on raw strength.
 *
 * Ties break on `id` so the same input always produces the same resume. A
 * candidate who regenerates and gets a different document twice stops trusting
 * the tool, and that matters more than any marginal gain from a smarter rule.
 */
export function selectBullets(
    bullets: readonly ScoredBullet[],
    requirements: readonly JobRequirement[],
    caps: SelectionCaps,
): Selection {
    const byStrength = (a: ScoredBullet, b: ScoredBullet) =>
        b.strength - a.strength || a.id.localeCompare(b.id);

    const eligible = bullets.filter((bullet) => bullet.strength >= MIN_STRENGTH);
    const weak = bullets.filter((bullet) => bullet.strength < MIN_STRENGTH);

    // Which groups make the page at all. A group earns its place by the
    // strength of its best two bullets rather than its single best, so one
    // lucky line cannot carry an otherwise empty role onto the resume.
    const groupScore = new Map<string, number>();
    for (const bullet of eligible) {
        const top = [...eligible.filter((b) => b.groupId === bullet.groupId)]
            .sort(byStrength)
            .slice(0, 2)
            .reduce((sum, b) => sum + b.strength, 0);
        groupScore.set(bullet.groupId, top);
    }
    const groups = [...groupScore.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, caps.maxGroups)
        .map(([id]) => id);
    const groupSet = new Set(groups);

    const claimed = new Set<string>();
    const perGroup = new Map<string, number>();
    const room = (groupId: string) => (perGroup.get(groupId) ?? 0) < caps.maxPerGroup;
    const take = (bullet: ScoredBullet) => {
        claimed.add(bullet.id);
        perGroup.set(bullet.groupId, (perGroup.get(bullet.groupId) ?? 0) + 1);
    };

    const inPlay = eligible.filter((bullet) => groupSet.has(bullet.groupId)).sort(byStrength);

    // ── pass 1: cover the must-haves
    const musts = requirements.filter((requirement) => requirement.kind === 'must');
    for (const requirement of musts) {
        const alreadyCovered = inPlay.some(
            (bullet) => claimed.has(bullet.id) && bullet.answers.includes(requirement.id),
        );
        if (alreadyCovered) continue;

        const candidate = inPlay.find(
            (bullet) =>
                !claimed.has(bullet.id) &&
                bullet.answers.includes(requirement.id) &&
                room(bullet.groupId),
        );
        if (candidate) take(candidate);
    }

    // ── pass 2: fill on strength
    for (const bullet of inPlay) {
        if (claimed.has(bullet.id)) continue;
        if (!room(bullet.groupId)) continue;
        take(bullet);
    }

    const kept = inPlay.filter((bullet) => claimed.has(bullet.id));

    const dropped: Selection['dropped'] = [
        ...weak.map((bullet) => ({ bullet, reason: 'weak' as const })),
        ...eligible
            .filter((bullet) => !claimed.has(bullet.id))
            .map((bullet) => ({ bullet, reason: 'cap' as const })),
    ];

    const covered = new Set(kept.flatMap((bullet) => bullet.answers));
    const uncovered = requirements
        .filter((requirement) => !covered.has(requirement.id))
        .map((requirement) => requirement.id);

    return { kept, dropped, uncovered };
}

/** Kept bullets for one group, strongest first. */
export function keptForGroup(selection: Selection, groupId: string): ScoredBullet[] {
    return selection.kept
        .filter((bullet) => bullet.groupId === groupId)
        .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}

/** Groups that kept at least one bullet, in the order they should appear. */
export function keptGroups(selection: Selection): string[] {
    const order: string[] = [];
    for (const bullet of selection.kept) {
        if (!order.includes(bullet.groupId)) order.push(bullet.groupId);
    }
    return order;
}

// ─────────────────────────────────────────────────────────── the scoring call

/** No defaults — see the note on BriefSchema in posting.ts. */
const ScoreSchema = z.object({
    bullets: z.array(
        z.object({
            id: z.string(),
            answers: z.array(z.string()),
            strength: z.number().min(0).max(5),
        }),
    ),
});

const SYSTEM = `You judge resume bullets against a specific job posting. You are strict and you never invent. You are assessing lines the candidate has already written; you are not rewriting them.`;

function formatRequirements(requirements: readonly JobRequirement[]): string {
    return requirements
        .map((r) => `${r.id} [${r.kind}/${r.category}] ${r.text}`)
        .join('\n');
}

/**
 * Score every bullet against the posting.
 *
 * One call for all bullets rather than one per bullet: the model needs to see
 * the whole history to calibrate strength — a "1.2M orders/day" line only reads
 * as a 5 next to the candidate's other work. But unlike the old pipeline this
 * call does exactly ONE job and returns numbers, not prose, so there is no
 * document being written under a word limit while ten other decisions compete
 * for attention.
 */
export async function scoreBullets(params: {
    bullets: readonly SourceBullet[];
    brief: PostingBrief;
    userId: string;
    sessionId?: string;
}): Promise<ScoredBullet[]> {
    if (params.bullets.length === 0) return [];

    const prompt = `A candidate is applying for: ${params.brief.role}${
        params.brief.company ? ` at ${params.brief.company}` : ''
    }${params.brief.seniority ? ` (${params.brief.seniority})` : ''}.

WHAT THE POSTING ASKS FOR:
${formatRequirements(params.brief.requirements)}

THE CANDIDATE'S OWN LINES:
${params.bullets.map((b) => `${b.id} | ${b.text}`).join('\n')}

For each line, return:

"answers" — the ids of requirements this line genuinely evidences. Be strict.
  A line answers a requirement only if a reader would accept it as proof.
  "Led the migration of 9 services to Kubernetes" answers a Kubernetes
  requirement. It does not answer a Terraform requirement because both are
  infrastructure. Most lines answer zero or one. An empty list is a normal,
  correct answer.

"strength" — 0-5, how strong the line is on its own terms, IGNORING this job:
  5  a specific, quantified outcome with clear scope ("cut p95 4.2s → 900ms")
  4  a concrete achievement with scale or a named result
  3  a real accomplishment, no numbers
  2  a duty described as an accomplishment ("responsible for the billing service")
  1  vague or generic ("worked on various projects")
  0  not an achievement at all

Judge every line. Return one entry per id, using the id exactly as given.`;

    const { data } = await generateStructured({
        task: 'bulletSelect',
        feature: 'resume',
        userId: params.userId,
        sessionId: params.sessionId,
        schema: ScoreSchema,
        system: SYSTEM,
        prompt,
    });

    const scored = new Map(data.bullets.map((entry) => [entry.id, entry]));
    const validRequirements = new Set(params.brief.requirements.map((r) => r.id));

    return params.bullets.map((bullet) => {
        const entry = scored.get(bullet.id);
        return {
            ...bullet,
            // A hallucinated requirement id would silently create phantom
            // coverage and hide a real gap, so unknown ids are dropped.
            answers: (entry?.answers ?? []).filter((id) => validRequirements.has(id)),
            // A bullet the model forgot to score is not thereby filler. Default
            // to the "real accomplishment, no numbers" tier so an omission
            // costs a place in the ordering, never the candidate's line.
            strength: entry ? Math.round(entry.strength) : 3,
        };
    });
}
