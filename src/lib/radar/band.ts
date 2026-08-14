/**
 * Market band arithmetic (PRD 04 §2).
 *
 * This module decides what number a user is shown about their own worth, so
 * its job is as much about REFUSING to answer as answering. Every rule below
 * exists because the alternative is a confident wrong number:
 *
 *   1. Never fewer than 8 observations (`MIN_OBSERVATIONS`). Under that, a
 *      band is one company's opinion wearing a statistic's clothing.
 *   2. Never mix currencies. We do not convert (§3.1) — a stale FX rate
 *      corrupts every band built on it — so a mixed pool is split, and the
 *      largest single-currency group wins.
 *   3. Always report `n`, the window, and the geography alongside the band.
 *      A band without its provenance is not checkable, and unfalsifiable
 *      numbers are exactly what this product exists not to produce.
 *   4. Percentiles, not min/max. One outlier posting should not define an
 *      edge, and p10/p90 is the honest shape of a market.
 *
 * When there is not enough data the correct output is a refusal carrying the
 * reason, so the UI can say "not enough public data for Staff Backend in
 * Bangalore — here's the Senior band instead" rather than rendering an empty
 * card (§2.1 rule 3).
 */

/** §2: suppress below this. Not a tunable — it is the honesty floor. */
export const MIN_OBSERVATIONS = 8;

/** One posting's contribution to a band. */
export type BandObservation = {
    annualLow: number;
    annualHigh: number;
    currency: string;
    /** Drives recency weighting and the reported window. */
    postedAt: Date;
};

export type MarketBand = {
    /** p10 of the disclosed lows — the bottom of the believable range. */
    low: number;
    /** Midpoint of the medians, the single most defensible "typical". */
    median: number;
    /** p90 of the disclosed highs. */
    high: number;
    currency: string;
    /** Observations actually used, after currency filtering. */
    n: number;
    /** Inclusive bounds of the data actually used. */
    windowStart: Date;
    windowEnd: Date;
    /** Observations discarded because they were in a minority currency. */
    droppedForCurrency: number;
};

export type BandRefusal =
    | { reason: 'no_data'; n: 0 }
    /** Some data, but under the honesty floor. */
    | { reason: 'insufficient_data'; n: number; needed: number }
    /** Enough rows, but no single currency reached the floor. */
    | { reason: 'currency_split'; n: number; largestGroup: number; needed: number };

export type BandResult =
    | { ok: true; band: MarketBand }
    | { ok: false; refusal: BandRefusal };

/**
 * Linear-interpolated percentile over a sorted array.
 *
 * Interpolating rather than nearest-rank matters at these sample sizes: with
 * n=8, nearest-rank p10 and p90 collapse onto the actual min and max, which is
 * precisely the outlier sensitivity percentiles were chosen to avoid.
 */
export function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) throw new Error('percentile: empty input');
    if (sorted.length === 1) return sorted[0];

    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

/** Group by currency and return the largest group. We never convert. */
function dominantCurrency(observations: readonly BandObservation[]): {
    currency: string;
    group: BandObservation[];
    dropped: number;
} {
    const groups = new Map<string, BandObservation[]>();
    for (const o of observations) {
        const key = o.currency.toUpperCase();
        const bucket = groups.get(key);
        if (bucket) bucket.push(o);
        else groups.set(key, [o]);
    }

    let best: { currency: string; group: BandObservation[] } = { currency: 'UNKNOWN', group: [] };
    for (const [currency, group] of groups) {
        // Ties broken by currency name purely so the result is deterministic.
        if (
            group.length > best.group.length ||
            (group.length === best.group.length && currency < best.currency)
        ) {
            best = { currency, group };
        }
    }
    return { ...best, dropped: observations.length - best.group.length };
}

/**
 * Compute a publishable band, or an explained refusal.
 *
 * Callers must handle the refusal — there is deliberately no "best effort"
 * band, because the whole value of this number is that we declined to invent
 * it when we could not support it.
 */
export function computeBand(observations: readonly BandObservation[]): BandResult {
    if (observations.length === 0) {
        return { ok: false, refusal: { reason: 'no_data', n: 0 } };
    }
    if (observations.length < MIN_OBSERVATIONS) {
        return {
            ok: false,
            refusal: { reason: 'insufficient_data', n: observations.length, needed: MIN_OBSERVATIONS },
        };
    }

    const { currency, group, dropped } = dominantCurrency(observations);
    if (group.length < MIN_OBSERVATIONS) {
        return {
            ok: false,
            refusal: {
                reason: 'currency_split',
                n: observations.length,
                largestGroup: group.length,
                needed: MIN_OBSERVATIONS,
            },
        };
    }

    const lows = group.map((o) => o.annualLow).sort((a, b) => a - b);
    const highs = group.map((o) => o.annualHigh).sort((a, b) => a - b);
    const midpoints = group.map((o) => (o.annualLow + o.annualHigh) / 2).sort((a, b) => a - b);

    const times = group.map((o) => o.postedAt.getTime());

    return {
        ok: true,
        band: {
            low: Math.round(percentile(lows, 10)),
            median: Math.round(percentile(midpoints, 50)),
            high: Math.round(percentile(highs, 90)),
            currency,
            n: group.length,
            windowStart: new Date(Math.min(...times)),
            windowEnd: new Date(Math.max(...times)),
            droppedForCurrency: dropped,
        },
    };
}

/**
 * Where a user's own compensation sits in a band, as a coarse verdict.
 *
 * Deliberately coarse. The underlying data cannot support "you are at the 63rd
 * percentile", and saying so would be false precision — the same failure mode
 * as a fabricated metric in a resume bullet.
 */
export type BandPosition = 'below' | 'lower_half' | 'upper_half' | 'above';

export function positionInBand(amount: number, band: MarketBand): BandPosition {
    if (amount < band.low) return 'below';
    if (amount > band.high) return 'above';
    return amount < band.median ? 'lower_half' : 'upper_half';
}

/**
 * The provenance line that must accompany any rendered band (§2.1 rule 2).
 * Exported so it cannot be reimplemented — and quietly dropped — in a view.
 */
export function bandProvenance(band: MarketBand): string {
    const days = Math.max(
        1,
        Math.round((band.windowEnd.getTime() - band.windowStart.getTime()) / 86_400_000),
    );
    return `Based on ${band.n} disclosed range${band.n === 1 ? '' : 's'}, last ${days} days.`;
}
