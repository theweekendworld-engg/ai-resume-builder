/**
 * What the research sections are about: company, role, level, place — read
 * from earlier sections, never from the user. Every field here is public (it
 * came off the posting), which is what makes it safe to key a SHARED cache on.
 */

import { bucketsForGeography, GEOGRAPHY_BUCKETS } from '@/lib/enrichment/hiring';
import { normalizeGeo } from '@/lib/radar/geo';
import { classifyFamily, classifySeniority, type RoleFamily, type Seniority } from '@/lib/radar/role';
import { dataOf } from '@/lib/scout/section';
import type { ScoutSections } from '@/lib/scout/types';

export type ResearchTarget = {
    company: string;
    role: string | null;
    family: RoleFamily;
    seniority: Seniority;
    location: string | null;
    geoBucket: string | null;
    /** A `GEOGRAPHY_BUCKETS` key, e.g. 'india'. */
    geography: string;
};

/** The geography a bucket belongs to; India when unplaceable (the product's home market). */
export function geographyForBucket(bucket: string | null): string {
    if (bucket) {
        for (const key of Object.keys(GEOGRAPHY_BUCKETS)) {
            if (bucketsForGeography(key).has(bucket)) return key;
        }
    }
    return 'india';
}

export function researchTarget(sections: ScoutSections): ResearchTarget | null {
    const jd = dataOf(sections, 'jd');
    const classify = dataOf(sections, 'classify');
    const ingest = dataOf(sections, 'ingest');

    const company = (jd?.company || classify?.companies[0] || ingest?.companyName || '').trim();
    if (!company) return null;

    const role = (jd?.role || classify?.roleTitle || '').trim() || null;
    const location = jd?.location ?? ingest?.location ?? null;
    const geoBucket = normalizeGeo(location).bucket;
    return {
        company,
        role,
        family: role ? classifyFamily(role) : 'unknown',
        seniority: role ? classifySeniority(role) : 'unknown',
        location,
        geoBucket,
        geography: geographyForBucket(geoBucket),
    };
}

/** "Bengaluru" out of "Bengaluru, Karnataka, India" — for queries only. */
export function cityOf(location: string | null): string | null {
    if (!location) return null;
    const first = location.split(/[,;|•]/)[0]?.trim();
    return first && !/remote/i.test(first) ? first : null;
}
