/**
 * The mission evaluator (PRD 05 §6.1).
 *
 * > A single evaluator runs on: mission view, any relevant product event, and
 * > a nightly sweep. It is **pure and idempotent** — recomputing from current
 * > data must give the same answer. Never increment progress in an event
 * > handler; always recompute.
 *
 * That rule is the whole design, and it is not stylistic. A mission runs for
 * three to nine months across an unknown number of sessions, retries, and
 * double-fired crons. Any counter that is incremented by a handler will drift,
 * and a drifted mission is worse than no mission: it tells someone they have
 * three cross-team wins when they have one, and they walk into a promotion
 * conversation on it.
 *
 * So this file is split in two:
 *
 *   `evaluateMission` is PURE. Facts in, decisions out, no IO, no clock beyond
 *   the `now` it is handed. Every rule below is testable without a database.
 *
 *   `loadMissionFacts` does the reading, and `applyEvaluation` does the
 *   writing. Both are dumb on purpose — the interesting part must be the part
 *   with no dependencies.
 */

import { MissionStatus, MissionStepKind, MissionStepStatus } from '@prisma/client';

import type { StepCondition, ThresholdQuery } from './catalog';

/** What the evaluator is allowed to know. Nothing here is a query. */
export type MissionFacts = {
    status: MissionStatus;
    startedAt: Date | null;
    targetDate: Date | null;
    /** Counts for every threshold query, already run. Missing = 0. */
    counts: Partial<Record<ThresholdQuery, number>>;
    /** Product events seen since `startedAt`, by name. */
    eventsSinceStart: ReadonlySet<string>;
    steps: EvaluableStep[];
};

export type EvaluableStep = {
    key: string;
    order: number;
    kind: MissionStepKind;
    /** Persisted status. Attested and skipped decisions live here and are respected. */
    status: MissionStepStatus;
    condition: StepCondition;
};

export type StepEvaluation = {
    key: string;
    status: MissionStepStatus;
    /** `{current, target}` for threshold steps; `{}` otherwise. */
    progress: { current?: number; target?: number };
    /** True when this evaluation moves the step to `done` from something else. */
    newlyCompleted: boolean;
};

export type MissionEvaluation = {
    steps: StepEvaluation[];
    /** 0–100, derived. §2: progress is never the source of truth. */
    percent: number;
    /** The first step that is neither done nor skipped — what Home points at. */
    activeStepKey: string | null;
    /** Every non-skipped step is done. Does NOT mean the mission is complete. */
    allStepsSettled: boolean;
    /** Past `targetDate` with work outstanding. Informational, never punitive. */
    overdue: boolean;
};

/**
 * Decide one step.
 *
 * The ordering of the guards matters more than the arithmetic:
 *
 *   A user decision always wins. `skipped` is the user saying "not for me"
 *   (§4: "steps can be skipped with the mission still completable"), and an
 *   `attested` `done` is the user saying "I had the conversation". Neither can
 *   be recomputed from data, so neither may be overwritten by a recompute —
 *   which is exactly what a naive pure evaluator would do on its next run.
 *
 *   Automatic and threshold steps are re-derived every time, including
 *   BACKWARDS. If a win is deleted and the count drops below target, the step
 *   reopens. That looks unfriendly and is correct: the alternative is a mission
 *   that claims evidence the log no longer contains, which is the same class of
 *   lie the numeric guard exists to prevent.
 */
export function evaluateStep(step: EvaluableStep, facts: MissionFacts): StepEvaluation {
    if (step.status === MissionStepStatus.skipped) {
        return { key: step.key, status: MissionStepStatus.skipped, progress: {}, newlyCompleted: false };
    }

    if (step.condition.kind === 'attested') {
        // Only the user can complete these. Preserve whatever they last said.
        return { key: step.key, status: step.status, progress: {}, newlyCompleted: false };
    }

    if (step.condition.kind === 'automatic') {
        const fired = facts.eventsSinceStart.has(step.condition.event);
        return {
            key: step.key,
            status: fired ? MissionStepStatus.done : MissionStepStatus.pending,
            progress: {},
            newlyCompleted: fired && step.status !== MissionStepStatus.done,
        };
    }

    const target = step.condition.target;
    const current = facts.counts[step.condition.query] ?? 0;
    const done = current >= target;
    return {
        key: step.key,
        status: done ? MissionStepStatus.done : MissionStepStatus.pending,
        // Clamped for display: "5 of 3" is not a thing anyone wants to read.
        progress: { current: Math.min(current, target), target },
        newlyCompleted: done && step.status !== MissionStepStatus.done,
    };
}

/**
 * Percent complete.
 *
 * Skipped steps leave the denominator, they do not count as done. A user who
 * skips three of six steps is at 100% when the other three finish, not 50% —
 * skipping is a scoping decision, not a failure, and a progress bar that
 * punishes it teaches people to leave dead steps hanging instead.
 *
 * A mission where everything is skipped has no work in it, and 100% is the
 * honest reading of "nothing left to do".
 */
export function percentComplete(steps: readonly StepEvaluation[]): number {
    const counted = steps.filter((step) => step.status !== MissionStepStatus.skipped);
    if (counted.length === 0) return 100;
    const done = counted.filter((step) => step.status === MissionStepStatus.done).length;
    return Math.round((done / counted.length) * 100);
}

export function evaluateMission(facts: MissionFacts, now: Date): MissionEvaluation {
    const ordered = [...facts.steps].sort((a, b) => a.order - b.order);
    const steps = ordered.map((step) => evaluateStep(step, facts));

    const outstanding = steps.filter(
        (step) => step.status !== MissionStepStatus.done && step.status !== MissionStepStatus.skipped,
    );

    // Exactly one step is `active` — the first outstanding one. Home shows a
    // single "you are here", and marking several active would make the mission
    // read as a backlog.
    const activeStepKey = outstanding[0]?.key ?? null;
    const withActive = steps.map((step) =>
        step.key === activeStepKey && step.status === MissionStepStatus.pending
            ? { ...step, status: MissionStepStatus.active }
            : step,
    );

    return {
        steps: withActive,
        percent: percentComplete(withActive),
        activeStepKey,
        allStepsSettled: outstanding.length === 0,
        // A paused mission is explicitly not a failure state (§2 rule 2), so it
        // does not accrue overdue. Neither does one that has not started.
        overdue:
            facts.status === MissionStatus.active &&
            facts.targetDate !== null &&
            facts.targetDate.getTime() < now.getTime() &&
            outstanding.length > 0,
    };
}

/**
 * Does finishing the steps finish the mission?
 *
 * No — and this is deliberate. §2 rule 4: "completion always asks for the
 * outcome". A mission whose steps are all done is READY to complete; it is
 * completed by the user answering "did you get it?". Auto-completing would
 * throw away the one question that makes the outcome dataset exist, and it
 * would also be wrong: every step of "get promoted" can be done and the
 * promotion still refused.
 */
export function isReadyToComplete(evaluation: MissionEvaluation, status: MissionStatus): boolean {
    return status === MissionStatus.active && evaluation.allStepsSettled;
}
