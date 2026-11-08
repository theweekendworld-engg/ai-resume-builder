import { describe, expect, test } from 'bun:test';

import { overviewStatusLine } from './overviewStatus';

const base = { needsYou: [] as unknown[], pipeline: null, jobs: null, record: null };

describe('overviewStatusLine', () => {
    test('counts what needs you and what is moving', () => {
        expect(overviewStatusLine({ ...base, needsYou: [1, 2], pipeline: [{ count: 2 }, { count: 1 }] })).toBe(
            '2 things need you, and 3 jobs are in motion.',
        );
    });

    test('singulars read as singulars', () => {
        expect(overviewStatusLine({ ...base, needsYou: [1], pipeline: [{ count: 1 }] })).toBe('1 thing needs you, and 1 job is in motion.');
    });

    test('with no search running, it falls back to the record', () => {
        expect(overviewStatusLine({ ...base, record: { confirmed: 14 } })).toBe('Nothing needs you right now. 14 confirmed wins on record.');
    });

    test('a brand-new account gets a plain sentence, not a zero', () => {
        expect(overviewStatusLine(base)).toBe('Nothing needs you right now.');
    });
});
