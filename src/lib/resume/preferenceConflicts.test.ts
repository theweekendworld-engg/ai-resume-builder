import { describe, expect, test } from 'bun:test';

import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import { detectPreferenceConflicts, isCleanFit, type ConflictInput } from './preferenceConflicts';

/**
 * The contract is "the preference wins, and the user is told what it cost".
 *
 * Both halves matter. A silent override breaks trust in a tool whose pitch is
 * that it does what you can defend; a warning that fires when nothing was
 * actually lost trains people to ignore the panel, which is the same as not
 * having one.
 */

const capLine = (targetLabel: string, targetKind: 'experience' | 'project' = 'experience') =>
    ({ reason: 'cap' as const, targetKind, targetLabel });

function input(overrides: Partial<ConflictInput> = {}): ConflictInput {
    return {
        preferences: defaultUserGenerationPreferences,
        dropped: [],
        answeredByCut: [],
        ...overrides,
    };
}

describe('nothing cut means nothing said', () => {
    test('no dropped lines is a clean fit', () => {
        expect(detectPreferenceConflicts(input())).toEqual([]);
        expect(isCleanFit(input())).toBe(true);
    });

    test("lines cut for being weak are not the preference's fault", () => {
        // The selector dropping a line that did not earn its place is it doing
        // its job. Blaming the length preference for that would fire the
        // warning on almost every resume, which is how a panel gets ignored.
        const conflicts = detectPreferenceConflicts(
            input({
                dropped: [
                    { reason: 'weak', targetKind: 'experience', targetLabel: 'Acme' },
                    { reason: 'weak', targetKind: 'project', targetLabel: 'Bookshelf' },
                ],
            }),
        );
        expect(conflicts).toEqual([]);
    });
});

describe('a cap that bit is reported with what it cost', () => {
    test('lines and distinct roles, not lines twice', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: '1-page' },
                dropped: [capLine('Acme'), capLine('Acme'), capLine('Globex')],
            }),
        );
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].summary).toBe('Your 1-page default cut 3 lines from 2 roles.');
    });

    test('a lost requirement outranks a line count', () => {
        // This is the sentence that decides whether they widen the resume, so
        // it must lead with the employer's ask rather than with formatting.
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: '1-page' },
                dropped: [capLine('Acme'), capLine('Acme')],
                answeredByCut: [{ text: 'Kubernetes in production' }, { text: 'Mentoring' }],
            }),
        );
        expect(conflicts[0].summary).toContain('2 things this posting asks for');
        expect(conflicts[0].requirementsLost).toEqual([
            'Kubernetes in production',
            'Mentoring',
        ]);
    });

    test('one lost requirement reads as English, not "1 things"', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                dropped: [capLine('Acme')],
                answeredByCut: [{ text: 'Kubernetes' }],
            }),
        );
        expect(conflicts[0].summary).toContain('answered something this posting asks for');
        expect(conflicts[0].summary).not.toContain('1 things');
    });

    test('singular line and role read as English', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: '1-page' },
                dropped: [capLine('Acme')],
            }),
        );
        expect(conflicts[0].summary).toBe('Your 1-page default cut 1 line from 1 role.');
    });
});

describe('wording follows what the user actually chose', () => {
    test('an explicit choice is attributed to them', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: '2-page' },
                dropped: [capLine('Acme')],
            }),
        );
        expect(conflicts[0].summary).toContain('Your 2-page default');
    });

    test('auto is described as an outcome, because they never asked for it', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, targetLength: 'auto' },
                dropped: [capLine('Acme')],
            }),
        );
        expect(conflicts[0].summary).toContain('Fitting this to your experience');
        expect(conflicts[0].summary).not.toContain('default');
    });
});

describe('projects are a separate preference and a separate warning', () => {
    test('project lines blame the project limit, not the length', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                preferences: { ...defaultUserGenerationPreferences, maxProjects: 2 },
                dropped: [capLine('Bookshelf', 'project'), capLine('Bookshelf', 'project')],
            }),
        );
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].preference).toBe('maxProjects');
        expect(conflicts[0].summary).toContain('limit of 2 projects');
    });

    test('a lost requirement is never attributed to the project limit', () => {
        // answeredByCut is scored against experience lines. Attaching it to the
        // project warning would borrow one preference's evidence for another.
        const conflicts = detectPreferenceConflicts(
            input({
                dropped: [capLine('Bookshelf', 'project')],
                answeredByCut: [{ text: 'Kubernetes' }],
            }),
        );
        const projectConflict = conflicts.find((c) => c.preference === 'maxProjects');
        expect(projectConflict?.requirementsLost).toEqual([]);
    });

    test('both caps biting yields two distinct warnings', () => {
        const conflicts = detectPreferenceConflicts(
            input({
                dropped: [capLine('Acme'), capLine('Bookshelf', 'project')],
            }),
        );
        expect(conflicts.map((c) => c.preference)).toEqual(['targetLength', 'maxProjects']);
    });
});
