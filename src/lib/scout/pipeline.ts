/**
 * The Scout run, as one ordered definition (docs/impl/06-scout-agent.md §3).
 *
 * The ordering lives in `stages.ts` (sandbox-safe); this file is the side
 * that touches the database. `runScoutStages` is driven two ways: the workflow in
 * `src/workflows/scoutRun.ts` passes durable `'use step'` wrappers so a crash
 * resumes at the section that failed, and local development passes the plain
 * functions below, because `start()` has no runner outside Vercel (see
 * `src/actions/packets.ts` for the incident behind that rule).
 *
 * The pipeline is re-entrant. A section already stored `ok` is not re-run
 * (`runStep` guarantee 4), so resuming after an answer, or a retried workflow,
 * walks the same plan and pays only for what is missing.
 */

import {
    finishRun,
    loadRun,
    markRunning,
    pauseForInput,
    readAnswers,
    readSections,
    runStep,
    RunAbortedError,
    setRunKind,
    type StoredSection,
} from '@/lib/agent/run';
import { SCOUT_SECTION_IMPLS, SCOUT_SECTION_OPTIONS } from '@/lib/scout/sections';
import type { StageDriver } from '@/lib/scout/stages';
import type { ScoutInput, ScoutKind, ScoutSectionName, ScoutSections } from '@/lib/scout/types';

/** Run one section of one run. Plain function; wrapped as a step in prod. */
export async function runScoutSection(runId: string, name: ScoutSectionName): Promise<StoredSection> {
    const run = await loadRun(runId);
    if (!run) throw new RunAbortedError(`run ${runId} not found`);
    const impl = SCOUT_SECTION_IMPLS[name] as (typeof SCOUT_SECTION_IMPLS)['ingest'];
    const options = SCOUT_SECTION_OPTIONS[name];

    return runStep(
        runId,
        name,
        async (step) => {
            // Re-read inside the step: a concurrent section may have finished
            // since the outer load, and the answers may have changed.
            const fresh = (await loadRun(runId)) ?? run;
            return impl({
                runId,
                userId: run.userId,
                input: fresh.input as unknown as ScoutInput,
                answers: readAnswers(fresh),
                sections: readSections(fresh) as ScoutSections,
                step,
            }) as never;
        },
        { ...options, feature: name === 'network' ? 'outreach' : 'scout' },
    );
}

export async function beginScoutRun(runId: string): Promise<void> {
    await markRunning(runId);
}

/**
 * Settle the run. If any section asked a question, the run pauses on the
 * first one; the rest of the analysis is already stored and visible.
 */
export async function finishScoutRun(runId: string, error: string | null): Promise<void> {
    const run = await loadRun(runId);
    if (run && !error) {
        const asking = Object.values(readSections(run)).find((section) => section.status === 'needs_input');
        if (asking && asking.status === 'needs_input') await pauseForInput(runId, asking.question);
    }
    await finishRun(runId, error);
    const { notifyScoutRun } = await import('@/lib/scout/notify');
    await notifyScoutRun(runId, 'finished').catch((notifyError: unknown) => {
        console.warn('[scout] finish notification failed', { runId, error: String(notifyError) });
    });
}

export async function progressScoutRun(runId: string): Promise<void> {
    const { notifyScoutRun } = await import('@/lib/scout/notify');
    await notifyScoutRun(runId, 'progress').catch(() => undefined);
}

export async function setScoutKind(runId: string, kind: ScoutKind): Promise<void> {
    await setRunKind(runId, kind);
}

/** Local development: the same stages, in-process. */
export const INLINE_DRIVER: StageDriver = {
    begin: beginScoutRun,
    runSection: runScoutSection,
    setKind: setScoutKind,
    progress: progressScoutRun,
    finish: finishScoutRun,
};
