/**
 * Location normalisation.
 *
 * Every string in the first block is one that appeared verbatim in 302 real
 * postings pulled from Greenhouse and Ashby. They are the reason this module
 * exists: keyed on the raw string, "New York, NY (HQ)" and "New York, NY" —
 * 100 postings of the same market — landed in different band cells, and only
 * 24% of ingested postings reached a usable cell at all.
 */

import { describe, expect, test } from 'bun:test';
import { normalizeGeo } from './geo';

describe('real strings observed in live board data', () => {
    test.each([
        ['New York, NY (HQ)', 'nyc'],
        ['New York, NY', 'nyc'],
        ['San Francisco, CA', 'sf_bay'],
        ['London, England', 'london'],
        ['London', 'london'],
        ['Tokyo, Japan', 'tokyo'],
        ['Singapore', 'singapore'],
        ['Paris, France', 'paris'],
        ['Berlin, Germany', 'berlin'],
        ['Tel Aviv, Israel', 'tel_aviv'],
        ['São Paulo, Brazil', 'sao_paulo'],
        ['Bengaluru, India', 'bengaluru'],
        ['Sydney, Australia', 'sydney'],
    ])('%s → %s', (raw, bucket) => {
        expect(normalizeGeo(raw).bucket).toBe(bucket);
    });

    test('the (HQ) marker does not split a market in two', () => {
        // 95 postings said "New York, NY (HQ)" and 5 said "New York, NY".
        // Before this module they were different cells.
        expect(normalizeGeo('New York, NY (HQ)').bucket).toBe(normalizeGeo('New York, NY').bucket);
    });
});

describe('multi-site postings', () => {
    test('several metros with one range get their own bucket', () => {
        // 90 real postings, the second-largest group. One salary range across
        // three sites cannot honestly be attributed to any one of them.
        const out = normalizeGeo('San Francisco, CA • New York, NY • United States');
        expect(out.kind).toBe('multi');
        expect(out.bucket).toBe('multi_us');
    });

    test('a multi bucket is never pooled with a single metro', () => {
        expect(normalizeGeo('San Francisco, CA • New York, NY • United States').bucket)
            .not.toBe(normalizeGeo('San Francisco, CA').bucket);
    });

    test('multi buckets are scoped by region, so US and EU do not mix', () => {
        const us = normalizeGeo('San Francisco, CA • New York, NY • United States');
        const eu = normalizeGeo('Berlin, Germany • Munich, Germany • Germany');
        expect(us.bucket).not.toBe(eu.bucket);
    });

    test('one market written twice is not multi-site', () => {
        // "San Francisco, CA • Bay Area" is one place, listed twice.
        const out = normalizeGeo('San Francisco, CA • Bay Area');
        expect(out.kind).toBe('metro');
        expect(out.bucket).toBe('sf_bay');
    });

    test('two real metros in the same country still count as multi', () => {
        const out = normalizeGeo('Sydney, Australia • Melbourne, Australia');
        expect(out.kind).toBe('multi');
    });
});

describe('remote', () => {
    test('remote is scoped to the market it names', () => {
        const out = normalizeGeo('Remote (US)');
        expect(out.kind).toBe('remote');
        expect(out.bucket).toBe('remote_us');
    });

    test('a differently-scoped remote is a different market', () => {
        expect(normalizeGeo('Remote (US)').bucket).not.toBe(normalizeGeo('Remote (Sweden)').bucket);
    });

    test('unscoped remote is its own global bucket', () => {
        expect(normalizeGeo('Remote').bucket).toBe('remote_global');
    });

    test('remote is never pooled with the office in the same city', () => {
        // A remote range and an on-site London range are different markets.
        expect(normalizeGeo('Remote (London)').bucket).not.toBe(normalizeGeo('London').bucket);
    });
});

describe('refusing to place a posting', () => {
    test('an unreadable location yields no bucket', () => {
        // Costs one row. Placing it wrongly corrupts a number someone reads
        // as their market worth.
        expect(normalizeGeo('Planet Earth').bucket).toBeNull();
        expect(normalizeGeo('').bucket).toBeNull();
        expect(normalizeGeo(null).bucket).toBeNull();
        expect(normalizeGeo(undefined).bucket).toBeNull();
    });

    test('a country with no metro is a region, not a guess at its capital', () => {
        const out = normalizeGeo('Japan');
        expect(out.kind).toBe('region');
        expect(out.bucket).toBe('japan');
    });
});

describe('stability', () => {
    test('the same input always yields the same bucket', () => {
        // A band that moves cities between runs is worse than one that admits
        // it cannot place a posting.
        const runs = Array.from({ length: 5 }, () => normalizeGeo('New York, NY (HQ)').bucket);
        expect(new Set(runs).size).toBe(1);
    });

    test('case and padding do not change the answer', () => {
        expect(normalizeGeo('  NEW YORK, NY  ').bucket).toBe(normalizeGeo('New York, NY').bucket);
    });
});
