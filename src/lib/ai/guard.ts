/**
 * The numeric / quantity guard — PRD 08 §5.1, ADR-6.
 *
 *   "No generated artifact may contain a number, scope, or outcome that does
 *    not appear in its source material."
 *
 * This file is the enforcement. It is pure (no IO, no model calls, no clock)
 * and every branch is testable — see `guard.test.ts`.
 *
 * ── Design posture ────────────────────────────────────────────────────────
 * The two failure modes are not symmetric:
 *
 *   • Under-flagging (letting a fabricated number through) is a product-integrity
 *     failure. It is the thing this whole file exists to prevent.
 *   • Over-flagging (rejecting a number that was legitimately in the source) costs
 *     one corrective retry and, worst case, a stripped field marked `degraded`.
 *
 * So every ambiguous judgement in here resolves toward flagging. Notably:
 *   - a percentage in the output must be a percentage in the source. It may NOT be
 *     computed from two numbers that are in the source. "800ms → 180ms" does not
 *     license "77%". Derived numbers are fabricated numbers.
 *   - a bare number is the weakest claim, so it may match any source quantity of
 *     equal value (a bare "1200000" is sourced by "$1.2M").
 *   - unit-ambiguous suffixes resolve to the interpretation that is harder to satisfy.
 */

// ───────────────────────────────────────────────────────────── types

export type QuantityKind =
    | 'percent'
    | 'currency'
    | 'multiplier'
    | 'fraction'
    | 'duration'
    | 'size'
    | 'number'
    | 'year'
    | 'date'
    | 'version'
    | 'range';

export type Quantity = {
    /** the matched text, post-normalization */
    raw: string;
    kind: QuantityKind;
    /** canonical comparable value: ms for durations, bytes for sizes, base units otherwise */
    value: number;
    /** the numeric literal exactly as written, before unit conversion ("0.8" in "0.8s") */
    literal: number;
    /** '%', a currency code, 'ms', 'bytes' — used to reject cross-currency swaps */
    unit?: string;
    /** for kinds with no meaningful numeric value (date, version) */
    text?: string;
    /** offset into the normalized text */
    index: number;
    /** range endpoints; a range is supported only if every part is supported */
    parts?: Quantity[];
};

export type NumericGuard = {
    /** everything the model was allowed to draw numbers from */
    sourceText: string;
    /** output fields to police; dot paths supported ("summary", "bullets", "sections.0.body") */
    fields: string[];
    /**
     * Treat 4-digit years as metrics that must appear in the source.
     * Default false: per P0.4, "a year is not a metric". Fabricated dates are caught by
     * grounding (ClaimLink), not by this guard. Turn on for date-sensitive surfaces.
     */
    enforceYears?: boolean;
};

export type GuardViolation = {
    /** dot path of the offending leaf, e.g. "bullets.2" */
    path: string;
    /** the guard field that owns it, e.g. "bullets" */
    field: string;
    /** the string the quantity was found in */
    text: string;
    quantity: Quantity;
};

export type GuardCheckResult = {
    ok: boolean;
    violations: GuardViolation[];
    /** distinct guard fields that had at least one violation */
    violatingFields: string[];
    /** distinct leaf paths that had at least one violation */
    violatingPaths: string[];
};

// ───────────────────────────────────────────────────────────── normalization

/**
 * Decimal-digit block starts. Every Unicode Nd block is a contiguous run of ten,
 * so `code - start` is the digit's value. NFKC already folds fullwidth and
 * mathematical digits; these are the ones it leaves alone.
 */
const DIGIT_BLOCK_STARTS = [
    0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66,
    0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810,
    0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0,
    0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10,
];

/** ½ and friends, folded before NFKC turns them into "1⁄2". */
const VULGAR_FRACTIONS: Record<string, string> = {
    '½': '0.5',
    '⅓': '0.3333333333',
    '⅔': '0.6666666667',
    '¼': '0.25',
    '¾': '0.75',
    '⅕': '0.2',
    '⅖': '0.4',
    '⅗': '0.6',
    '⅘': '0.8',
    '⅙': '0.1666666667',
    '⅚': '0.8333333333',
    '⅛': '0.125',
    '⅜': '0.375',
    '⅝': '0.625',
    '⅞': '0.875',
};

