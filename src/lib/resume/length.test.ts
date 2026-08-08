import { describe, expect, test } from 'bun:test';

import { MAX_EXPERIENCES, resolveLengthConstraints } from './length';

/**
 * Choosing "2-page" used to change almost nothing.
 *
 * Both branches returned the same `maxExperiences`, and `maxBulletsPerRole`
 * was not in this function at all — the generation call site passed a
 * hardcoded 4. So a candidate with eight years who explicitly asked for two
 * pages got four roles at four bullets each, exactly like the one-page
 * version, and then read a coverage report blaming the cap for the lines it
 * dropped.
 */
describe('the target length actually changes the document', () => {
    const onePage = resolveLengthConstraints('1-page', 8);
    const twoPage = resolveLengthConstraints('2-page', 8);

    test('two pages fits more roles', () => {
        expect(twoPage.maxExperiences).toBeGreaterThan(onePage.maxExperiences);
    });

    test('and more of each role', () => {
        // The cap this is really about: it decides how much of someone's work
        // survives selection.
        expect(twoPage.maxBulletsPerRole).toBeGreaterThan(onePage.maxBulletsPerRole);
    });

    test('and more projects and skills', () => {
        expect(twoPage.maxProjects).toBeGreaterThan(onePage.maxProjects);
        expect(twoPage.maxSkills).toBeGreaterThan(onePage.maxSkills);
    });

    test('every cap is a real number, never zero', () => {
        for (const constraints of [onePage, twoPage]) {
            for (const [key, value] of Object.entries(constraints)) {
                expect(value, `${key} must be a usable cap`).toBeGreaterThan(0);
            }
        }
    });
});

describe('one page holds the line', () => {
    const onePage = resolveLengthConstraints('1-page', 12);

    test('a long career does not silently become two pages', () => {
        // Someone who asked for one page gets one page. The constraint is the
        // point of the setting.
        expect(onePage.maxExperiences).toBe(MAX_EXPERIENCES);
        expect(onePage.maxBulletsPerRole).toBe(4);
    });
});

describe('auto', () => {
    test('a short career gets one page', () => {
        expect(resolveLengthConstraints('auto', 2)).toEqual(resolveLengthConstraints('1-page', 2));
    });

    test('a long one gets two', () => {
        expect(resolveLengthConstraints('auto', 9)).toEqual(resolveLengthConstraints('2-page', 9));
    });

    test('the boundary is five years, and it is inclusive', () => {
        expect(resolveLengthConstraints('auto', 5).maxExperiences).toBe(
            resolveLengthConstraints('2-page', 5).maxExperiences,
        );
        expect(resolveLengthConstraints('auto', 4).maxExperiences).toBe(
            resolveLengthConstraints('1-page', 4).maxExperiences,
        );
    });
});
