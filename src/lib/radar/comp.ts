/**
 * Compensation extraction for Career Radar (PRD 04 §2.1, §3.1).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a language model may never produce a
 * salary number. Bands are arithmetic over numbers we literally read out of a
 * posting. Everything here is regex and integer maths, and it must stay that
 * way — a single wrong band destroys the credibility of the truthfulness brand
 * the whole product rests on.
 *
 * ── What the real data looks like ────────────────────────────────────────
 *
 * Measured against 2,629 live Greenhouse postings across 8 boards before any
 * of this was written. Findings that shaped the design:
 *
 *   • 42% disclose a range, and they do it in a STRUCTURED block, not prose:
 *       <div class="title">Annual Base Salary Range:</div>
 *       <div class="pay-range"><span>$165,000</span><span class="divider">—</span>
 *                              <span>$190,000 USD</span></div>
 *     Parsing that beats regex-over-prose by a mile, so it is tried first.
 *
 *   • Greenhouse returns `content` HTML-ESCAPED (`&lt;div&gt;`), so it must be
 *     unescaped before any tag can match. Skipping this silently yields 0%.
 *
 *   • Some boards (Stripe, Discord, Cloudflare) publish comp in PROSE only and
 *     emit no structured block at all, so a prose fallback is not optional.
 *
 *   • Currencies observed: USD, GBP, EUR, CAD. Anthropic writes European style
 *     (`€200.000` = two hundred thousand). Reading that as 200.00 would be a
 *     1000× error printed next to someone's career decision.
 *
 *   • Labels carry geography: "Zone 1 pay range" (172), "Local pay range"
 *     (202), "United States Salary Range" (72). That is the geo bucket, free.
 *
 *   • 18 postings state low == high, and 66 state a range wider than 60% of
 *     its midpoint. Both are excluded from band maths per §3.1.
 */

/** ISO-4217 where we can determine it; `UNKNOWN` when we genuinely cannot. */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'INR' | 'SGD' | 'UNKNOWN';

export type CompPeriod = 'year' | 'hour';

/** Why a disclosed range is not fit for band arithmetic. */
export type CompRejectReason =
    /** low === high — a point, not a range. */
    | 'degenerate'
    /** Wider than 60% of its midpoint: compliance theatre, not information. */
    | 'implausibly_wide'
    /** Outside any believable annual salary, so probably not a salary at all. */
    | 'out_of_range'
    /** Could not determine the currency, so it cannot be pooled with anything. */
    | 'unknown_currency';

export type CompExtraction = {
    low: number;
    high: number;
    currency: CurrencyCode;
    period: CompPeriod;
    /**
     * Normalised to annual, in the ORIGINAL currency. Period normalisation is
     * arithmetic; currency conversion is not — §3.1 forbids converting, because
     * a stale FX rate silently corrupts every band built on it.
     */
    annualLow: number;
    annualHigh: number;
    /** Where we read it, which is also how much to trust it. */
    source: 'structured' | 'prose';
    /** The posting's own label, e.g. "Zone 1 pay range". Carries geography. */
    label: string | null;
    /** True only when this may be pooled into a published band. */
    bandEligible: boolean;
    rejectReason: CompRejectReason | null;
};

/**
 * Full-time hours per year. Used ONLY to compare an hourly posting against
 * annual ones; the original period is always retained on the record.
 */
const HOURS_PER_YEAR = 2080;

/** Believable annual base salary, any currency. Rejects "5 - 7 years". */
const MIN_ANNUAL = 20_000;
const MAX_ANNUAL = 2_000_000;

/** §3.1: a range wider than this fraction of its midpoint is not information. */
const MAX_WIDTH_RATIO = 0.6;

const SYMBOL_TO_CURRENCY: ReadonlyArray<readonly [string, CurrencyCode]> = [
    // Longest first: C$/A$ must win before a bare $.
    ['C$', 'CAD'], ['A$', 'AUD'], ['S$', 'SGD'], ['₹', 'INR'],
    ['$', 'USD'], ['£', 'GBP'], ['€', 'EUR'],
];

