/**
 * The quota sentence.
 *
 * Both bugs this covers were found by reading the live `/settings/plan` page,
 * not by a failing assertion: "0 of 1 lifetime this period" (a lifetime
 * allowance described as a period one) and "3 of 1 lifetime" (over a limit
 * that is deliberately not enforced yet, rendered as bare arithmetic).
 *
 * The sentence is a pure function precisely so this file can exist — the repo
 * has no React component test setup, and one string does not justify standing
 * one up.
 */

import { describe, expect, test } from 'bun:test';
import { quotaSentence } from './quota-meter';

describe('quotaSentence', () => {
    test('a period quota names the period', () => {
        expect(quotaSentence(0, 3)).toBe('0 of 3 this period');
    });

    test('a unit-scoped quota does not also claim to be a period', () => {
        // "0 of 1 lifetime this period" was the original wrong reading.
        expect(quotaSentence(0, 1, 'lifetime')).toBe('0 of 1 lifetime');
        expect(quotaSentence(0, 1, 'lifetime')).not.toContain('this period');
    });

    test('at the limit is not yet over the limit', () => {
        expect(quotaSentence(1, 1, 'lifetime')).toBe('1 of 1 lifetime');
        expect(quotaSentence(3, 3)).toBe('3 of 3 this period');
    });

    test('over a soft limit says so instead of reading as broken arithmetic', () => {
        expect(quotaSentence(3, 1, 'lifetime')).toBe('3 of 1 lifetime · over your plan');
        expect(quotaSentence(5, 3)).toBe('5 of 3 this period · over your plan');
    });

    test('the over-limit copy never claims the user was blocked', () => {
        // Limits are shown before they are enforced; saying otherwise would be
        // a lie the plan page cannot back up.
        const sentence = quotaSentence(9, 1, 'lifetime');
        expect(sentence).not.toMatch(/blocked|locked|denied|exceeded/i);
    });
});
