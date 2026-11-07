import { describe, expect, test } from 'bun:test';
import { escapeLatex } from './latex';

describe('escapeLatex', () => {
    test('the approximation sign from PDF extraction survives as math mode', () => {
        // "∼" (U+223C) has no glyph in the engine's fonts and used to vanish.
        expect(escapeLatex('cut support workload by ∼50%')).toBe('cut support workload by $\\sim$50\\%');
        expect(escapeLatex('~50%')).toBe('\\textasciitilde{}50\\%');
    });

    test('one pass: a replacement is never escaped again', () => {
        expect(escapeLatex('a\\b')).toBe('a\\textbackslash{}b');
        expect(escapeLatex('{x}')).toBe('\\{x\\}');
    });

    test('other symbols resumes use', () => {
        expect(escapeLatex('75s → 13s, 2× capacity, ≥ 99.9%')).toBe('75s $\\rightarrow$ 13s, 2$\\times$ capacity, $\\geq$ 99.9\\%');
        expect(escapeLatex('R&D #1 at 100_000 $')).toBe('R\\&D \\#1 at 100\\_000 \\$');
    });
});