function foldUnicodeDigits(text: string): string {
    let out = '';
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 128) {
            out += char;
            continue;
        }
        if (!/\p{Nd}/u.test(char)) {
            out += char;
            continue;
        }
        const start = DIGIT_BLOCK_STARTS.find((base) => code >= base && code <= base + 9);
        out += start === undefined ? char : String(code - start);
    }
    return out;
}

/**
 * Canonical text form. Applied identically to source and output so the two sides
 * are always compared in the same alphabet.
 */
export function normalizeText(input: string): string {
    let text = String(input ?? '');

    for (const [glyph, decimal] of Object.entries(VULGAR_FRACTIONS)) {
        if (text.includes(glyph)) text = text.split(glyph).join(decimal);
    }

    text = text.normalize('NFKC');
    text = foldUnicodeDigits(text);

    text = text
        // NBSP-family characters used as thousands separators are separators, not spaces:
        // "1 200 000" is one figure. Must run before the generic NBSP → space fold.
        .replace(/(?<=\d)[     ](?=\d{3}(?!\d))/g, '')
        // arrows are NOT range separators — "800ms -> 180ms" is two measurements,
        // not an interval, and must never be read as one.
        .replace(/[→➔➡⇒]|=>/g, ' -> ')
        // dashes and the real minus sign collapse to ASCII hyphen
        .replace(/[‐-―−]/g, '-')
        .replace(/[×✕]/g, 'x')
        .replace(/[⁄]/g, '/')
        // NBSP family
        .replace(/[     ]/g, ' ')
        // zero-width characters are a trivial way to smuggle "7​7%" past a naive check
        .replace(/[​‌‍﻿]/g, '')
        .replace(/[‘’‛]/g, "'")
        .replace(/[“”]/g, '"')
        .toLowerCase()
        .replace(/[ \t\r\n]+/g, ' ')
        .trim();

    return text;
}

// ───────────────────────────────────────────────────────────── unit tables

/** scale suffixes / words applied to a plain or currency number */
const SCALES: Record<string, number> = {
    k: 1e3,
    thousand: 1e3,
    m: 1e6,
    mm: 1e6,
    million: 1e6,
    b: 1e9,
    bn: 1e9,
    billion: 1e9,
    t: 1e12,
    trillion: 1e12,
};

/** duration units → milliseconds */
const DURATION_MS: Record<string, number> = {
    ns: 1e-6,
    nanosecond: 1e-6,
    nanoseconds: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    microsecond: 1e-3,
    microseconds: 1e-3,
    ms: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
    wk: 604_800_000,
    wks: 604_800_000,
    week: 604_800_000,
    weeks: 604_800_000,
    month: 2_592_000_000,
    months: 2_592_000_000,
    yr: 31_536_000_000,
    yrs: 31_536_000_000,
    year: 31_536_000_000,
    years: 31_536_000_000,
};

/** data-size units → bytes (so "500mb" and "0.5gb" are the same claim) */
const SIZE_BYTES: Record<string, number> = {
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    pb: 1e15,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    byte: 1,
    bytes: 1,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
    $: 'usd',
    '€': 'eur',
    '£': 'gbp',
    '¥': 'jpy',
    '₹': 'inr',
    '₩': 'krw',
};

const CURRENCY_WORDS: Record<string, string> = {
    usd: 'usd',
    dollar: 'usd',
    dollars: 'usd',
    eur: 'eur',
    euro: 'eur',
    euros: 'eur',
    gbp: 'gbp',
    pound: 'gbp',
    pounds: 'gbp',
    inr: 'inr',
    rupee: 'inr',
    rupees: 'inr',
    jpy: 'jpy',
    yen: 'jpy',
};

const SPELLED_UNITS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const SPELLED_TENS: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
};

