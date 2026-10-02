import { describe, expect, test } from 'bun:test';
import { parseExperienceDate, resolveEmployerIdFrom } from './winGraph';

const NOW = new Date(Date.UTC(2026, 9, 2));

describe('parseExperienceDate (resume formats)', () => {
    test('month names and MM/YYYY', () => {
        expect(parseExperienceDate('Sept 2023', 'start')?.toISOString()).toBe('2023-09-01T00:00:00.000Z');
        expect(parseExperienceDate('September 2023', 'end')?.toISOString()).toBe('2023-09-30T23:59:59.999Z');
        expect(parseExperienceDate("Mar '22", 'start')?.toISOString()).toBe('2022-03-01T00:00:00.000Z');
        expect(parseExperienceDate('03/2022', 'start')?.toISOString()).toBe('2022-03-01T00:00:00.000Z');
        expect(parseExperienceDate('Present', 'end')).toBeNull();
    });
});

describe('resolveEmployerIdFrom', () => {
    test('a date inside exactly one role picks it', () => {
        const id = resolveEmployerIdFrom(
            [{ id: 'a', startDate: 'Sept 2023', endDate: 'Present', current: true }, { id: 'b', startDate: '2019', endDate: '2023-08', current: false }],
            new Date(Date.UTC(2024, 5, 1)), NOW,
        );
        expect(id).toBe('a');
    });

    test('recent work with unreadable dates goes to the one current role', () => {
        const id = resolveEmployerIdFrom(
            [{ id: 'now', startDate: 'Q3 of last year', endDate: '', current: true }, { id: 'old', startDate: 'long ago', endDate: 'then', current: false }],
            NOW, NOW,
        );
        expect(id).toBe('now');
    });

    test('old work with unreadable dates is not guessed', () => {
        const id = resolveEmployerIdFrom([{ id: 'now', startDate: '??', endDate: '', current: true }], new Date(Date.UTC(2025, 0, 1)), NOW);
        expect(id).toBeNull();
    });

    test('overlapping roles are never guessed, even for recent work', () => {
        const id = resolveEmployerIdFrom(
            [{ id: 'a', startDate: '2024', endDate: 'Present', current: true }, { id: 'b', startDate: '2025', endDate: 'Present', current: true }],
            NOW, NOW,
        );
        expect(id).toBeNull();
    });
});
