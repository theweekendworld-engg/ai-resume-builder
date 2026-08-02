/**
 * The evaluator.
 *
 * Pure, so all of this runs without a database — which is the point of having
 * split the reading and writing out of it. The cases that matter are the ones
 * where "recompute from current data" and "respect what the user said" pull in
 * opposite directions.
 */

import { describe, expect, test } from 'bun:test';
import { MissionStatus, MissionStepKind, MissionStepStatus } from '@prisma/client';

import type { StepCondition } from './catalog';
import {
    evaluateMission,
    evaluateStep,
    isReadyToComplete,
    percentComplete,
    type EvaluableStep,
    type MissionFacts,
} from './evaluate';

const NOW = new Date('2026-08-02T12:00:00Z');

function step(patch: Partial<EvaluableStep> & { condition: StepCondition }): EvaluableStep {
    return {
        key: patch.key ?? 'step',
        order: patch.order ?? 0,
        kind:
            patch.kind ??
            (patch.condition.kind === 'automatic'
                ? MissionStepKind.automatic
                : patch.condition.kind === 'threshold'
                  ? MissionStepKind.threshold
                  : MissionStepKind.attested),
        status: patch.status ?? MissionStepStatus.pending,
        condition: patch.condition,
    };
}

function facts(patch: Partial<MissionFacts> = {}): MissionFacts {
    return {
        status: MissionStatus.active,
        startedAt: new Date('2026-06-01T00:00:00Z'),
        targetDate: null,
        counts: {},
        eventsSinceStart: new Set<string>(),
        steps: [],
        ...patch,
    };
}

describe('automatic steps', () => {
    test('complete when the event has fired', () => {
        const result = evaluateStep(
            step({ condition: { kind: 'automatic', event: 'packet_completed' } }),
            facts({ eventsSinceStart: new Set(['packet_completed']) }),
        );
        expect(result.status).toBe(MissionStepStatus.done);
        expect(result.newlyCompleted).toBe(true);
    });

    test('stay pending when it has not', () => {
        const result = evaluateStep(
            step({ condition: { kind: 'automatic', event: 'packet_completed' } }),
            facts({ eventsSinceStart: new Set(['radar_viewed']) }),
        );
        expect(result.status).toBe(MissionStepStatus.pending);
    });

    test('re-evaluating an already-done step does not re-report it as new', () => {
        // The evaluator runs on every mission view. If `newlyCompleted` stayed
        // true, the nudge and the telemetry event would fire on every page
        // load for the rest of the mission.
        const result = evaluateStep(
            step({
                condition: { kind: 'automatic', event: 'packet_completed' },
                status: MissionStepStatus.done,
            }),
            facts({ eventsSinceStart: new Set(['packet_completed']) }),
        );
        expect(result.status).toBe(MissionStepStatus.done);
        expect(result.newlyCompleted).toBe(false);
    });
});

describe('threshold steps', () => {
    const gap: StepCondition = {
        kind: 'threshold',
        query: 'confirmed_wins_in_gap_category',
        target: 3,
    };

    test('report progress toward the target', () => {
        const result = evaluateStep(
            step({ condition: gap }),
            facts({ counts: { confirmed_wins_in_gap_category: 1 } }),
        );
        expect(result.progress).toEqual({ current: 1, target: 3 });
        expect(result.status).toBe(MissionStepStatus.pending);
    });

    test('complete on reaching it', () => {
        const result = evaluateStep(
            step({ condition: gap }),
            facts({ counts: { confirmed_wins_in_gap_category: 3 } }),
        );
        expect(result.status).toBe(MissionStepStatus.done);
    });

    test('overshooting is clamped for display', () => {
        // "5 of 3" is not a sentence.
        const result = evaluateStep(
            step({ condition: gap }),
            facts({ counts: { confirmed_wins_in_gap_category: 5 } }),
        );
        expect(result.progress).toEqual({ current: 3, target: 3 });
    });

    test('a missing count is zero, not a crash', () => {
        const result = evaluateStep(step({ condition: gap }), facts({ counts: {} }));
        expect(result.progress).toEqual({ current: 0, target: 3 });
    });

    test('a step REOPENS when the evidence goes away', () => {
        // Deleting a win drops the count below target. The step must reopen.
        // Keeping it done would leave the mission claiming evidence the log no
        // longer contains — the same class of lie as a fabricated number.
        const result = evaluateStep(
            step({ condition: gap, status: MissionStepStatus.done }),
            facts({ counts: { confirmed_wins_in_gap_category: 2 } }),
        );
        expect(result.status).toBe(MissionStepStatus.pending);
    });
});

