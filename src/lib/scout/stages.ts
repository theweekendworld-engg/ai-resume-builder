/**
 * The one ordering of a Scout run — with NO database or model imports.
 *
 * This file is imported by the workflow function, which runs in the workflow
 * SDK's deterministic sandbox: anything touching Prisma, fetch or a model must
 * happen inside a step, reached through the driver. The same function drives
 * local development with plain functions (`INLINE_DRIVER` in `pipeline.ts`),
 * so there is exactly one sequence and both environments run it.
 *
 * Failure handling is by return value, not exception. A thrown error inside a
 * durable step is retried by the runtime, which is the wrong response to
 * "this is not a job link" — so steps return a stored `failed` section and
 * this function decides what that means.
 */

import { PREAMBLE, STAGES_BY_KIND } from '@/lib/scout/plan';
import type { ClassifyData, ScoutKind, ScoutSectionName } from '@/lib/scout/types';
import type { StoredSection } from '@/lib/agent/run';

export type StageDriver = {
    begin: (runId: string) => Promise<void>;
    runSection: (runId: string, name: ScoutSectionName) => Promise<StoredSection>;
    setKind: (runId: string, kind: ScoutKind) => Promise<void>;
    /** After every stage, so channels can edit their progress message. */
    progress: (runId: string) => Promise<void>;
    finish: (runId: string, error: string | null) => Promise<void>;
};

function failureOf(name: ScoutSectionName, section: StoredSection): string | null {
    if (section.status === 'ok') return null;
    if (section.status === 'failed' || section.status === 'unavailable' || section.status === 'skipped') {
        return section.reason || `${name} did not complete`;
    }
    return null;
}

export async function runScoutStages(runId: string, driver: StageDriver): Promise<void> {
    await driver.begin(runId);

    let kind: ScoutKind | null = null;
    for (const name of PREAMBLE) {
        const section = await driver.runSection(runId, name);
        await driver.progress(runId);
        // The preamble is critical: without the text, or without knowing what
        // it is, every later section would be guessing.
        const failure = failureOf(name, section);
        if (failure) {
            await driver.finish(runId, failure);
            return;
        }
        if (name === 'classify' && section.status === 'ok') kind = (section.data as ClassifyData).kind;
    }

    if (!kind) {
        await driver.finish(runId, 'Could not work out what this link is');
        return;
    }
    await driver.setKind(runId, kind);

    for (const stage of STAGES_BY_KIND[kind]) {
        await Promise.all(stage.map((name) => driver.runSection(runId, name)));
        await driver.progress(runId);
    }
    await driver.finish(runId, null);
}
