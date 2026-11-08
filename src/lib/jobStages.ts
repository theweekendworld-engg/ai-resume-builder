/**
 * A job's four stages, as the ProgressRail shows them (Dossier, 2026-11-08):
 *
 *   Analyzed → Tailored → Email ready → Applied
 *
 * Pure, so Home, the job list and the job page derive the same answer from
 * the same facts, and a test can hold it. Facts in, statuses out; nothing
 * here reads the database.
 *
 * The rules, in order:
 *   - a stage whose fact is true is `done`;
 *   - the first stage that is not done, with nothing done after it, is
 *     `current` — that is where the user is;
 *   - a not-done stage with a LATER stage done is `skipped`: someone who
 *     applied with their own resume never tailored one, and the rail says so
 *     rather than pretending the step happened or is still owed;
 *   - everything after `current` is `upcoming`.
 */

export type JobStageKey = 'analyzed' | 'tailored' | 'email' | 'applied';

export type JobStageStatus = 'done' | 'current' | 'upcoming' | 'skipped';

export type JobStage = { key: JobStageKey; label: string; status: JobStageStatus };

export const JOB_STAGE_LABEL: Record<JobStageKey, string> = {
    analyzed: 'Analyzed',
    tailored: 'Tailored',
    email: 'Email ready',
    applied: 'Applied',
};

export const JOB_STAGE_ORDER: readonly JobStageKey[] = ['analyzed', 'tailored', 'email', 'applied'];

export type JobStageFacts = Record<JobStageKey, boolean>;

/** Statuses that mean the application went out (`ApplicationStatus`). */
const APPLIED_STATUSES = new Set(['submitted', 'applied', 'in_review', 'interview', 'offer', 'rejected', 'ghosted']);

/**
 * The facts a workspace row can answer without another query. `emailReady`
 * needs the drafts table, so the caller passes it in.
 */
export function jobStageFacts(row: {
    applicationStatus: string;
    fitScore?: number | null;
    scoutRunId?: string | null;
    selectedResumeId?: string | null;
    selectedGeneratedPdfId?: string | null;
    latestGenerationSessionId?: string | null;
    emailReady: boolean;
}): JobStageFacts {
    const applied = APPLIED_STATUSES.has(row.applicationStatus);
    return {
        // A workspace exists once a job is read; "analyzed" means it was scored.
        analyzed: row.fitScore != null || !!row.scoutRunId || row.applicationStatus !== 'discovered',
        tailored: !!(row.selectedResumeId || row.selectedGeneratedPdfId || row.latestGenerationSessionId),
        email: row.emailReady,
        applied,
    };
}

export function jobStages(facts: JobStageFacts): JobStage[] {
    const lastDone = JOB_STAGE_ORDER.reduce((last, key, index) => (facts[key] ? index : last), -1);
    let currentAssigned = false;
    return JOB_STAGE_ORDER.map((key, index) => {
        let status: JobStageStatus;
        if (facts[key]) status = 'done';
        else if (index < lastDone) status = 'skipped';
        else if (!currentAssigned) {
            status = 'current';
            currentAssigned = true;
        } else status = 'upcoming';
        return { key, label: JOB_STAGE_LABEL[key], status };
    });
}

/** "Tailored, 2 of 4" — for a row's accessible summary and a tooltip. */
export function jobStageSummary(stages: JobStage[]): string {
    const done = stages.filter((stage) => stage.status === 'done').length;
    const current = stages.find((stage) => stage.status === 'current');
    if (!current) return `All ${stages.length} stages done`;
    return `Next: ${current.label} · ${done} of ${stages.length} done`;
}
