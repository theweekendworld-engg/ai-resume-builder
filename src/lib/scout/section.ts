/**
 * What a Scout section is: a function from context to outcome.
 *
 * Sections are pure with respect to the run — they read `ctx.sections`
 * (earlier results) and return data; the harness in `src/lib/agent/run.ts`
 * records the step, merges the result and charges the cost. A section never
 * writes to `AgentRun` itself, and it talks to models only through `ctx.step.ai`.
 */

import type { StepContext, StepOutcome } from '@/lib/agent/run';
import type { ScoutInput, ScoutSectionData, ScoutSectionName, ScoutSections } from '@/lib/scout/types';

export type SectionContext = {
    runId: string;
    userId: string;
    input: ScoutInput;
    /** Answers to questions this run asked, keyed by question id. */
    answers: Record<string, string>;
    /** Everything stored so far. Read the `data` of `ok` sections only. */
    sections: ScoutSections;
    step: StepContext;
};

export type ScoutSection<K extends ScoutSectionName> = (
    ctx: SectionContext,
) => Promise<StepOutcome<ScoutSectionData[K]>>;

/** Data of an earlier section, or null if it did not produce any. */
export function dataOf<K extends ScoutSectionName>(
    sections: ScoutSections,
    name: K,
): ScoutSectionData[K] | null {
    const stored = sections[name];
    if (!stored) return null;
    if (stored.status === 'ok') return stored.data as ScoutSectionData[K];
    if ((stored.status === 'unavailable' || stored.status === 'needs_input') && stored.data) {
        return stored.data as ScoutSectionData[K];
    }
    return null;
}