describe('what a recompute must never overwrite', () => {
    test('an attested step keeps whatever the user last said', () => {
        // Nothing in the data can prove "I had the conversation with my
        // manager". A pure recompute that reset it would erase the only
        // record of it every time the page loaded.
        const done = evaluateStep(
            step({ condition: { kind: 'attested' }, status: MissionStepStatus.done }),
            facts(),
        );
        expect(done.status).toBe(MissionStepStatus.done);
        expect(done.newlyCompleted).toBe(false);

        const pending = evaluateStep(
            step({ condition: { kind: 'attested' }, status: MissionStepStatus.pending }),
            facts(),
        );
        expect(pending.status).toBe(MissionStepStatus.pending);
    });

    test('a skipped step stays skipped even when its condition is satisfied', () => {
        // §4: skipping is a scoping decision. Un-skipping it behind the user's
        // back would make the choice feel unheard.
        const result = evaluateStep(
            step({
                condition: { kind: 'automatic', event: 'packet_completed' },
                status: MissionStepStatus.skipped,
            }),
            facts({ eventsSinceStart: new Set(['packet_completed']) }),
        );
        expect(result.status).toBe(MissionStepStatus.skipped);
        expect(result.newlyCompleted).toBe(false);
    });
});

describe('idempotence — §6.1', () => {
    test('evaluating twice gives an identical result', () => {
        const input = facts({
            counts: { confirmed_wins_in_gap_category: 2 },
            eventsSinceStart: new Set(['framework_uploaded']),
            steps: [
                step({ key: 'a', order: 0, condition: { kind: 'automatic', event: 'framework_uploaded' } }),
                step({
                    key: 'b',
                    order: 1,
                    condition: { kind: 'threshold', query: 'confirmed_wins_in_gap_category', target: 3 },
                }),
                step({ key: 'c', order: 2, condition: { kind: 'attested' } }),
            ],
        });

        const first = evaluateMission(input, NOW);
        const second = evaluateMission(input, NOW);
        expect(second).toEqual(first);
    });

    test('feeding the result back in is stable', () => {
        // The real loop: evaluate, persist, re-read, evaluate again. If the
        // second pass disagreed with the first, progress would oscillate.
        const steps = [
            step({ key: 'a', order: 0, condition: { kind: 'automatic', event: 'radar_viewed' } }),
            step({
                key: 'b',
                order: 1,
                condition: { kind: 'threshold', query: 'applications_since_start', target: 2 },
            }),
        ];
        const input = facts({
            steps,
            counts: { applications_since_start: 2 },
            eventsSinceStart: new Set(['radar_viewed']),
        });

        const first = evaluateMission(input, NOW);
        const persisted = facts({
            ...input,
            steps: steps.map((s) => ({
                ...s,
                status: first.steps.find((e) => e.key === s.key)!.status,
            })),
        });
        expect(evaluateMission(persisted, NOW).percent).toBe(first.percent);
    });
});

describe('progress', () => {
    test('skipped steps leave the denominator', () => {
        // Skipping three of six and finishing the rest is 100%, not 50%. A bar
        // that punishes scoping teaches people to leave dead steps hanging.
        const evaluated = [
            { key: 'a', status: MissionStepStatus.done, progress: {}, newlyCompleted: false },
            { key: 'b', status: MissionStepStatus.skipped, progress: {}, newlyCompleted: false },
            { key: 'c', status: MissionStepStatus.done, progress: {}, newlyCompleted: false },
        ];
        expect(percentComplete(evaluated)).toBe(100);
    });

    test('an all-skipped mission is 100%, not a division by zero', () => {
        expect(
            percentComplete([
                { key: 'a', status: MissionStepStatus.skipped, progress: {}, newlyCompleted: false },
            ]),
        ).toBe(100);
    });

    test('rounds to a whole number', () => {
        const evaluated = [
            { key: 'a', status: MissionStepStatus.done, progress: {}, newlyCompleted: false },
            { key: 'b', status: MissionStepStatus.pending, progress: {}, newlyCompleted: false },
            { key: 'c', status: MissionStepStatus.pending, progress: {}, newlyCompleted: false },
        ];
        expect(percentComplete(evaluated)).toBe(33);
    });
});