/** written quantity phrases → { kind, value } */
const WRITTEN_QUANTITIES: Array<{ phrase: string; kind: QuantityKind; value: number }> = [
    { phrase: 'quadrupled', kind: 'multiplier', value: 4 },
    { phrase: 'quadruple', kind: 'multiplier', value: 4 },
    { phrase: 'quadrupling', kind: 'multiplier', value: 4 },
    { phrase: 'tripled', kind: 'multiplier', value: 3 },
    { phrase: 'tripling', kind: 'multiplier', value: 3 },
    { phrase: 'triple', kind: 'multiplier', value: 3 },
    { phrase: 'doubled', kind: 'multiplier', value: 2 },
    { phrase: 'doubling', kind: 'multiplier', value: 2 },
    { phrase: 'double', kind: 'multiplier', value: 2 },
    { phrase: 'thrice', kind: 'multiplier', value: 3 },
    { phrase: 'twice', kind: 'multiplier', value: 2 },
    { phrase: 'order of magnitude', kind: 'multiplier', value: 10 },
    { phrase: 'three quarters', kind: 'fraction', value: 0.75 },
    { phrase: 'three-quarters', kind: 'fraction', value: 0.75 },
    { phrase: 'two thirds', kind: 'fraction', value: 2 / 3 },
    { phrase: 'two-thirds', kind: 'fraction', value: 2 / 3 },
    { phrase: 'a third', kind: 'fraction', value: 1 / 3 },
    { phrase: 'one third', kind: 'fraction', value: 1 / 3 },
    { phrase: 'one-third', kind: 'fraction', value: 1 / 3 },
    { phrase: 'a quarter', kind: 'fraction', value: 0.25 },
    { phrase: 'one quarter', kind: 'fraction', value: 0.25 },
    { phrase: 'one-quarter', kind: 'fraction', value: 0.25 },
    { phrase: 'halved', kind: 'fraction', value: 0.5 },
    { phrase: 'halving', kind: 'fraction', value: 0.5 },
    { phrase: 'in half', kind: 'fraction', value: 0.5 },
    { phrase: 'a half', kind: 'fraction', value: 0.5 },
    { phrase: 'one half', kind: 'fraction', value: 0.5 },
    { phrase: 'half', kind: 'fraction', value: 0.5 },
];

/**
 * Words that follow a spelled-out number without making it a measurement.
 * "one of the services" is prose; "one service" is a count.
 */
const SPELLED_STOPWORDS = new Set([
    'of', 'the', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'by', 'for', 'with',
    'that', 'which', 'who', 'thing', 'way', 'ways', 'more', 'less', 'other',
    'others', 'another', 'such', 'is', 'was', 'were', 'are', 'as', 'at', 'from',
    'but', 'so', 'if', 'then', 'than', 'time',
]);

// ───────────────────────────────────────────────────────────── small helpers

