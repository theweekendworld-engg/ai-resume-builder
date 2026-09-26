/**
 * Which sections run for which kind of input. Code owns the plan
 * (docs/impl/06-scout-agent.md §2 rule 1): the model classifies, and this
 * table — not the model — decides what that classification costs.
 */

import type { ScoutKind, ScoutSectionName } from '@/lib/scout/types';

/** Always first, in order. Both are critical: nothing runs without them. */
export const PREAMBLE: ScoutSectionName[] = ['ingest', 'classify'];

/**
 * After the preamble. Each inner array is a stage; sections within a stage run
 * concurrently, stages run in order. `jd` is its own stage because fit, comp,
 * interviews and network all read the role it extracts.
 */
export const STAGES_BY_KIND: Record<ScoutKind, ScoutSectionName[][]> = {
    // `track` runs last so the tracker row carries the fit verdict and score.
    job_posting: [['jd'], ['fit', 'company', 'comp', 'interviews', 'network', 'talent'], ['track']],
    hiring_post: [['jd'], ['fit', 'company', 'comp', 'interviews', 'network', 'talent'], ['track']],
    company_signal: [['company', 'openings']],
    knowledge: [['digest']],
    work_note: [['capture']],
    other: [],
};

export function planFor(kind: ScoutKind | null): ScoutSectionName[] {
    if (!kind) return [...PREAMBLE];
    return [...PREAMBLE, ...STAGES_BY_KIND[kind].flat()];
}
