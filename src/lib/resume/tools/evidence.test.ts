import { describe, expect, test } from 'bun:test';

import { dateSortKey } from './evidence';

/**
 * Career order is the most visible thing a resume can get wrong.
 *
 * Stored row order is insertion order, and for a real account it read
 * Plivo (2025), Swachh.io (2023), 2Sigma (2024), Hyperbots (2024) — an
 * intern role from two years earlier sitting second. Dates are free text
 * ("Sept 2025", "2020", "Present"), so this has to be forgiving rather than
 * strict: a parse failure must degrade to a sane position, never throw and
 * never silently sort to the top.
 */
describe('dateSortKey orders a career correctly', () => {
    test('a current role outranks every dated one', () => {
        expect(dateSortKey('Sept 2025', true)).toBeGreaterThan(dateSortKey('Dec 2025'));
    });

    test('"Present" is current even without the flag', () => {
        // The flag and the text disagree in real rows; either alone must work.
        expect(dateSortKey('Present')).toBe(dateSortKey('', true));
    });

    test('later years sort above earlier ones', () => {
        expect(dateSortKey('June 2024')).toBeGreaterThan(dateSortKey('May 2023'));
    });

    test('months separate roles within the same year', () => {
        expect(dateSortKey('Sept 2025')).toBeGreaterThan(dateSortKey('Mar 2025'));
        expect(dateSortKey('Dec 2024')).toBeGreaterThan(dateSortKey('Jan 2024'));
    });

    test('the real ordering that was broken', () => {
        const roles = [
            { label: 'Plivo', start: 'Sept 2025', current: true },
            { label: 'Swachh.io', start: 'May 2023', current: false },
            { label: '2Sigma', start: 'Mar 2024', current: false },
            { label: 'Hyperbots', start: 'June 2024', current: false },
        ];
        const ordered = [...roles]
            .sort((a, b) => dateSortKey(b.start, b.current) - dateSortKey(a.start, a.current))
            .map((r) => r.label);
        expect(ordered).toEqual(['Plivo', 'Hyperbots', '2Sigma', 'Swachh.io']);
    });

    test('a bare year still sorts sensibly', () => {
        expect(dateSortKey('2024')).toBeGreaterThan(dateSortKey('2020'));
    });

    test('unparseable text sorts oldest rather than newest', () => {
        // Degrading to the TOP would push a garbage row above a real current
        // role, which is the one failure a reader notices immediately.
        expect(dateSortKey('sometime')).toBeLessThan(dateSortKey('Jan 2000'));
    });

    test('month matching is case-insensitive and tolerates long forms', () => {
        expect(dateSortKey('SEPTEMBER 2025')).toBe(dateSortKey('sep 2025'));
    });
});
