/**
 * Conservative pay parsing, for one comparison only: does the posting's stated
 * pay reach the user's stated floor?
 *
 * Conservative means: when in doubt, return null, and the check says
 * "unknown". Never convert currencies, never assume a unit that is not
 * written, never compare a monthly figure with an annual one. "₹40" with no
 * unit could be forty rupees or forty lakh; the honest reading is neither.
 */

export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP';
export type PayPeriod = 'year' | 'month' | 'hour';

export type Money = { currency: Currency; min: number; max: number; period: PayPeriod };

function detectCurrency(text: string): Currency | null {
    if (/₹|\binr\b|\brs\.?\s?\d|\blpa\b|\blakhs?\b|\blacs?\b|\bcr(?:ore)?s?\b/i.test(text)) return 'INR';
    if (/\$|\busd\b/i.test(text)) return 'USD';
    if (/€|\beur\b/i.test(text)) return 'EUR';
    if (/£|\bgbp\b/i.test(text)) return 'GBP';
    return null;
}

function detectPeriod(text: string): PayPeriod {
    if (/\b(?:per|an|\/|a)\s*(?:hour|hr)\b|\bhourly\b/i.test(text)) return 'hour';
    if (/\b(?:per|\/|a)\s*(?:month|mo)\b|\bmonthly\b|\bp\.?m\.?\b/i.test(text)) return 'month';
    return 'year';
}

type Figure = { value: number; unit: string };

/** Each number with the unit word written right after it (if any). */
function figures(text: string): Figure[] {
    const out: Figure[] = [];
    const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|lpa|l\b|cr(?:ore)?s?|k\b|m\b|mn\b)?/gi;
    for (const match of text.matchAll(pattern)) {
        const raw = match[1].replace(/,/g, '');
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        out.push({ value, unit: (match[2] ?? '').toLowerCase() });
    }
    return out;
}

function scale(figure: Figure, currency: Currency): number | null {
    const { value, unit } = figure;
    if (/^(?:lakhs?|lacs?|lpa|l)$/.test(unit)) return currency === 'INR' ? value * 1e5 : null;
    if (/^(?:cr|crores?|crs)$/.test(unit)) return currency === 'INR' ? value * 1e7 : null;
    if (unit === 'k') return value * 1e3;
    if (unit === 'm' || unit === 'mn') return value * 1e6;
    return value;
}

/**
 * Parse "₹25–40 LPA", "INR 30,00,000", "$180k - $220k", "40 lakhs".
 *
 * A range shares its trailing unit ("25-40 LPA" is 25 LPA to 40 LPA). A bare
 * small number with no unit is rejected for annual pay — nobody's salary is
 * "40", and guessing which multiplier they meant is the failure this file
 * exists to avoid.
 */
export function parseMoney(text: string | null | undefined): Money | null {
    const source = String(text ?? '').trim();
    if (!source) return null;
    const currency = detectCurrency(source);
    if (!currency) return null;
    const period = detectPeriod(source);

    const found = figures(source).slice(0, 2);
    if (found.length === 0) return null;

    // "25-40 LPA": the first figure inherits the second's unit.
    if (found.length === 2 && !found[0].unit && found[1].unit) found[0] = { ...found[0], unit: found[1].unit };

    const values: number[] = [];
    for (const figure of found) {
        const scaled = scale(figure, currency);
        if (scaled === null) return null;
        if (period === 'year' && !figure.unit && scaled < 1000) return null;
        values.push(scaled);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!(min > 0)) return null;
    return { currency, min, max, period };
}

export type PayComparison = 'meets' | 'below' | 'incomparable';

/** Does the posting's top of range reach the user's floor? */
export function comparePay(posting: Money | null, floor: Money | null): PayComparison {
    if (!posting || !floor) return 'incomparable';
    if (posting.currency !== floor.currency || posting.period !== floor.period) return 'incomparable';
    return posting.max >= floor.min ? 'meets' : 'below';
}
