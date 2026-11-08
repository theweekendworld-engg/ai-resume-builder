/**
 * Can this user hold this job at all? Pure, no IO.
 *
 * The posting's side is `detectEligibility` (jdSignals.ts): citizenship,
 * clearance, Public Trust, work authorization. This is the user's side: what
 * their profile says about where they may work, and what follows.
 *
 * Fail closed. The answer is `match` only when the user's own stated work
 * authorization covers the restriction. With nothing stated:
 *   - a user whose profile places them outside the region is told they may
 *     not be eligible (`conflict`), with how to clear it if that is wrong;
 *   - anyone else gets the question (`unknown`), never a pass.
 */

import { REGION_ADJECTIVE, REGION_NAME, regionContains, regionFromToken, regionOf, type RegionCode } from '@/lib/scout/fit/region';
import type { EligibilityKind, EligibilityRestriction } from '@/lib/scout/fit/jdSignals';

export type AuthStatus = 'citizen' | 'permanent_resident' | 'authorized' | 'not_authorized';

export type WorkAuthorization = { status: AuthStatus; regions: RegionCode[] };

const STATUS_RANK: Record<AuthStatus, number> = { not_authorized: 0, authorized: 1, permanent_resident: 2, citizen: 3 };

/** Visa types that only exist in the US. */
const US_VISA = /\b(?:h-?1b|h-?4|l-?1|l-?2|o-?1|e-?3|tn|f-?1|opt|stem opt|cpt|ead|green\s*card)\b/i;

function regionsIn(text: string): RegionCode[] {
    const found = new Set<RegionCode>();
    const tokens = text.match(/\b(?:U\.?\s?S\.?A?|US|UK|EU|united states|america|american|united kingdom|britain|british|canada|canadian|india|indian|germany|german|ireland|irish|australia|australian|singapore|singaporean|europe|european)\b/gi) ?? [];
    for (const token of tokens) {
        const lower = token.toLowerCase();
        const region = regionFromToken(token)
            ?? (lower === 'british' ? 'uk' : lower === 'canadian' ? 'canada' : lower === 'indian' ? 'india' : lower === 'german' ? 'germany'
                : lower === 'irish' ? 'ireland' : lower === 'australian' ? 'australia' : lower === 'singaporean' ? 'singapore' : lower === 'european' ? 'eu' : null);
        if (region) found.add(region);
    }
    if (US_VISA.test(text)) found.add('us');
    return [...found];
}

function clauseStatus(clause: string): AuthStatus | null {
    const c = clause.toLowerCase();
    if (/\bnot\s+(?:\w+\s+){0,2}(?:authori[sz]ed|eligible|permitted)\b|\bno\s+(?:\w+\s+)?(?:work\s+)?(?:authori[sz]ation|permit|visa)\b|\bunauthori[sz]ed\b|\b(?:need|needs|require|requires|requiring)\s+(?:\S+\s+){0,2}sponsorship\b/.test(c)) return 'not_authorized';
    if (/\bcitizen(?:ship)?\b|\bnational\b/.test(c)) return 'citizen';
    if (/\bgreen\s*card\b|\bpermanent\s+resident\b|\b(?:lpr|pr)\b/.test(c)) return 'permanent_resident';
    if (US_VISA.test(c) || /\bwork\s+(?:visa|permit)\b|\bauthori[sz]ed\b|\beligible to work\b|\bno sponsorship (?:needed|required)\b|\bdo(?:es)? not (?:need|require) sponsorship\b/.test(c)) return 'authorized';
    return null;
}

/**
 * The user's free-text work authorization ("US citizen", "Indian citizen;
 * need H-1B sponsorship for the US"), as status per region. Null when it
 * says nothing we can read.
 */
export function parseWorkAuthorization(text: string | null | undefined): WorkAuthorization[] | null {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    const out: WorkAuthorization[] = [];
    for (const clause of raw.split(/[;,\n]|\bbut\b|\band\b(?=\s+(?:a|an|need|require|not|no|have|hold|am)\b)/i)) {
        const status = clauseStatus(clause);
        if (!status) continue;
        out.push({ status, regions: regionsIn(clause) });
    }
    return out.length ? out : null;
}

