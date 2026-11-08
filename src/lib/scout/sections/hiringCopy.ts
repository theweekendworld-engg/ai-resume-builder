/**
 * The company card's observed-hiring sentence, framed around the role's own
 * location. Pure.
 *
 * The enrichment layer's sentence upper-cases its geography code and defaults
 * to India, so a US remote role read "No postings observed for this company
 * yet, so there is nothing to say about INDIA hiring" (QA 2026-11-07). Here
 * the geography is the role's (its location field, else the region the
 * posting scopes itself to), the name is a name ("the US", "India"), and
 * when the role's geography cannot be placed the sentence says only what is
 * true without one.
 *
 * Every number is the signal's own: counts and the window, as observed.
 */

import { GEOGRAPHY_BUCKETS, GEOGRAPHY_NAME, bucketsForGeography, geographyName, type toWireHiringSignal } from '@/lib/enrichment/hiring';

export { geographyName };
import { normalizeGeo } from '@/lib/radar/geo';
import { detectRegionScope } from '@/lib/scout/fit/jdSignals';

type WireHiring = ReturnType<typeof toWireHiringSignal>;

/** `GEOGRAPHY_BUCKETS` keys, as a reader says them. */
const BUCKET_NAME: Record<string, string> = {
    nyc: 'New York', sf_bay: 'SF Bay Area', los_angeles: 'Los Angeles', bengaluru: 'Bengaluru', delhi: 'Delhi NCR',
    us: 'US', uk: 'UK', india: 'India',
};

/** "remote_us" → "Remote (US)", "sf_bay" → "SF Bay Area". */
export function bucketName(bucket: string): string {
    const [, prefix, rest] = bucket.match(/^(remote|multi)_(.+)$/) ?? [];
    const base = (slug: string) => BUCKET_NAME[slug] ?? GEOGRAPHY_NAME[slug] ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (prefix === 'remote') return `Remote (${base(rest).replace(/^the /, '')})`;
    if (prefix === 'multi') return `Several sites (${base(rest).replace(/^the /, '')})`;
    return base(bucket);
}

/**
 * The geography the role is in, as a `GEOGRAPHY_BUCKETS` key, or null when
 * the role's location places it in no geography we track. Never a default.
 */
export function roleGeography(location: string | null, text: string): string | null {
    const bucket = normalizeGeo(location).bucket;
    if (bucket) {
        for (const key of Object.keys(GEOGRAPHY_BUCKETS)) {
            if (bucketsForGeography(key).has(bucket)) return key;
        }
    }
    const scope = detectRegionScope({ location, text });
    if (scope && GEOGRAPHY_BUCKETS[scope.region]) return scope.region;
    return null;
}

/**
 * The sentence, or null when there is nothing true to say about the role's
 * geography (it cannot be placed, and the signal is about somewhere else).
 */
export function hiringStatementFor(signal: WireHiring | null, geography: string | null): string | null {
    if (!signal) return null;
    const where = geography ? `in ${geographyName(geography)}` : null;

    if (!signal.ok) {
        switch (signal.reason) {
            case 'no_postings':
                return where
                    ? `No postings from this company on the job boards we watch yet, so there is no read on its hiring ${where}.`
                    : 'No postings from this company on the job boards we watch yet.';
            case 'no_placeable_locations':
                return `${signal.total} postings observed, but none stated a location we could place${where ? `, so there is no read on hiring ${where}` : ''}.`;
            case 'insufficient_for_absence':
                if (!where) return null;
                return `No roles ${where} seen, but only ${signal.placeable} located postings, under the ${signal.needed ?? 20} needed before absence means anything. Treat this as unknown, not as a no.`;
        }
        return null;
    }

    if (!where) return null;
    const days = Math.max(1, Math.round((Date.parse(signal.windowEnd) - Date.parse(signal.windowStart)) / 86_400_000));
    if (signal.verdict === 'hires_there') {
        const buckets = signal.buckets.map((entry) => `${bucketName(entry.bucket)} (${entry.n})`).join(', ');
        return `Yes: ${signal.matched} of ${signal.placeable} located roles on their public board in the last ${days} days were ${where}${buckets ? `: ${buckets}` : ''}.`;
    }
    return `No roles ${where} among ${signal.placeable} located postings on their public board in the last ${days} days. This covers only the boards we poll, so it is not evidence they never hire there.`;
}
