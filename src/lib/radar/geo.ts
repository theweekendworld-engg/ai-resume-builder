/**
 * Location normalisation for band cells (PRD 04 §2).
 *
 * A band is keyed on (role family, seniority, geo). Feeding raw location
 * strings into that key fragments it into uselessness: measured across 302
 * real postings there were 26 distinct strings, and `"New York, NY (HQ)"` and
 * `"New York, NY"` — the same market — landed in different cells. Only 24% of
 * ingested postings reached a usable cell before this existed.
 *
 * ── The case that shapes the design ─────────────────────────────────────
 *
 * The second-largest bucket in real data was
 * `"San Francisco, CA • New York, NY • United States"` — 90 postings carrying
 * ONE salary range across several metros. There is no honest way to attribute
 * that range to San Francisco or to New York: the employer deliberately quoted
 * a span covering both. So multi-location postings get their own bucket rather
 * than being assigned to the first city listed, which would inflate whichever
 * metro happened to be typed first.
 *
 * They are still comparable to each other — "a US multi-metro range" is a real
 * market signal — just never pooled with a single-metro band.
 */

export type GeoKind =
    /** A single identifiable metro. The most useful cell. */
    | 'metro'
    /** A country or region, no metro. */
    | 'region'
    /** Remote, scoped to a region where stated. */
    | 'remote'
    /** Several metros, one range. Comparable only to other multi postings. */
    | 'multi'
    /** Could not be read. Excluded from bands. */
    | 'unknown';

export type NormalizedGeo = {
    /** Stable slug for the band key, or null when the posting cannot be placed. */
    bucket: string | null;
    kind: GeoKind;
    /** What we matched, for debugging a surprising cell. */
    matched: string | null;
};

/** Separators employers use when one posting covers several sites. */
const MULTI_SEPARATOR = /\s*(?:•|\||;|\/|\bor\b|,\s*(?:and|&)\s*)\s*/i;

/**
 * Metro aliases, longest-first within each entry.
 *
 * Curated rather than derived: a geocoding service would be more complete and
 * far less predictable, and a band that silently moves cities between runs is
 * worse than one that admits it cannot place a posting. Extend from observed
 * strings, not from a gazetteer.
 */
const METROS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['nyc', ['new york', 'nyc', 'brooklyn', 'manhattan']],
    ['sf_bay', ['san francisco', 'sf bay', 'bay area', 'palo alto', 'mountain view', 'menlo park', 'oakland', 'san jose', 'sunnyvale', 'cupertino']],
    ['seattle', ['seattle', 'bellevue', 'redmond']],
    ['los_angeles', ['los angeles', 'santa monica', 'pasadena', 'culver city']],
    ['austin', ['austin']],
    ['boston', ['boston', 'cambridge, ma']],
    ['chicago', ['chicago']],
    ['denver', ['denver', 'boulder']],
    ['atlanta', ['atlanta']],
    ['toronto', ['toronto']],
    ['vancouver', ['vancouver']],
    ['london', ['london']],
    ['dublin', ['dublin']],
    ['berlin', ['berlin']],
    ['munich', ['munich', 'münchen']],
    ['paris', ['paris']],
    ['amsterdam', ['amsterdam']],
    ['stockholm', ['stockholm']],
    ['zurich', ['zurich', 'zürich']],
    ['tel_aviv', ['tel aviv']],
    ['bengaluru', ['bengaluru', 'bangalore']],
    ['hyderabad', ['hyderabad']],
    ['mumbai', ['mumbai']],
    ['delhi', ['delhi', 'gurugram', 'gurgaon', 'noida']],
    ['pune', ['pune']],
    ['singapore', ['singapore']],
    ['tokyo', ['tokyo']],
    ['sydney', ['sydney']],
    ['melbourne', ['melbourne']],
    ['sao_paulo', ['são paulo', 'sao paulo']],
    ['mexico_city', ['mexico city', 'ciudad de méxico', 'cdmx']],
    ['warsaw', ['warsaw', 'warszawa']],
    ['madrid', ['madrid']],
    ['barcelona', ['barcelona']],
];