const CODE_PATTERN = /\b(USD|EUR|GBP|CAD|AUD|INR|SGD)\b/i;

/**
 * Greenhouse escapes the whole body. Unescape in dependency order — `&amp;`
 * LAST, or `&amp;lt;` would become `<` and re-open a tag we never saw.
 */
export function unescapeHtml(input: string): string {
    return input
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&amp;/g, '&');
}

/** Strip tags to readable text. Assumes `unescapeHtml` already ran. */
export function toText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse a money token into a number.
 *
 * The hard case is separator ambiguity: `$165,000` is US, `€200.000` is
 * European, and `$68.50` is a genuine decimal. Disambiguate on the LAST
 * separator and how many digits follow it — exactly three means a thousands
 * group, anything else means a decimal point. `1,234,567` also works because
 * every separator but the last is stripped regardless.
 *
 * A trailing `k`/`K` multiplies by 1,000 (`$120K`).
 */
export function parseMoney(raw: string): number | null {
    const token = raw.trim().toLowerCase();
    const isThousands = /\dk\b|\dk$/.test(token);
    const digits = token.replace(/[^\d.,]/g, '');
    if (!digits || !/\d/.test(digits)) return null;

    const lastComma = digits.lastIndexOf(',');
    const lastDot = digits.lastIndexOf('.');
    const lastSep = Math.max(lastComma, lastDot);

    let normalized: string;
    if (lastSep === -1) {
        normalized = digits;
    } else {
        const decimals = digits.length - lastSep - 1;
        normalized =
            decimals === 3
                ? digits.replace(/[.,]/g, '')
                : `${digits.slice(0, lastSep).replace(/[.,]/g, '')}.${digits.slice(lastSep + 1)}`;
    }

    const value = parseFloat(normalized);
    if (!Number.isFinite(value)) return null;
    return isThousands ? value * 1_000 : value;
}

function detectCurrency(...fragments: string[]): CurrencyCode {
    const joined = fragments.join(' ');
    const code = CODE_PATTERN.exec(joined);
    if (code) return code[1].toUpperCase() as CurrencyCode;
    for (const [symbol, currency] of SYMBOL_TO_CURRENCY) {
        if (joined.includes(symbol)) return currency;
    }
    return 'UNKNOWN';
}

function detectPeriod(...fragments: string[]): CompPeriod {
    return /\b(per hour|hourly|\/\s?hour|\/\s?hr|an hour)\b/i.test(fragments.join(' ')) ? 'hour' : 'year';
}

/** Apply §2.1/§3.1 quality rules. Order matters: report the most specific cause. */
function assess(
    low: number,
    high: number,
    currency: CurrencyCode,
): { bandEligible: boolean; rejectReason: CompRejectReason | null } {
    if (currency === 'UNKNOWN') return { bandEligible: false, rejectReason: 'unknown_currency' };
    if (low === high) return { bandEligible: false, rejectReason: 'degenerate' };
    if (low < MIN_ANNUAL || high > MAX_ANNUAL) return { bandEligible: false, rejectReason: 'out_of_range' };

    const midpoint = (low + high) / 2;
    if (midpoint <= 0) return { bandEligible: false, rejectReason: 'out_of_range' };
    if ((high - low) / midpoint > MAX_WIDTH_RATIO) {
        return { bandEligible: false, rejectReason: 'implausibly_wide' };
    }
    return { bandEligible: true, rejectReason: null };
}

