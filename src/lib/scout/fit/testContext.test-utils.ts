import { SourceSet } from '@/lib/agent/sources';
import type { StepContext, StoredSection } from '@/lib/agent/run';
import type { SectionContext } from '@/lib/scout/section';
import type { ScoutSectionData, ScoutSectionName, ScoutSections } from '@/lib/scout/types';

/** A stored `ok` section, for seeding `ctx.sections`. */
export function okSection<K extends ScoutSectionName>(data: ScoutSectionData[K]): StoredSection<ScoutSectionData[K]> {
    return { status: 'ok', data, sources: [], finishedAt: new Date().toISOString() };
}

/** A section context with no database and a scriptable `ai`. */
export function fakeContext(params: {
    userId?: string;
    sections?: ScoutSections;
    answers?: Record<string, string>;
    ai?: StepContext['ai'];
}): SectionContext & { costs: number[] } {
    const costs: number[] = [];
    const step: StepContext = {
        runId: 'run-test',
        userId: params.userId ?? 'user-test',
        stepName: 'test',
        sources: new SourceSet(),
        signal: new AbortController().signal,
        ai: params.ai ?? (async () => {
            throw new Error('no model in this test');
        }),
        addCost: (usd) => {
            costs.push(usd);
        },
        log: () => undefined,
    };
    return {
        runId: 'run-test',
        userId: step.userId,
        input: { url: 'https://www.linkedin.com/jobs/view/123456789', source: 'dashboard' },
        answers: params.answers ?? {},
        sections: params.sections ?? {},
        step,
        costs,
    };
}