/** Country/region fallbacks when no metro is named. */
const REGIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['us', ['united states', 'usa', 'u.s.', ' us ', 'america']],
    ['uk', ['united kingdom', 'england', 'scotland', 'wales', ' uk ']],
    ['canada', ['canada']],
    ['germany', ['germany', 'deutschland']],
    ['france', ['france']],
    ['india', ['india']],
    ['japan', ['japan']],
    ['australia', ['australia']],
    ['brazil', ['brazil', 'brasil']],
    ['israel', ['israel']],
    ['netherlands', ['netherlands']],
    ['ireland', ['ireland']],
    ['spain', ['spain']],
    ['poland', ['poland']],
    ['sweden', ['sweden']],
    ['singapore', ['singapore']],
    ['emea', ['emea']],
    ['apac', ['apac']],
    ['latam', ['latam']],
];

const REMOTE = /\bremote\b|\bwork from home\b|\bdistributed\b|\banywhere\b/i;

/**
 * Strip the noise employers add around a place name: an `(HQ)` marker, an
 * office nickname, trailing punctuation. `"New York, NY (HQ)"` and
 * `"New York, NY"` must reach the same bucket, and before this they did not.
 */
function clean(raw: string): string {
    return ` ${raw
        .toLowerCase()
        .replace(/\((?:hq|headquarters|remote|hybrid|on-?site|office)\)/gi, ' ')
        .replace(/\b(?:hq|headquarters|hybrid|on-?site|in-?office)\b/gi, ' ')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()} `;
}

function matchMetro(text: string): string | null {
    for (const [slug, aliases] of METROS) {
        for (const alias of aliases) {
            if (text.includes(alias)) return slug;
        }
    }
    return null;
}

function matchRegion(text: string): string | null {
    for (const [slug, aliases] of REGIONS) {
        for (const alias of aliases) {
            if (text.includes(alias)) return slug;
        }
    }
    return null;
}

/**
 * Normalise a raw location string into a band bucket.
 *
 * Returns `bucket: null` when the string cannot be placed, which excludes the
 * posting from published bands. Refusing to place a posting costs one row;
 * placing it wrongly corrupts a number someone reads as their market worth.
 */
export function normalizeGeo(raw: string | null | undefined): NormalizedGeo {
    if (!raw || !raw.trim()) return { bucket: null, kind: 'unknown', matched: null };

    const parts = raw.split(MULTI_SEPARATOR).map((p) => p.trim()).filter(Boolean);

    // ── several sites, one range: comparable only to other multi postings.
    if (parts.length > 1) {
        const metros = [...new Set(parts.map((p) => matchMetro(clean(p))).filter(Boolean))] as string[];
        const regions = [...new Set(parts.map((p) => matchRegion(clean(p))).filter(Boolean))] as string[];

        // A list that resolves to ONE metro ("San Francisco, CA • SF Bay") is
        // not really multi-site — it is one market written twice.
        if (metros.length === 1 && regions.length <= 1) {
            return { bucket: metros[0], kind: 'metro', matched: metros[0] };
        }
        if (metros.length === 0 && regions.length === 1) {
            return { bucket: regions[0], kind: 'region', matched: regions[0] };
        }
        if (metros.length === 0 && regions.length === 0) {
            return { bucket: null, kind: 'unknown', matched: null };
        }

        // Scope the multi bucket to a region when every site shares one, so a
        // US multi-metro range is never pooled with a European one.
        const scope = regions.length === 1 ? regions[0] : 'global';
        return { bucket: `multi_${scope}`, kind: 'multi', matched: metros.join('+') || scope };
    }

    const text = clean(raw);

    // ── remote. A remote range still belongs to the market it is scoped to.
    if (REMOTE.test(text)) {
        const region = matchRegion(text);
        const metro = matchMetro(text);
        if (region) return { bucket: `remote_${region}`, kind: 'remote', matched: region };
        if (metro) return { bucket: `remote_${metro}`, kind: 'remote', matched: metro };
        return { bucket: 'remote_global', kind: 'remote', matched: 'remote' };
    }

    const metro = matchMetro(text);
    if (metro) return { bucket: metro, kind: 'metro', matched: metro };

    const region = matchRegion(text);
    if (region) return { bucket: region, kind: 'region', matched: region };

    return { bucket: null, kind: 'unknown', matched: null };
}
