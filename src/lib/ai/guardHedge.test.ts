import { describe, expect, test } from 'bun:test';
import { checkNumericGuard } from './guard';

const check = (source: string, output: string) =>
    checkNumericGuard({ text: output }, { sourceText: source, fields: ['text'] }).ok;

describe('estimates stay estimates', () => {
    test('"~50%" cannot come back as a flat "50%" (QA 2026-11-07)', () => {
        expect(check('cut support workload by ~50%', 'cut support workload by 50%')).toBe(false);
        expect(check('cut support workload by ∼50%', 'reduced support workload by 50%.')).toBe(false);
        expect(check('cut support workload by approximately 50%', 'cut it by 50%')).toBe(false);
    });

    test('keeping the hedge, or any hedge, is fine', () => {
        expect(check('cut support workload by ~50%', 'cut support workload by ~50%')).toBe(true);
        expect(check('cut support workload by ~50%', 'cut support workload by about 50%')).toBe(true);
        expect(check('cut support workload by ∼50%', 'cut support workload by ∼50%')).toBe(true);
    });

    test('hedging an exact figure is allowed: it is a weaker claim', () => {
        expect(check('cut fleet cost by 50%', 'cut fleet cost by about 50%')).toBe(true);
        expect(check('cut fleet cost by 50%', 'cut fleet cost by 50%')).toBe(true);
    });

    test('a floor stays a floor: "100K+" is not "100K"', () => {
        expect(check('handling 100K+ events a day', 'handling 100K events a day')).toBe(false);
        expect(check('handling 100K+ events a day', 'handling more than 100K events a day')).toBe(true);
        expect(check('handling 100K+ events a day', 'handling 100K+ events a day')).toBe(true);
    });

    test('an exact mention elsewhere in the source still supports the exact figure', () => {
        expect(check('about 50% in Q1; 50% in Q2', 'cut it by 50%')).toBe(true);
    });
});