describe('the active step', () => {
    test('is the first one outstanding, and there is exactly one', () => {
        const result = evaluateMission(
            facts({
                eventsSinceStart: new Set(['radar_viewed']),
                steps: [
                    step({ key: 'a', order: 0, condition: { kind: 'automatic', event: 'radar_viewed' } }),
                    step({ key: 'b', order: 1, condition: { kind: 'attested' } }),
                    step({ key: 'c', order: 2, condition: { kind: 'attested' } }),
                ],
            }),
            NOW,
        );
        expect(result.activeStepKey).toBe('b');
        expect(result.steps.filter((s) => s.status === MissionStepStatus.active)).toHaveLength(1);
    });

    test('skips over a skipped step', () => {
        const result = evaluateMission(
            facts({
                steps: [
                    step({ key: 'a', order: 0, condition: { kind: 'attested' }, status: MissionStepStatus.skipped }),
                    step({ key: 'b', order: 1, condition: { kind: 'attested' } }),
                ],
            }),
            NOW,
        );
        expect(result.activeStepKey).toBe('b');
    });

    test('is evaluated in template order, not array order', () => {
        const result = evaluateMission(
            facts({
                steps: [
                    step({ key: 'later', order: 5, condition: { kind: 'attested' } }),
                    step({ key: 'earlier', order: 1, condition: { kind: 'attested' } }),
                ],
            }),
            NOW,
        );
        expect(result.activeStepKey).toBe('earlier');
    });

    test('is null once everything is settled', () => {
        const result = evaluateMission(
            facts({
                steps: [step({ key: 'a', order: 0, condition: { kind: 'attested' }, status: MissionStepStatus.done })],
            }),
            NOW,
        );
        expect(result.activeStepKey).toBeNull();
        expect(result.allStepsSettled).toBe(true);
    });
});

describe('overdue', () => {
    const past = new Date('2026-07-01T00:00:00Z');

    test('an active mission past its date with work left is overdue', () => {
        const result = evaluateMission(
            facts({ targetDate: past, steps: [step({ key: 'a', condition: { kind: 'attested' } })] }),
            NOW,
        );
        expect(result.overdue).toBe(true);
    });

    test('a PAUSED mission never is', () => {
        // §2 rule 2: "a paused mission is not a failure state and the UI must
        // not treat it as one". Accruing overdue while paused is exactly that.
        const result = evaluateMission(
            facts({
                status: MissionStatus.paused,
                targetDate: past,
                steps: [step({ key: 'a', condition: { kind: 'attested' } })],
            }),
            NOW,
        );
        expect(result.overdue).toBe(false);
    });

    test('finished work past the date is not overdue', () => {
        const result = evaluateMission(
            facts({
                targetDate: past,
                steps: [step({ key: 'a', condition: { kind: 'attested' }, status: MissionStepStatus.done })],
            }),
            NOW,
        );
        expect(result.overdue).toBe(false);
    });

    test('no target date means never overdue', () => {
        const result = evaluateMission(
            facts({ targetDate: null, steps: [step({ key: 'a', condition: { kind: 'attested' } })] }),
            NOW,
        );
        expect(result.overdue).toBe(false);
    });
});

describe('completion is asked for, never inferred', () => {
    test('all steps done makes a mission READY, not complete', () => {
        // §2 rule 4. Every step of "get promoted" can be done and the
        // promotion still refused; auto-completing would both record the wrong
        // outcome and throw away the question that makes the dataset exist.
        const evaluation = evaluateMission(
            facts({
                steps: [step({ key: 'a', condition: { kind: 'attested' }, status: MissionStepStatus.done })],
            }),
            NOW,
        );
        expect(isReadyToComplete(evaluation, MissionStatus.active)).toBe(true);
    });

    test('a paused mission is not ready even with every step done', () => {
        const evaluation = evaluateMission(
            facts({
                status: MissionStatus.paused,
                steps: [step({ key: 'a', condition: { kind: 'attested' }, status: MissionStepStatus.done })],
            }),
            NOW,
        );
        expect(isReadyToComplete(evaluation, MissionStatus.paused)).toBe(false);
    });
});
