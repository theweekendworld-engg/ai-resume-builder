/**
 * Market band arithmetic.
 *
 * The tests that matter most here are the ones asserting we REFUSE. A band is
 * a claim about someone's worth; the failure mode this file guards against is
 * emitting a confident number from three postings.
 */

import { describe, expect, test } from 'bun:test';
import {
    bandProvenance,
    computeBand,
    MIN_OBSERVATIONS,
    percentile,
    positionInBand,
    type BandObservation,
} from './band';

const DAY = 86_400_000;

function obs(
    annualLow: number,
    annualHigh: number,
    currency = 'USD',
    daysAgo = 10,
): BandObservation {
    return { annualLow, annualHigh, currency, postedAt: new Date(Date.now() - daysAgo * DAY) };
}

/** n identical-ish observations, spread slightly so percentiles are meaningful. */
function spread(n: number, base = 150_000, currency = 'USD'): BandObservation[] {
    return Array.from({ length: n }, (_, i) =>
        obs(base + i * 1_000, base + 40_000 + i * 1_000, currency),
    );
}

describe('percentile', () => {
    test('interpolates rather than snapping to nearest rank', () => {
        // Nearest-rank would return 10 or 20; the honest answer is between.
        expect(percentile([10, 20], 50)).toBe(15);
    });

    test('p10 and p90 do not collapse onto min and max at n=8', () => {
        // This is the whole reason for interpolation: at small n, nearest-rank
        // percentiles are just the outliers again.
        const sorted = [1, 2, 3, 4, 5, 6, 7, 100];
        expect(percentile(sorted, 90)).toBeLessThan(100);
        expect(percentile(sorted, 10)).toBeGreaterThan(1);
    });

    test('single value is its own percentile', () => {
        expect(percentile([42], 10)).toBe(42);
        expect(percentile([42], 90)).toBe(42);
    });

    test('empty input throws rather than returning a silent zero', () => {
        expect(() => percentile([], 50)).toThrow();
    });
});

describe('computeBand — refusals', () => {
    test('no data refuses with no_data', () => {
        const r = computeBand([]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.refusal.reason).toBe('no_data');
    });

    test('below the honesty floor refuses and says what was needed', () => {
        const r = computeBand(spread(MIN_OBSERVATIONS - 1));
        expect(r.ok).toBe(false);
        if (!r.ok && r.refusal.reason === 'insufficient_data') {
            expect(r.refusal.n).toBe(MIN_OBSERVATIONS - 1);
            expect(r.refusal.needed).toBe(MIN_OBSERVATIONS);
        } else {
            throw new Error('expected insufficient_data');
        }
    });

    test('exactly at the floor is allowed', () => {
        expect(computeBand(spread(MIN_OBSERVATIONS)).ok).toBe(true);
    });

    test('enough rows but no single currency at the floor refuses', () => {
        // 12 observations, but split 6/6 — converting would be the easy,
        // wrong answer.
        const mixed = [...spread(6, 150_000, 'USD'), ...spread(6, 120_000, 'EUR')];
        const r = computeBand(mixed);
        expect(r.ok).toBe(false);
        if (!r.ok && r.refusal.reason === 'currency_split') {
            expect(r.refusal.n).toBe(12);
            expect(r.refusal.largestGroup).toBe(6);
        } else {
            throw new Error('expected currency_split');
        }
    });
});

describe('computeBand — a real band', () => {
    const band = (() => {
        const r = computeBand(spread(20));
        if (!r.ok) throw new Error('expected a band');
        return r.band;
    })();

    test('reports n, currency and the window it used', () => {
        expect(band.n).toBe(20);
        expect(band.currency).toBe('USD');
        expect(band.windowStart.getTime()).toBeLessThanOrEqual(band.windowEnd.getTime());
    });

    test('low < median < high', () => {
        expect(band.low).toBeLessThan(band.median);
        expect(band.median).toBeLessThan(band.high);
    });

    test('one absurd outlier does not define the top of the band', () => {
        const withOutlier = [...spread(20), obs(150_000, 5_000_000)];
        const r = computeBand(withOutlier);
        if (!r.ok) throw new Error('expected a band');
        // p90 must stay in the neighbourhood of the real market, not chase the
        // outlier the way max() would.
        expect(r.band.high).toBeLessThan(1_000_000);
    });

    test('minority-currency rows are dropped, counted, and never converted', () => {
        const mixed = [...spread(15, 150_000, 'USD'), ...spread(3, 120_000, 'EUR')];
        const r = computeBand(mixed);
        if (!r.ok) throw new Error('expected a band');
        expect(r.band.currency).toBe('USD');
        expect(r.band.n).toBe(15);
        expect(r.band.droppedForCurrency).toBe(3);
    });

    test('currency grouping is deterministic on a tie', () => {
        // Equal-sized groups must not depend on input order.
        const a = computeBand([...spread(10, 150_000, 'USD'), ...spread(10, 140_000, 'CAD')]);
        const b = computeBand([...spread(10, 140_000, 'CAD'), ...spread(10, 150_000, 'USD')]);
        if (!a.ok || !b.ok) throw new Error('expected bands');
        expect(a.band.currency).toBe(b.band.currency);
    });
});

describe('positionInBand', () => {
    const band = (() => {
        const r = computeBand(spread(20));
        if (!r.ok) throw new Error('expected a band');
        return r.band;
    })();

    test('classifies coarsely, never as a false-precision percentile', () => {
        expect(positionInBand(band.low - 1, band)).toBe('below');
        expect(positionInBand(band.high + 1, band)).toBe('above');
        expect(positionInBand(band.median - 1, band)).toBe('lower_half');
        expect(positionInBand(band.median + 1, band)).toBe('upper_half');
    });

    test('the band edges are inside the band', () => {
        expect(positionInBand(band.low, band)).not.toBe('below');
        expect(positionInBand(band.high, band)).not.toBe('above');
    });
});

describe('bandProvenance', () => {
    test('always states n and the window, so the claim is checkable', () => {
        const r = computeBand(spread(14));
        if (!r.ok) throw new Error('expected a band');
        const line = bandProvenance(r.band);
        expect(line).toContain('14');
        expect(line).toMatch(/last \d+ days/);
    });

    test('singular for a one-day window is not mangled', () => {
        const r = computeBand(spread(9));
        if (!r.ok) throw new Error('expected a band');
        expect(bandProvenance(r.band)).toContain('ranges');
    });
});