/**
 * The user's standing in one region. A clause naming the region decides; a
 * clause naming no region counts only when it is a "not authorized" (fail
 * closed: "I need sponsorship" applies wherever they apply).
 */
export function authorizationIn(auth: WorkAuthorization[] | null, region: RegionCode): AuthStatus | 'other_region' | null {
    if (!auth) return null;
    const named = auth.filter((entry) => entry.regions.some((r) => regionContains(region, r) || r === region));
    if (named.length) return named.reduce((best, entry) => (STATUS_RANK[entry.status] > STATUS_RANK[best] ? entry.status : best), named[0].status);
    if (auth.some((entry) => entry.regions.length === 0 && entry.status === 'not_authorized')) return 'not_authorized';
    if (auth.some((entry) => entry.regions.length > 0)) return 'other_region';
    return null;
}

/** Strictest first: the one restriction that decides. */
const KIND_ORDER: EligibilityKind[] = ['clearance', 'citizenship', 'citizen_or_resident', 'public_trust', 'work_authorization'];

/** What each status satisfies. `null` means "cannot tell from this". */
const SATISFIES: Record<Exclude<EligibilityKind, 'region_only'>, Record<AuthStatus, boolean | null>> = {
    clearance: { citizen: true, permanent_resident: false, authorized: false, not_authorized: false },
    citizenship: { citizen: true, permanent_resident: false, authorized: false, not_authorized: false },
    citizen_or_resident: { citizen: true, permanent_resident: true, authorized: false, not_authorized: false },
    public_trust: { citizen: true, permanent_resident: true, authorized: null, not_authorized: false },
    work_authorization: { citizen: true, permanent_resident: true, authorized: true, not_authorized: false },
};

/** "requires HHS Public Trust, which generally needs US citizenship or residency". */
export function restrictionPhrase(restriction: EligibilityRestriction, region: RegionCode | null): string {
    const adjective = region ? REGION_ADJECTIVE[region] : '';
    switch (restriction.kind) {
        case 'clearance':
            return `requires ${restriction.label}, which needs ${adjective || 'US'} citizenship`;
        case 'public_trust':
            return `requires ${restriction.label}, which generally needs ${adjective || 'US'} citizenship or residency`;
        case 'citizenship':
            return `requires ${restriction.label}`;
        case 'citizen_or_resident':
            return `is open only to ${adjective ? `${adjective} ` : ''}citizens and permanent residents`;
        case 'work_authorization':
            return region ? `requires authorization to work in ${REGION_NAME[region]}` : 'requires work authorization without sponsorship';
        case 'region_only':
            return region ? `is limited to ${REGION_NAME[region]}` : 'is limited to one region';
    }
}

export type EligibilityOutcome = {
    status: 'match' | 'conflict' | 'unknown';
    detail: string;
    /** The restriction that decided it. */
    restriction: EligibilityRestriction;
    region: RegionCode | null;
    /** True when the question "which describes you?" would settle it. */
    askable: boolean;
};

const HOW_TO_CLEAR = 'If you can work there, add your work authorization in Settings, Job search, and this check will clear.';

/** "requires …" reads on its own after a colon; "is open only to …" needs its subject. */
function asReason(phrase: string): string {
    return phrase.startsWith('requires') ? phrase : `the role ${phrase}`;
}

/**
 * The deciding restriction against what the user has said.
 *
 * `userLocation` is the profile's own location; `fallbackRegion` is where the
 * posting is (its location field), for "authorized to work" phrases that do
 * not name a country.
 */