function toNumber(literal: string): number {
    return Number(literal.replace(/,/g, ''));
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[\p{L}\p{Nd}_]/u.test(char);
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;

/**
 * A single-letter scale suffix must be glued to its digits ("1.2m"); only the
 * spelled-out form may be spaced ("1.2 million"). Without that rule "5 m of cable"
 * reads as five million and produces a bogus violation.
 * Groups: [letter scale, word scale].
 */
const SCALE = String.raw`(?:(k|mm|m|bn|b|t)|\s*(thousand|million|billion|trillion))?`;

function scaleFactor(letter: string | undefined, word: string | undefined): number {
    const key = letter ?? word;
    if (!key) return 1;
    return SCALES[key] ?? 1;
}

/**
 * Escape the regex SYNTAX characters in `s`, and only those.
 *
 * Escaping indiscriminately (`\\${s}` for every character) is the obvious
 * version and it is wrong under the `u` flag: `\€` is an identity escape on a
 * non-syntax character, which Annex B tolerates but Unicode mode forbids. The
 * resulting pattern is a SyntaxError at construction.
 *
 * That distinction is invisible to this repo's test suite. Bun runs on
 * JavaScriptCore, which accepts `\€`; the app runs on Node, whose V8 rejects
 * it. So the broken form passed every unit test and then threw on the first
 * real request — and because the numeric guard is fail-closed, it took every
 * AI win path down with it. Keep this function; do not inline a `\\${...}`.
 */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function sticky(pattern: string): RegExp {
    return new RegExp(pattern, 'uy');
}

/** classify a bare digit run that carried no unit */
function classifyBareNumber(literal: string, value: number, after: string): QuantityKind {
    const isPlainFourDigit = /^\d{4}$/.test(literal);
    if (!isPlainFourDigit || value < 1900 || value > 2099) return 'number';

    // "2024 users" is a count that happens to look like a year. "in 2024 we shipped" is a year.
    const nextWord = after.trim().split(/[^\p{L}]/u)[0] ?? '';
    if (nextWord.length > 3 && nextWord.endsWith('s')) return 'number';
    return 'year';
}

// ───────────────────────────────────────────────────────────── extraction

export type ExtractMode = 'strict' | 'lenient';

type Matcher = (text: string, index: number, mode: ExtractMode) => { quantities: Quantity[]; length: number } | null;

function makeQuantity(
    partial: Omit<Quantity, 'index' | 'raw'> & Partial<Pick<Quantity, 'raw'>>,
    raw: string,
    index: number,
): Quantity {
    return { ...partial, raw: partial.raw ?? raw, index };
}

// order matters: the first matcher that fires at a position wins and consumes.
const MATCHERS: Matcher[] = [
    // ISO date — must precede the number matcher, or "2024-01-15" becomes a range.
    (text, index) => {
        const re = sticky(String.raw`\d{4}-\d{2}-\d{2}`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        return {
            length: m[0].length,
            quantities: [
                makeQuantity({ kind: 'date', value: NaN, literal: NaN, text: m[0] }, m[0], index),
            ],
        };
    },

    // semver / version — "v2.1.0" is an identifier, not three numbers.
    (text, index) => {
        const re = sticky(String.raw`v\d+(?:\.\d+)+|\d+\.\d+\.\d+`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        return {
            length: m[0].length,
            quantities: [
                makeQuantity({ kind: 'version', value: NaN, literal: NaN, text: m[0].replace(/^v/, '') }, m[0], index),
            ],
        };
    },

    // currency, symbol-prefixed: "$1.2m", "€ 450k", "$1,200,000"
    (text, index) => {
        const symbols = Object.keys(CURRENCY_SYMBOLS).map(escapeRegExp).join('|');
        const re = sticky(String.raw`(${symbols})\s?(${NUM})${SCALE}(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const scale = scaleFactor(m[3], m[4]);
        const literal = toNumber(m[2]);
        return {
            length: m[0].length,
            quantities: [
                makeQuantity(
                    { kind: 'currency', value: literal * scale, literal, unit: CURRENCY_SYMBOLS[m[1]] },
                    m[0],
                    index,
                ),
            ],
        };
    },

    // currency, word-suffixed: "1.2m usd", "450 dollars"
    (text, index) => {
        const words = Object.keys(CURRENCY_WORDS).sort((a, b) => b.length - a.length).join('|');
        const re = sticky(String.raw`(${NUM})${SCALE}\s*(${words})(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const scale = scaleFactor(m[2], m[3]);
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [
                makeQuantity(
                    { kind: 'currency', value: literal * scale, literal, unit: CURRENCY_WORDS[m[4]] },
                    m[0],
                    index,
                ),
            ],
        };
    },

    // percent: "77%", "77 percent", "77 pct"
    (text, index) => {
        const re = sticky(String.raw`(${NUM})\s*(?:%|percent|per cent|pct)(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [makeQuantity({ kind: 'percent', value: literal, literal, unit: '%' }, m[0], index)],
        };
    },

    // percentage points: "12pp" / "12 percentage points" — a different claim from "12%"
    (text, index) => {
        const re = sticky(String.raw`(${NUM})\s*(?:pp|percentage points?)(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [makeQuantity({ kind: 'percent', value: literal, literal, unit: 'pp' }, m[0], index)],
        };
    },

    // multiplier: "3x", "3-fold", "3 times"
    (text, index) => {
        const re = sticky(String.raw`(${NUM})\s*(?:x|-\s*fold|\s*fold|\s*times)(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [makeQuantity({ kind: 'multiplier', value: literal, literal }, m[0], index)],
        };
    },

    // duration: "800ms", "0.8 s", "3 weeks"
    (text, index) => {
        const units = Object.keys(DURATION_MS)
            .sort((a, b) => b.length - a.length)
            .join('|');
        const re = sticky(String.raw`(${NUM})\s*(${units})(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [
                makeQuantity({ kind: 'duration', value: literal * DURATION_MS[m[2]], literal, unit: 'ms' }, m[0], index),
            ],
        };
    },

    // data size: "500mb", "1.5 gib"
    (text, index) => {
        const units = Object.keys(SIZE_BYTES)
            .sort((a, b) => b.length - a.length)
            .join('|');
        const re = sticky(String.raw`(${NUM})\s*(${units})(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const literal = toNumber(m[1]);
        return {
            length: m[0].length,
            quantities: [
                makeQuantity({ kind: 'size', value: literal * SIZE_BYTES[m[2]], literal, unit: 'bytes' }, m[0], index),
            ],
        };
    },

    // explicit fraction: "1/3", "2 / 3" — but not "3/4/2024" and not "km/h"
    (text, index) => {
        const re = sticky(String.raw`(\d{1,4})\s*/\s*(\d{1,4})(?![\d/.\-])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        // "24/7" is an availability idiom, not a ratio, and it is everywhere in this domain.
        if (m[0].replace(/\s+/g, '') === '24/7') return { length: m[0].length, quantities: [] };
        const numerator = Number(m[1]);
        const denominator = Number(m[2]);
        if (denominator === 0) return null;
        return {
            length: m[0].length,
            quantities: [
                makeQuantity({ kind: 'fraction', value: numerator / denominator, literal: numerator }, m[0], index),
            ],
        };
    },

    // range: "10-15", "10 to 15", "10-15%" — every endpoint must be sourced.
    (text, index) => {
        const re = sticky(String.raw`(${NUM})\s*(?:-|to)\s*(${NUM})\s*(%|x)?(?![\p{L}\d])`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const suffix = m[3];
        const build = (literalText: string, offset: number): Quantity => {
            const literal = toNumber(literalText);
            if (suffix === '%') {
                return makeQuantity({ kind: 'percent', value: literal, literal, unit: '%' }, literalText, offset);
            }
            if (suffix === 'x') {
                return makeQuantity({ kind: 'multiplier', value: literal, literal }, literalText, offset);
            }
            const rest = text.slice(offset + literalText.length);
            const kind = classifyBareNumber(literalText, literal, rest);
            return makeQuantity({ kind, value: literal, literal }, literalText, offset);
        };
        const parts = [build(m[1], index), build(m[2], index + m[0].indexOf(m[2]))];
        return {
            length: m[0].length,
            quantities: [makeQuantity({ kind: 'range', value: NaN, literal: NaN, parts }, m[0], index)],
        };
    },

    // plain number, with optional scale suffix/word: "1,200,000", "450k", "1.2 million"
    (text, index) => {
        // the `\.\d` in the lookahead stops NUM from backtracking out of a decimal:
        // "98.6f" must extract nothing, not the number 98.
        const re = sticky(String.raw`(${NUM})${SCALE}(?![\p{L}\d]|\.\d)`);
        re.lastIndex = index;
        const m = re.exec(text);
        if (!m) return null;
        const scale = scaleFactor(m[2], m[3]);
        const literal = toNumber(m[1]);
        const value = literal * scale;
        const rest = text.slice(index + m[0].length);
        const kind = m[2] || m[3] ? 'number' : classifyBareNumber(m[1], value, rest);
        return {
            length: m[0].length,
            quantities: [makeQuantity({ kind, value, literal }, m[0], index)],
        };
    },

    // written quantities: "doubled", "halved", "a third"
    (text, index) => {
        for (const entry of WRITTEN_QUANTITIES) {
            if (!text.startsWith(entry.phrase, index)) continue;
            const after = text[index + entry.phrase.length];
            if (isWordChar(after)) continue;
            return {
                length: entry.phrase.length,
                quantities: [
                    makeQuantity({ kind: entry.kind, value: entry.value, literal: entry.value }, entry.phrase, index),
                ],
            };
        }
        return null;
    },

    // spelled-out numbers: "three times", "fifty percent", "two million", "three engineers"
    (text, index, mode) => matchSpelledNumber(text, index, mode),
];

/**
 * Spelled-out numeric phrases.
 *
 * In `strict` mode (model output) a spelled number only counts when it carries
 * quantity context — a unit, a scale word, "times"/"percent", or a plural noun.
 * Otherwise every "one of the" in ordinary prose becomes a fabricated `1`.
 *
 * In `lenient` mode (source text) everything counts: extra source quantities can
 * only ever permit a match, never cause a violation, so the source side is greedy.
 */
function matchSpelledNumber(
    text: string,
    index: number,
    mode: ExtractMode,
): { quantities: Quantity[]; length: number } | null {
    const slice = text.slice(index);
    const wordRe = /^([a-z]+)([- ]|$)/;

    let cursor = 0;
    let total: number | null = null;

    // tens (+ optional unit): "twenty-five"
    const m = wordRe.exec(slice.slice(cursor));
    if (!m) return null;
    if (SPELLED_TENS[m[1]] !== undefined) {
        total = SPELLED_TENS[m[1]];
        cursor += m[1].length;
        const sep = slice[cursor];
        if (sep === '-' || sep === ' ') {
            const next = wordRe.exec(slice.slice(cursor + 1));
            if (next && SPELLED_UNITS[next[1]] !== undefined && SPELLED_UNITS[next[1]] < 10) {
                total += SPELLED_UNITS[next[1]];
                cursor += 1 + next[1].length;
            }
        }
    } else if (SPELLED_UNITS[m[1]] !== undefined) {
        total = SPELLED_UNITS[m[1]];
        cursor += m[1].length;
    } else {
        return null;
    }

    // scale word: "two million"
    let sawScale = false;
    const afterNumber = slice.slice(cursor);
    const scaleMatch = /^ (hundred|thousand|million|billion|trillion)(?![\p{L}\d])/u.exec(afterNumber);
    if (scaleMatch) {
        const scale = scaleMatch[1] === 'hundred' ? 100 : SCALES[scaleMatch[1]];
        total *= scale;
        cursor += scaleMatch[0].length;
        sawScale = true;
    }

    const tail = slice.slice(cursor);

    // "three times" / "three-fold"
    const multMatch = /^[- ]?(times|fold)(?![\p{L}\d])/u.exec(tail);
    if (multMatch) {
        return {
            length: cursor + multMatch[0].length,
            quantities: [
                makeQuantity({ kind: 'multiplier', value: total, literal: total }, slice.slice(0, cursor + multMatch[0].length), index),
            ],
        };
    }

    // "fifty percent"
    const pctMatch = /^ ?(?:percent|per cent|%)(?![\p{L}\d])/u.exec(tail);
    if (pctMatch) {
        return {
            length: cursor + pctMatch[0].length,
            quantities: [
                makeQuantity({ kind: 'percent', value: total, literal: total, unit: '%' }, slice.slice(0, cursor + pctMatch[0].length), index),
            ],
        };
    }

    // "three seconds"
    const durUnits = Object.keys(DURATION_MS).sort((a, b) => b.length - a.length).join('|');
    const durMatch = new RegExp(String.raw`^ (${durUnits})(?![\p{L}\d])`, 'u').exec(tail);
    if (durMatch) {
        return {
            length: cursor + durMatch[0].length,
            quantities: [
                makeQuantity(
                    { kind: 'duration', value: total * DURATION_MS[durMatch[1]], literal: total, unit: 'ms' },
                    slice.slice(0, cursor + durMatch[0].length),
                    index,
                ),
            ],
        };
    }

    const asNumber = () => ({
        length: cursor,
        quantities: [makeQuantity({ kind: 'number', value: total as number, literal: total as number }, slice.slice(0, cursor), index)],
    });

    if (mode === 'lenient' || sawScale) return asNumber();

    // strict: needs a countable noun right after, and not a prose filler word
    const nounMatch = /^ ([a-z][a-z-]*)/.exec(tail);
    if (!nounMatch) return null;
    const noun = nounMatch[1];
    if (SPELLED_STOPWORDS.has(noun)) return null;
    if (noun.length > 3 && noun.endsWith('s')) return asNumber();
    return null;
}

/**
 * Pull every quantity out of a blob of text.
 *
 * @param mode 'strict' for model output (what must be justified),
 *             'lenient' for source text (what is available to justify it).
 */
export function extractQuantities(input: string, mode: ExtractMode = 'strict'): Quantity[] {
    const text = normalizeText(input);
    const found: Quantity[] = [];

    let i = 0;
    while (i < text.length) {
        const char = text[i];
        const startsToken = !isWordChar(text[i - 1]);
        const candidate = /[\d]/.test(char) || /[a-z]/.test(char) || char in CURRENCY_SYMBOLS;

        if (!candidate || !startsToken) {
            i += 1;
            continue;
        }

        let advanced = false;
        for (const matcher of MATCHERS) {
            const hit = matcher(text, i, mode);
            if (hit && hit.length > 0) {
                found.push(...hit.quantities);
                i += hit.length;
                advanced = true;
                break;
            }
        }
        if (!advanced) i += 1;
    }

    return found;
}

/** Convenience for tests and callers: what kind is this single token? */
export function classifyQuantity(token: string, mode: ExtractMode = 'strict'): QuantityKind | null {
    const quantities = extractQuantities(token, mode);
    return quantities.length === 1 ? quantities[0].kind : null;
}

// ───────────────────────────────────────────────────────────── matching

const EPSILON = 1e-9;

function numEq(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const diff = Math.abs(a - b);
    if (diff <= EPSILON) return true;
    // relative tolerance only for float artefacts (2/3 vs 0.6666666667), never for rounding claims
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return diff / scale <= 1e-6;
}

function quantityMatches(out: Quantity, src: Quantity): boolean {
    switch (out.kind) {
        case 'percent':
            // Strict on purpose. A percentage may not be *derived* from source numbers:
            // "800ms -> 180ms" in the source does not license "77%" in the output.
            return src.kind === 'percent' && out.unit === src.unit && numEq(out.value, src.value);

        case 'multiplier':
        case 'fraction':
            return (src.kind === 'multiplier' || src.kind === 'fraction') && numEq(out.value, src.value);

        case 'currency':
            if (src.kind === 'currency') {
                // same amount in a different currency is a fabricated currency
                if (out.unit && src.unit && out.unit !== src.unit) return false;
                return numEq(out.value, src.value);
            }
            if (src.kind === 'number' || src.kind === 'year') return numEq(out.value, src.value);
            return false;

        case 'duration':
            if (src.kind === 'duration') return numEq(out.value, src.value);
            if (src.kind === 'number' || src.kind === 'year') return numEq(out.literal, src.value);
            return false;

        case 'size':
            if (src.kind === 'size') return numEq(out.value, src.value);
            if (src.kind === 'number' || src.kind === 'year') return numEq(out.literal, src.value);
            return false;

        case 'number':
        case 'year':
            // the weakest claim: the digits just have to be present somewhere, as anything
            if (src.kind === 'date') return src.text?.startsWith(String(out.value)) ?? false;
            if (src.kind === 'range' || src.kind === 'version') return false;
            return numEq(out.value, src.value) || numEq(out.value, src.literal);

        case 'date':
            return src.kind === 'date' && src.text === out.text;

        case 'version':
            return src.kind === 'version' && src.text === out.text;

        case 'range':
            return false; // handled by isQuantitySupported
    }
}

/**
 * Source-side ranges are flattened to their endpoints as well as kept whole, so a
 * source "10-15" can justify an output "10" or "15" individually.
 * Only ever applied to the source: more source quantities can permit a match,
 * never create a violation.
 */
export function flattenQuantities(quantities: Quantity[]): Quantity[] {
    const out: Quantity[] = [];
    for (const quantity of quantities) {
        out.push(quantity);
        if (quantity.parts) out.push(...flattenQuantities(quantity.parts));
    }
    return out;
}

export function isQuantitySupported(quantity: Quantity, sourceQuantities: Quantity[]): boolean {
    if (quantity.kind === 'range') {
        return (quantity.parts ?? []).every((part) => isQuantitySupported(part, sourceQuantities));
    }
    return sourceQuantities.some((src) => quantityMatches(quantity, src));
}

// ───────────────────────────────────────────────────────────── field walking

type Leaf = { path: string; value: string };

function collectStrings(value: unknown, path: string, out: Leaf[]): void {
    if (typeof value === 'string') {
        out.push({ path, value });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => collectStrings(entry, `${path}.${index}`, out));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            collectStrings(child, `${path}.${key}`, out);
        }
    }
}

function readPath(root: unknown, path: string): { found: boolean; value: unknown } {
    const segments = path.split('.').filter(Boolean);
    let current: unknown = root;
    for (const segment of segments) {
        if (current == null || typeof current !== 'object') return { found: false, value: undefined };
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index)) return { found: false, value: undefined };
            current = current[index];
        } else {
            const record = current as Record<string, unknown>;
            if (!(segment in record)) return { found: false, value: undefined };
            current = record[segment];
        }
    }
    return { found: true, value: current };
}

/**
 * Run the guard over a model output object.
 * Fields that are absent from the object are simply not checked — a guard is
 * not a schema, and schema validation has already run by the time we get here.
 */
export function checkNumericGuard(data: unknown, guard: NumericGuard): GuardCheckResult {
    const sourceQuantities = flattenQuantities(extractQuantities(guard.sourceText ?? '', 'lenient'));
    const enforceYears = guard.enforceYears ?? false;
    const violations: GuardViolation[] = [];

    for (const field of guard.fields) {
        const { found, value } = readPath(data, field);
        if (!found) continue;

        const leaves: Leaf[] = [];
        collectStrings(value, field, leaves);

        for (const leaf of leaves) {
            for (const quantity of extractQuantities(leaf.value, 'strict')) {
                if (!enforceYears && (quantity.kind === 'year' || quantity.kind === 'date')) continue;
                if (isQuantitySupported(quantity, sourceQuantities)) continue;
                violations.push({ path: leaf.path, field, text: leaf.value, quantity });
            }
        }
    }

    return {
        ok: violations.length === 0,
        violations,
        violatingFields: [...new Set(violations.map((v) => v.field))],
        violatingPaths: [...new Set(violations.map((v) => v.path))],
    };
}

// ───────────────────────────────────────────────────────────── remediation

/**
 * The corrective retry prompt. Names the exact offending quantities so the model
 * has something to act on — "be accurate" is not a correction.
 */
export function buildCorrectionPrompt(violations: GuardViolation[]): string {
    const listed = [...new Set(violations.map((v) => `"${v.quantity.raw.trim()}" (in ${v.path})`))];
    return [
        'Your previous response contained quantities that do not appear in the source material:',
        ...listed.map((entry) => `- ${entry}`),
        '',
        'Rewrite the response so that every number, percentage, currency amount, multiplier, duration and',
        'written quantity appears verbatim in the source material. Do NOT compute, infer, round, or derive',
        'new figures from figures that are present — a percentage calculated from two source numbers is still',
        'a fabricated number. If a claim cannot be stated without an unsupported figure, state it',
        'qualitatively with no figure at all.',
    ].join('\n');
}

function writePath(root: unknown, path: string, mutate: (parent: unknown, key: string) => void): void {
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) return;
    let current: unknown = root;
    for (const segment of segments.slice(0, -1)) {
        if (current == null || typeof current !== 'object') return;
        current = Array.isArray(current)
            ? current[Number(segment)]
            : (current as Record<string, unknown>)[segment];
    }
    if (current == null || typeof current !== 'object') return;
    mutate(current, segments[segments.length - 1]);
}

/**
 * Last resort after the corrective retry fails: remove the offending claims.
 *
 * An offending array element is dropped (losing one bullet beats shipping a lie);
 * an offending string property is blanked. Returns a deep copy — the caller's
 * object is never mutated.
 *
 * Note: the result is intentionally NOT re-validated against the zod schema.
 * A schema with `.min(1)` on a stripped array will now be "invalid"; that is the
 * caller's degraded-mode problem to render (PRD 08 §6.1), not a reason to ship
 * the fabricated text.
 */
export function stripViolations<T>(data: T, violations: GuardViolation[]): T {
    const copy = structuredClone(data);
    const paths = [...new Set(violations.map((v) => v.path))];

    // deepest-last so array index removal does not shift a path we still need
    const sorted = paths.sort((a, b) => b.localeCompare(a));

    for (const path of sorted) {
        writePath(copy, path, (parent, key) => {
            if (Array.isArray(parent)) {
                const index = Number(key);
                if (Number.isInteger(index) && index >= 0 && index < parent.length) parent.splice(index, 1);
                return;
            }
            const record = parent as Record<string, unknown>;
            if (typeof record[key] === 'string') record[key] = '';
        });
    }

    return copy;
}
