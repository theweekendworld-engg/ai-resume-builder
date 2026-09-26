import type { StoredSection } from '@/lib/agent/run';
import {
    beginScoutRun,
    finishScoutRun,
    progressScoutRun,
    runScoutSection,
    setScoutKind,
} from '@/lib/scout/pipeline';
import type { ScoutKind, ScoutSectionName } from '@/lib/scout/types';

/**
 * Durable wrappers for the Scout driver. Each section is its own step, so a
 * crash after `company` resumes at `comp`, and `runStep` skips sections
 * already stored `ok` even if the runtime replays one.
 */

export async function scoutBeginStep(runId: string): Promise<void> {
    'use step';
    await beginScoutRun(runId);
}

export async function scoutSectionStep(runId: string, name: ScoutSectionName): Promise<StoredSection> {
    'use step';
    return runScoutSection(runId, name);
}

export async function scoutSetKindStep(runId: string, kind: ScoutKind): Promise<void> {
    'use step';
    await setScoutKind(runId, kind);
}

export async function scoutProgressStep(runId: string): Promise<void> {
    'use step';
    await progressScoutRun(runId);
}

export async function scoutFinishStep(runId: string, error: string | null): Promise<void> {
    'use step';
    await finishScoutRun(runId, error);
}