function build(
    lowRaw: number,
    highRaw: number,
    currency: CurrencyCode,
    period: CompPeriod,
    source: 'structured' | 'prose',
    label: string | null,
): CompExtraction | null {
    // Postings occasionally list the range backwards; ordering is not a defect.
    const low = Math.min(lowRaw, highRaw);
    const high = Math.max(lowRaw, highRaw);

    const annualLow = period === 'hour' ? Math.round(low * HOURS_PER_YEAR) : low;
    const annualHigh = period === 'hour' ? Math.round(high * HOURS_PER_YEAR) : high;

    const { bandEligible, rejectReason } = assess(annualLow, annualHigh, currency);

    return {
        low, high, currency, period, annualLow, annualHigh,
        source, label, bandEligible, rejectReason,
    };
}

/**
 * Greenhouse's structured block. Preferred: the publisher tagged these numbers
 * as compensation themselves, so there is no inference to get wrong.
 */
function fromStructuredBlock(html: string): CompExtraction | null {
    const withTitle =
        /<div[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]{0,160}?)<\/div>\s*<div[^>]*class="[^"]*\bpay-range\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const bare = withTitle ? null : /<div[^>]*class="[^"]*\bpay-range\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (!withTitle && !bare) return null;

    const label = withTitle ? toText(withTitle[1]).replace(/:$/, '').trim() || null : null;
    const inner = withTitle ? withTitle[2] : (bare as RegExpExecArray)[1];

    // The divider span carries no digits, so filtering on digits drops it.
    const values = [...inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
        .map((m) => toText(m[1]))
        .filter((s) => /\d/.test(s));
    if (values.length < 2) return null;

    const low = parseMoney(values[0]);
    const high = parseMoney(values[values.length - 1]);
    if (low === null || high === null) return null;

    const currency = detectCurrency(values.join(' '), label ?? '');
    const period = detectPeriod(label ?? '', inner);
    return build(low, high, currency, period, 'structured', label);
}

/**
 * Prose fallback, for boards that emit no structured block.
 *
 * Deliberately conservative: it requires a currency marker adjacent to the
 * first figure. Without that anchor it happily reads "5 - 7 years of
 * experience" or "we are 200 - 300 people" as a salary band, and a wrong band
 * is worse than a missing one.
 */
function fromProse(text: string): CompExtraction | null {
    const pattern = new RegExp(
        String.raw`(C\$|A\$|S\$|[$£€₹])\s?` +
        String.raw`(\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?\s?[Kk]?)` +
        String.raw`\s*(?:-|–|—|to|through)\s*` +
        String.raw`(?:(C\$|A\$|S\$|[$£€₹])\s?)?` +
        String.raw`(\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?\s?[Kk]?)` +
        String.raw`\s*(USD|EUR|GBP|CAD|AUD|INR|SGD)?`,
        'i',
    );

    // Prefer a match near compensation language; fall back to the first match.
    const compIndex = text.search(/salary|compensation|pay range|base pay|remuneration/i);
    const window = compIndex >= 0 ? text.slice(Math.max(0, compIndex - 200), compIndex + 400) : text;

    const match = pattern.exec(window) ?? pattern.exec(text);
    if (!match) return null;

    const [, sym1, lowRaw, sym2, highRaw, code] = match;
    const low = parseMoney(lowRaw);
    const high = parseMoney(highRaw);
    if (low === null || high === null) return null;

    const currency = detectCurrency(code ?? '', sym1 ?? '', sym2 ?? '');
    const period = detectPeriod(match[0], window.slice(0, 200));
    return build(low, high, currency, period, 'prose', null);
}

/**
 * Extract a compensation range from a raw posting body.
 *
 * Accepts the body exactly as a board returns it — escaped or not — and tries
 * the structured block before prose. Returns `null` when the posting discloses
 * nothing, which is the common case and not an error.
 *
 * A returned record is NOT automatically publishable: check `bandEligible`.
 * Ineligible records are still worth storing, because "how many postings
 * disclosed but were unusable" is a real coverage metric.
 */
export function extractCompensation(rawBody: string): CompExtraction | null {
    if (!rawBody) return null;
    const html = unescapeHtml(rawBody);
    return fromStructuredBlock(html) ?? fromProse(toText(html));
}
