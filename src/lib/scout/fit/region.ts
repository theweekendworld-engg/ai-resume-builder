/**
 * Which country or region a place is in, for eligibility and remote scope.
 * Pure, no IO.
 *
 * Built on `normalizeGeo` (the Radar bucketer) so the two cannot disagree
 * about where "Bengaluru, Karnataka" is, plus the places a job posting names
 * that Radar never needed: the DC area ("DMV"), US states, and the Indian
 * cities outside Radar's five metros.
 *
 * Returns null when a place cannot be placed. Never a default market: a
 * remote US role read as "India" is how a Bengaluru engineer was told
 * location should not decide a US-only government contract (QA 2026-11-07).
 */

import { normalizeGeo } from '@/lib/radar/geo';

export type RegionCode =
    | 'us' | 'uk' | 'canada' | 'india' | 'germany' | 'france' | 'ireland' | 'netherlands' | 'spain' | 'poland'
    | 'sweden' | 'switzerland' | 'israel' | 'singapore' | 'japan' | 'australia' | 'brazil' | 'mexico'
    | 'eu' | 'emea' | 'apac' | 'latam';

/** How each region reads in a sentence: "in the US", "in India". */
export const REGION_NAME: Record<RegionCode, string> = {
    us: 'the US',
    uk: 'the UK',
    canada: 'Canada',
    india: 'India',
    germany: 'Germany',
    france: 'France',
    ireland: 'Ireland',
    netherlands: 'the Netherlands',
    spain: 'Spain',
    poland: 'Poland',
    sweden: 'Sweden',
    switzerland: 'Switzerland',
    israel: 'Israel',
    singapore: 'Singapore',
    japan: 'Japan',
    australia: 'Australia',
    brazil: 'Brazil',
    mexico: 'Mexico',
    eu: 'the EU',
    emea: 'EMEA',
    apac: 'APAC',
    latam: 'Latin America',
};

/** The adjective: "US citizenship", "Indian citizenship". */
export const REGION_ADJECTIVE: Record<RegionCode, string> = {
    us: 'US',
    uk: 'UK',
    canada: 'Canadian',
    india: 'Indian',
    germany: 'German',
    france: 'French',
    ireland: 'Irish',
    netherlands: 'Dutch',
    spain: 'Spanish',
    poland: 'Polish',
    sweden: 'Swedish',
    switzerland: 'Swiss',
    israel: 'Israeli',
    singapore: 'Singaporean',
    japan: 'Japanese',
    australia: 'Australian',
    brazil: 'Brazilian',
    mexico: 'Mexican',
    eu: 'EU',
    emea: 'EMEA',
    apac: 'APAC',
    latam: 'Latin American',
};

/** Groupings a posting may scope to. A region is inside itself and its group. */
const GROUPS: Partial<Record<RegionCode, readonly RegionCode[]>> = {
    eu: ['germany', 'france', 'ireland', 'netherlands', 'spain', 'poland', 'sweden'],
    emea: ['uk', 'germany', 'france', 'ireland', 'netherlands', 'spain', 'poland', 'sweden', 'switzerland', 'israel', 'eu'],
    apac: ['india', 'singapore', 'japan', 'australia'],
    latam: ['brazil', 'mexico'],
};

export function regionContains(scope: RegionCode, region: RegionCode | null): boolean {
    if (!region) return false;
    return scope === region || (GROUPS[scope]?.includes(region) ?? false);
}

/** Radar metro slugs → country. */
const METRO_REGION: Record<string, RegionCode> = {
    nyc: 'us', sf_bay: 'us', seattle: 'us', los_angeles: 'us', austin: 'us', boston: 'us', chicago: 'us', denver: 'us', atlanta: 'us',
    toronto: 'canada', vancouver: 'canada',
    london: 'uk', dublin: 'ireland', berlin: 'germany', munich: 'germany', paris: 'france', amsterdam: 'netherlands',
    stockholm: 'sweden', zurich: 'switzerland', tel_aviv: 'israel', warsaw: 'poland', madrid: 'spain', barcelona: 'spain',
    bengaluru: 'india', hyderabad: 'india', mumbai: 'india', delhi: 'india', pune: 'india',
    singapore: 'singapore', tokyo: 'japan', sydney: 'australia', melbourne: 'australia',
    sao_paulo: 'brazil', mexico_city: 'mexico',
};

const REGION_SLUGS = new Set<string>(Object.keys(REGION_NAME));

const US_STATES = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming)\b/i;
/** "Arlington, VA", "Reston, VA 20190". Case-sensitive: "in" and "or" are words. */
const US_STATE_CODE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
/** The DC area. "DMV" in a driving job means the motor vehicles office, so a record or check is excluded. */
const DC_AREA = /\bwashington,?\s*d\.?\s?c\b|\bd\.c\.|\bdmv\b(?!\s+(?:record|check|report|printout|history|clearance))/i;
const MORE_INDIA = /\b(?:chennai|madras|kolkata|calcutta|noida|gurugram|gurgaon|ahmedabad|kochi|cochin|jaipur|chandigarh|coimbatore|indore|thiruvananthapuram|trivandrum|mysuru|mysore|bhubaneswar|nagpur|lucknow|visakhapatnam|vizag|karnataka|maharashtra|tamil nadu|telangana|kerala|haryana)\b/i;

/** The region a place string is in, or null when it cannot be placed. */
export function regionOf(place: string | null | undefined): RegionCode | null {
    if (!place || !place.trim()) return null;
    const { bucket } = normalizeGeo(place);
    if (bucket && bucket !== 'remote_global' && bucket !== 'multi_global') {
        const slug = bucket.replace(/^(?:remote|multi)_/, '');
        if (REGION_SLUGS.has(slug)) return slug as RegionCode;
        if (METRO_REGION[slug]) return METRO_REGION[slug];
    }
    if (DC_AREA.test(place) || US_STATES.test(place) || US_STATE_CODE.test(place)) return 'us';
    if (MORE_INDIA.test(place)) return 'india';
    return null;
}

/**
 * The region a short phrase names ("US", "U.S.", "United States", "Canada").
 * Case matters for the two-letter codes: "contact us only" is not the US.
 */
export function regionFromToken(token: string): RegionCode | null {
    const raw = token.trim().replace(/[.\s]+$/g, '');
    if (/^U\.?\s?S\.?(?:A\.?)?$/.test(raw)) return 'us';
    if (/^U\.?K\.?$/.test(raw)) return 'uk';
    if (/^E\.?U\.?$/.test(raw)) return 'eu';
    const lower = raw.toLowerCase().replace(/^the\s+/, '');
    if (/^(?:united states(?: of america)?|america|american|usa)$/.test(lower)) return 'us';
    if (/^(?:united kingdom|great britain|britain|england)$/.test(lower)) return 'uk';
    if (/^(?:european union|europe)$/.test(lower)) return 'eu';
    if (lower === 'emea') return 'emea';
    if (lower === 'apac') return 'apac';
    if (lower === 'latam') return 'latam';
    if (/^(?:canada|india|germany|france|ireland|netherlands|spain|poland|sweden|switzerland|israel|singapore|japan|australia|brazil|mexico)$/.test(lower)) {
        return lower as RegionCode;
    }
    return null;
}
