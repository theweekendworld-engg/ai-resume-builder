import { describe, expect, test } from 'bun:test';
import { dedupeResults, mentionsCompany, numbersSupported, quotedIn, resolvePick } from './verify';
import type { SearchResult } from './types';

const result = (url: string): SearchResult => ({ url, title: url, content: '', rawContent: null, publishedDate: null, score: 0 });

describe('quotedIn', () => {
    test('tolerates case, dashes and whitespace, not different words', () => {
        const page = 'SDE II total compensation: ₹38L – ₹52L per year in Bengaluru.';
        expect(quotedIn('₹38L - ₹52L', page)).toBe(true);
        expect(quotedIn('₹38L-₹52L', page)).toBe(true);
        expect(quotedIn('₹40L - ₹52L', page)).toBe(false);
    });
});

describe('numbersSupported', () => {
    const page = 'Acme raised $45 million in a Series B led by Sequoia.';
    test('a figure on the page passes', () => expect(numbersSupported(['$45 million'], page)).toBe(true));
    test('a fabricated figure fails', () => expect(numbersSupported(['$50 million'], page)).toBe(false));
    test('text with no numbers passes', () => expect(numbersSupported(['Series B'], page)).toBe(true));
});

describe('mentionsCompany', () => {
    test('whole-name match only', () => {
        expect(mentionsCompany('Acme Corp announced layoffs', 'Acme, Inc.')).toBe(true);
        expect(mentionsCompany('Acmetech announced layoffs', 'Acme')).toBe(false);
    });
});

describe('resolvePick', () => {
    const results = [result('https://a.com'), result('https://b.com')];
    test('1-based, bounds-checked', () => {
        expect(resolvePick(results, 1)?.url).toBe('https://a.com');
        expect(resolvePick(results, 0)).toBeNull();
        expect(resolvePick(results, 3)).toBeNull();
        expect(resolvePick(results, 1.5)).toBeNull();
    });
});

test('dedupeResults collapses tracking-param variants', () => {
    const out = dedupeResults([result('https://www.reddit.com/r/x/1?utm_source=a'), result('https://reddit.com/r/x/1')]);
    expect(out).toHaveLength(1);
});
