import { describe, expect, test } from 'bun:test';
import { matchAnswer } from './answerMatch';

const RELOCATE = {
    id: 'pref.relocate',
    step: 'fit',
    prompt: 'This role is in Chennai. Would you relocate for the right role?',
    options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'case_by_case', label: 'Depends on the role' },
    ],
    askedAt: '2026-09-26T07:40:00.000Z',
};
const NOW = new Date('2026-09-26T07:45:00.000Z');

describe('matchAnswer', () => {
    // Production, 2026-09-26: this note was recorded as the relocation answer.
    test('a work note is never taken as the answer to an option question', () => {
        expect(matchAnswer(RELOCATE, 'Cut Telegram webhook latency by moving Scout runs onto the workflow runtime', NOW)).toBeNull();
        expect(matchAnswer(RELOCATE, 'https://www.linkedin.com/jobs/view/4424231243/', NOW)).toBeNull();
    });

    test.each([
        ['Yes', 'yes'], ['yeah', 'yes'], ['Nope', 'no'], ['no', 'no'],
        ['depends', 'case_by_case'], ['Depends on the role', 'case_by_case'], ['maybe', 'case_by_case'],
    ])('"%s" answers as %s', (text, value) => {
        expect(matchAnswer(RELOCATE, text, NOW)).toBe(value);
    });

    test('a short reply naming exactly one option picks it; naming two picks neither', () => {
        const modes = { id: 'pref.workMode', step: 'fit', prompt: 'Work mode?', options: [
            { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'onsite', label: 'Onsite' },
        ] };
        expect(matchAnswer(modes, 'remote please', NOW)).toBe('remote');
        expect(matchAnswer(modes, 'remote or hybrid', NOW)).toBeNull();
    });

    test('an open question accepts a short, recent reply only', () => {
        const open = { id: 'pref.targetRoles', step: 'fit', prompt: 'Which roles?', askedAt: '2026-09-26T07:40:00.000Z' };
        expect(matchAnswer(open, 'Backend engineer, SDE II', NOW)).toBe('Backend engineer, SDE II');
        expect(matchAnswer(open, 'Backend engineer', new Date('2026-09-26T09:00:00.000Z'))).toBeNull();
        expect(matchAnswer(open, 'x'.repeat(200), NOW)).toBeNull();
        expect(matchAnswer({ ...open, askedAt: undefined }, 'Backend engineer', NOW)).toBeNull();
    });
});
