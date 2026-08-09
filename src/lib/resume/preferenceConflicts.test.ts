import { describe, expect, test } from 'bun:test';

import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import { resolveLengthConstraints } from './length';
import { detectPreferenceConflicts, isCleanFit, type ConflictInput } from './preferenceConflicts';

/**
 * The contract is "the preference wins, and the user is told what it cost".
 *
 * Both halves matter. A silent override breaks trust in a tool whose entire
 * pitch is that it does what you can defend; a warning that fires when nothing
 * was actually lost trains people to ignore the panel, which is the same as not
 * having one.
 */

function input(overrides: Partial<ConflictInput> = {}): ConflictInput {
    return {
        preferences: defaultUserGenerationPreferences,
        constraints: resolveLengthConstraints('1-page', 8),
        available: { roles: 2, projects: 1, bulletsPerRole: [2, 2] },
        ...overrides,
    };
}

describe('a cap that does not bite is not a conflict', () => {
    test('fewer roles than the cap allows is silent', () => {
        expect(detectPreferenceConflicts(input())).toEqual([]);
        expect(isCleanFit(input())).toBe(true);
    });

    test('exactly at the cap is still silent', () => {
        const constraints = resolveLengthConstraints('1-page', 8);
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: {
                    roles: constraints.maxExperiences,
                    projects: 1,
                    bulletsPerRole: Array(constraints.maxExperiences).fill(
                        constraints.maxBulletsPerRole,
                    ),
                },
            }),
        );
        expect(conflicts).toEqual([]);
    });
});

describe('a cap that bites is reported once, with the count', () => {
    test('dropped roles are named', () => {
        const constraints = resolveLengthConstraints('1-page', 8);
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: {
                    roles: constraints.maxExperiences + 2,
                    projects: 0,
                    bulletsPerRole: Array(constraints.maxExperiences + 2).fill(1),
                },
            }),
        );
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].summary).toContain('2 roles');
        expect(conflicts[0].preference).toBe('targetLength');
    });

    test('singular reads as English, not "1 roles"', () => {
        const constraints = resolveLengthConstraints('1-page', 8);
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: {
                    roles: constraints.maxExperiences + 1,
                    projects: 0,
                    bulletsPerRole: Array(constraints.maxExperiences + 1).fill(1),
                },
            }),
        );
        expect(conflicts[0].summary).toContain('1 role.');
        expect(conflicts[0].summary).not.toContain('1 roles');
    });

    test('bullets on a DROPPED role are not counted twice', () => {
        // The dropped role already accounts for its own bullets. Counting them
        // again makes the cost look worse than it is, which is the same class
        // of dishonesty as hiding it.
        const constraints = resolveLengthConstraints('1-page', 8);
        const overflowing = constraints.maxBulletsPerRole + 5;
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: {
                    roles: constraints.maxExperiences + 1,
                    projects: 0,
                    // Every kept role is exactly at the cap; only the dropped
                    // one overflows.
                    bulletsPerRole: [
                        ...Array(constraints.maxExperiences).fill(constraints.maxBulletsPerRole),
                        overflowing,
                    ],
                },
            }),
        );
        expect(conflicts[0].summary).toContain('1 role.');
        expect(conflicts[0].summary).not.toContain('bullet');
    });

    test('roles and bullets combine into one line, not two warnings', () => {
        const constraints = resolveLengthConstraints('1-page', 8);
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: {
                    roles: constraints.maxExperiences + 1,
                    projects: 0,
                    bulletsPerRole: Array(constraints.maxExperiences + 1).fill(
                        constraints.maxBulletsPerRole + 1,
                    ),
                },
            }),
        );
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].summary).toContain('role');
        expect(conflicts[0].summary).toContain('bullet');
    });
});

describe('the escape hatch is per-resume, never a profile write', () => {
    test('the override raises length without touching anything else', () => {
        const constraints = resolveLengthConstraints('1-page', 8);
        const conflicts = detectPreferenceConflicts(
            input({
                constraints,
                available: { roles: 9, projects: 0, bulletsPerRole: Array(9).fill(1) },
            }),
        );
        expect(conflicts[0].override).toEqual({ targetLength: '2-page' });
        expect(conflicts[0].action).toBe('Allow two pages for this one');
    });

    test('the project override never exceeds the schema ceiling of 6', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, maxProjects: 1 },
                available: { roles: 1, projects: 40, bulletsPerRole: [1] },
            }),
        );
        const projectConflict = conflicts.find((c) => c.preference === 'maxProjects');
        // Proposing a value the zod schema rejects would make the button fail.
        expect(projectConflict?.override.maxProjects).toBe(6);
    });
});

describe('wording follows what the user actually chose', () => {
    test('an explicit choice is attributed to them', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: '1-page' },
                available: { roles: 9, projects: 0, bulletsPerRole: Array(9).fill(1) },
            }),
        );
        expect(conflicts[0].summary).toContain('Your 1-page default');
    });

    test('auto is described as an outcome, because they never asked for it', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: 'auto' },
                available: { roles: 9, projects: 0, bulletsPerRole: Array(9).fill(1) },
            }),
        );
        expect(conflicts[0].summary).toContain('Fitting this to one page');
        expect(conflicts[0].summary).not.toContain('default');
    });
});
