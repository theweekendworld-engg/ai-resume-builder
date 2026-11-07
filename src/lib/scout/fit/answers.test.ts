import { describe, expect, test } from 'bun:test';
import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import { NON_BLOCKING_QUESTIONS, applyAnswer, applyAnswers, parseRelocate, parseWorkModes } from './answers';

const base = defaultUserGenerationPreferences;

describe('answer parsing', () => {
    test('relocation', () => {
        expect(parseRelocate('yes')).toBe('yes');
        expect(parseRelocate('Yeah, for the right role')).toBe('case_by_case');
        expect(parseRelocate('no')).toBe('no');
        expect(parseRelocate('not sure')).toBe('case_by_case');
        expect(parseRelocate('banana')).toBeNull();
    });

    test('work modes', () => {
        expect(parseWorkModes('remote, hybrid')).toEqual(['remote', 'hybrid']);
        expect(parseWorkModes('any')).toEqual(['remote', 'hybrid', 'onsite']);
        expect(parseWorkModes('in office is fine')).toEqual(['onsite']);
    });

    test('locations split on "and", roles do not', () => {
        expect(applyAnswer(base, 'pref.location', 'Bengaluru and Pune')?.targetLocations).toEqual(['Bengaluru', 'Pune']);
        expect(applyAnswer(base, 'pref.targetRoles', 'Research and Development Engineer, SDE II')?.targetRoles)
            .toEqual(['Research and Development Engineer', 'SDE II']);
    });

    test('an unintelligible answer changes nothing', () => {
        expect(applyAnswer(base, 'pref.minComp', 'a lot')).toBeNull();
        expect(applyAnswers(base, { 'pref.relocate': '???' })).toEqual(base);
    });

    test('answers never clobber unrelated preferences', () => {
        const prefs = { ...base, defaultTemplate: 'modern' as const, preferredWorkModes: ['remote' as const] };
        const next = applyAnswers(prefs, { 'pref.relocate': 'no', 'other.key': 'x' });
        expect(next.defaultTemplate).toBe('modern');
        expect(next.preferredWorkModes).toEqual(['remote']);
        expect(next.willingToRelocate).toBe('no');
    });

    test('work authorization keeps the user\'s words, only when the eligibility check can read them', () => {
        expect(applyAnswer(base, 'pref.workAuth', 'US citizen')?.workAuthorization).toBe('US citizen');
        expect(applyAnswer(base, 'pref.workAuth', 'Not authorized to work in the US')?.workAuthorization).toBe('Not authorized to work in the US');
        expect(applyAnswer(base, 'pref.workAuth', 'maybe')).toBeNull();
    });

    test('only the pay floor is a follow-up; the rest still hold the fit', () => {
        expect([...NON_BLOCKING_QUESTIONS]).toEqual(['pref.minComp']);
    });
});
