/**
 * The name normaliser.
 *
 * These assertions are load-bearing in an unusual way: the output is half of
 * `CompanyInsight`'s unique key, so changing this function does not correct
 * existing rows, it strands them. The cases below pin the behaviour that was
 * already in production when the function was extracted out of
 * `src/lib/extension/company.ts` — they are a fence, not a specification.
 */

import { describe, expect, test } from 'bun:test';
import { canonicalCompanyKey, longestNameToken, normalizeCompanyName, normalizeText } from './companyName';

describe('behaviour pinned from the pre-extraction implementation', () => {
    test.each([
        ['Stripe', 'stripe'],
        ['Stripe Inc', 'stripe'],
        ['ACME LLC', 'acme'],
        ['Foo Corporation', 'foo'],
        ['  Spaced   Out  ', 'spaced out'],
        ['Ünïcode Ltd', 'n code'],
        ['!!!', ''],
        ['', ''],
    ])('%p → %p', (input, expected) => {
        expect(normalizeCompanyName(input)).toBe(expected);
    });

    test('dots and hyphens survive normalisation', () => {
        // `normalizeText` keeps them deliberately — domains and hyphenated
        // names would otherwise be shredded.
        expect(normalizeText('re-flow.io')).toBe('re-flow.io');
    });
});

/**
 * The frozen bug.
 *
 * These are not aspirational. They document what the production key function
 * actually does, so that anyone who "fixes" it sees a red test and has to
 * decide deliberately whether to write the migration that goes with it.
 */
describe('the suffix bug that is now a database key', () => {
    test.each([
        ['Stripe, Inc.', 'stripe .'],
        ['Inc.', '.'],
        ['Acme, Ltd.', 'acme .'],
    ])('%p → %p — the trailing dot survives', (input, expected) => {
        // `(inc|inc\.|...)` lists the bare form first and `\b` matches between
        // the "c" and the ".", so the dot is left behind.
        expect(normalizeCompanyName(input)).toBe(expected);
    });

    test('so these are two different rows in production today', () => {
        expect(normalizeCompanyName('Stripe, Inc.')).not.toBe(normalizeCompanyName('Stripe'));
    });
});

describe('canonicalCompanyKey — the corrected key, for matching only', () => {
    test.each([
        ['Stripe, Inc.', 'stripe'],
        ['Stripe Inc', 'stripe'],
        ['Stripe', 'stripe'],
        ['Acme, Ltd.', 'acme'],
        ['Acme Limited', 'acme'],
        ['Foo Corporation', 'foo'],
        ['Bar Incorporated', 'bar'],
        ['Inc.', ''],
    ])('%p → %p', (input, expected) => {
        expect(canonicalCompanyKey(input)).toBe(expected);
    });

    test('every spelling of one company collapses to one key', () => {
        const spellings = ['Stripe', 'Stripe Inc', 'Stripe, Inc.', 'STRIPE INC.', 'stripe inc'];
        const keys = new Set(spellings.map(canonicalCompanyKey));
        expect(keys.size).toBe(1);
    });

    test('it does not eat a real word that merely contains a suffix', () => {
        // "Incorporated" as a whole word goes; "Income" must not become "ome".
        expect(canonicalCompanyKey('Income Labs')).toBe('income labs');
        expect(canonicalCompanyKey('Coinbase')).toBe('coinbase');
    });
});

describe('longestNameToken', () => {
    test.each([
        ['open ai', 'open'],
        ['the browser company', 'browser'],
        ['stripe', 'stripe'],
        ['', ''],
    ])('%p → %p', (input, expected) => {
        expect(longestNameToken(input)).toBe(expected);
    });

    test('picks the distinctive token, not the first', () => {
        // "the" is a useless SQL prefilter; "browser" is a good one.
        expect(longestNameToken(normalizeCompanyName('The Browser Company'))).toBe('browser');
    });
});