export function evaluateEligibility(params: {
    restrictions: readonly EligibilityRestriction[];
    workAuthorization: string;
    requiresSponsorship: 'unknown' | 'yes' | 'no' | 'case_by_case';
    userLocation: string;
    fallbackRegion: RegionCode | null;
}): EligibilityOutcome | null {
    const deciding = KIND_ORDER
        .map((kind) => params.restrictions.find((restriction) => restriction.kind === kind))
        .find((restriction): restriction is EligibilityRestriction => Boolean(restriction));
    if (!deciding || deciding.kind === 'region_only') return null;

    const region = deciding.region ?? params.fallbackRegion;
    const phrase = restrictionPhrase(deciding, region);
    const sentence = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
    const stated = params.workAuthorization.trim();
    const auth = parseWorkAuthorization(stated);

    if (!region) {
        // "Authorized to work, without sponsorship", and the posting names no country.
        if (params.requiresSponsorship === 'yes') {
            return { status: 'conflict', detail: `You may not be eligible: ${asReason(phrase)}, and you need sponsorship.`, restriction: deciding, region, askable: false };
        }
        if (params.requiresSponsorship === 'no') {
            return { status: 'match', detail: `${sentence}; you do not need sponsorship.`, restriction: deciding, region, askable: false };
        }
        return { status: 'unknown', detail: `${sentence}. The posting does not say where.`, restriction: deciding, region, askable: false };
    }

    const standing = authorizationIn(auth, region);
    if (standing && standing !== 'other_region') {
        const satisfied = SATISFIES[deciding.kind][standing];
        if (satisfied === true && !(deciding.kind === 'work_authorization' && standing === 'authorized' && params.requiresSponsorship === 'yes')) {
            return { status: 'match', detail: `${sentence}; you said "${stated}".`, restriction: deciding, region, askable: false };
        }
        if (satisfied === null) {
            return {
                status: 'unknown',
                detail: `${sentence}; you said "${stated}". Whether that qualifies is the employer's call, so ask before applying.`,
                restriction: deciding,
                region,
                askable: false,
            };
        }
        return { status: 'conflict', detail: `You may not be eligible: ${asReason(phrase)}; you said "${stated}".`, restriction: deciding, region, askable: false };
    }
    if (standing === 'other_region') {
        return {
            status: 'conflict',
            detail: `You may not be eligible: ${asReason(phrase)}; your work authorization ("${stated}") is for elsewhere.`,
            restriction: deciding,
            region,
            askable: false,
        };
    }

    // Nothing usable stated. Plain authorization is settled by "no sponsorship needed" where they live.
    const home = regionOf(params.userLocation);
    if (deciding.kind === 'work_authorization' && params.requiresSponsorship === 'no' && (!home || regionContains(region, home))) {
        return { status: 'match', detail: `${sentence}; you said you do not need sponsorship.`, restriction: deciding, region, askable: false };
    }
    if (home && !regionContains(region, home)) {
        return {
            status: 'conflict',
            detail: `You may not be eligible: ${asReason(phrase)}. Your profile puts you in ${params.userLocation.trim()}. ${HOW_TO_CLEAR}`,
            restriction: deciding,
            region,
            askable: true,
        };
    }
    return {
        status: 'unknown',
        detail: `${sentence}. Your work authorization is not on your profile.`,
        restriction: deciding,
        region,
        askable: true,
    };
}

/** The question that settles an unknown, and the answers it offers. */
export function workAuthQuestionPrompt(outcome: EligibilityOutcome): { prompt: string; options: { value: string; label: string }[] } {
    const region = outcome.region ?? 'us';
    const adjective = REGION_ADJECTIVE[region];
    const name = REGION_NAME[region];
    const phrase = restrictionPhrase(outcome.restriction, outcome.region);
    return {
        prompt: `This role ${phrase}. Which describes you?`,
        options: [
            { value: `${adjective} citizen`, label: `${adjective} citizen` },
            { value: `${adjective} permanent resident`, label: region === 'us' ? 'Green card holder' : 'Permanent resident' },
            { value: `Authorized to work in ${name} on a visa`, label: 'Work visa' },
            { value: `Not authorized to work in ${name}`, label: 'Not authorized' },
        ],
    };
}
