import { describe, expect, test } from 'bun:test';
import { fitHighlights, HIGHLIGHT_MAX } from './fitHighlights';

describe('fitHighlights', () => {
    test('short lines pass through unchanged', () => {
        expect(fitHighlights(['Cut p95 from 800ms to 180ms.'])).toEqual(['Cut p95 from 800ms to 180ms.']);
    });

    test('a long line is split at sentence boundaries, keeping every word', () => {
        const sentence = 'Led the migration of twelve services onto Kubernetes with zero downtime. ';
        const long = sentence.repeat(6).trim();
        const out = fitHighlights([long]);
        expect(out.length).toBeGreaterThan(1);
        expect(out.every((line) => line.length <= HIGHLIGHT_MAX)).toBe(true);
        expect(out.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
    });

    test('one unbroken run is cut at a word boundary', () => {
        const words = Array.from({ length: 80 }, (_, i) => `word${i}`);
        const out = fitHighlights([words.join(' ')]);
        expect(out.every((line) => line.length <= HIGHLIGHT_MAX)).toBe(true);
        // No word cut in half: rejoined, the words are exactly the input's.
        expect(out.join(' ').split(' ')).toEqual(words);
    });

    test('empty and non-string entries are dropped; at most 100 lines', () => {
        expect(fitHighlights(['', '  ', ...Array.from({ length: 150 }, () => 'x')])).toHaveLength(100);
        expect(fitHighlights(undefined)).toEqual([]);
    });
});
