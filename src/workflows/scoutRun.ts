import { runScoutStages } from '@/lib/scout/stages';
import {
    scoutBeginStep,
    scoutFinishStep,
    scoutProgressStep,
    scoutSectionStep,
    scoutSetKindStep,
} from '@/workflows/steps/scout';

/**
 * Scout run (docs/impl/06-scout-agent.md). User-watched and minutes long at
 * worst, so it belongs to the workflow SDK rather than the daily job queue.
 * The ordering is `runScoutStages`, shared with local development.
 */
export async function handleScoutRunWorkflow(runId: string) {
    'use workflow';

    await runScoutStages(runId, {
        begin: scoutBeginStep,
        runSection: scoutSectionStep,
        setKind: scoutSetKindStep,
        progress: scoutProgressStep,
        finish: scoutFinishStep,
    });
}
