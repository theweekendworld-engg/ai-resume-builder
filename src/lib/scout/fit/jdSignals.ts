/**
 * The parts of a job posting a regex reads better than a model.
 *
 * Work mode, employment type, the stated pay and the stated years are all
 * phrases the posting either contains or does not. Asking a model for them
 * invites the one failure this product cannot have: a plausible number that
 * is not on the page. So every value here is either QUOTED from the text —
 * the exact substring, never reformatted — or null.
 */

import { REGION_ADJECTIVE, REGION_NAME, regionFromToken, regionOf, type RegionCode } from '@/lib/scout/fit/region';
import type { WorkMode } from '@/lib/scout/types';

function clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────── work mode

const NEGATED_REMOTE = /\b(?:not|no|non)[\s-]+(?:an?\s+|fully\s+)?remote\b|\bremote\s+(?:is\s+)?not\s+(?:possible|available|an option)\b/i;
const HYBRID = /\bhybrid\b/i;
const REMOTE = /\b(?:remote|work from home|wfh|fully distributed|remote[\s-]first|anywhere in)\b/i;
const ONSITE = /\b(?:on[\s-]?site|in[\s-]office|work from office|wfo|in[\s-]person)\b/i;

/**
 * Work mode, in order of how specific the evidence is.
 *
 * LinkedIn puts the workplace type beside the location — "Bengaluru (Hybrid)"
 * — and that label is set by the employer in a dropdown, so it outranks any
 * sentence in the body. In the body, hybrid outranks remote because "remote
 * two days a week" is a hybrid role that mentions the word remote.
 */
export function detectWorkMode(params: { location?: string | null; title?: string | null; text: string }): WorkMode {
    const label = `${params.location ?? ''} ${params.title ?? ''}`;
    if (/\(\s*hybrid\s*\)/i.test(label)) return 'hybrid';
    if (/\(\s*remote\s*\)/i.test(label)) return 'remote';
    if (/\(\s*on[\s-]?site\s*\)/i.test(label)) return 'onsite';

    const text = params.text;
    if (HYBRID.test(text)) return 'hybrid';
    // "Not a remote role" contains the word remote; the negation decides it.
    if (NEGATED_REMOTE.test(text)) return 'onsite';
    if (REMOTE.test(text)) return 'remote';
    if (ONSITE.test(text)) return 'onsite';
    return 'unknown';
}

// ──────────────────────────────────────────────────────── employment type

const EMPLOYMENT_TYPES: [RegExp, string][] = [
    [/\bintern(?:ship)?\b/i, 'Internship'],
    [/\bcontract(?:or)?\b(?!\s+(?:negotiat|management|law))/i, 'Contract'],
    [/\bpart[\s-]time\b/i, 'Part-time'],
    [/\btemporary\b/i, 'Temporary'],
    [/\bfull[\s-]time\b/i, 'Full-time'],
];

/**
 * LinkedIn's criteria block states "Employment type Full-time" explicitly;
 * that is checked first. Only then the body, where "full-time" is the default
 * reading and "internship" the most consequential one to miss.
 */
export function detectEmploymentType(text: string): string | null {
    const criteria = text.match(/employment type\s*[:\-]?\s*(full[\s-]time|part[\s-]time|contract|internship|temporary|volunteer|other)/i);
    if (criteria) {
        const hit = EMPLOYMENT_TYPES.find(([pattern]) => pattern.test(criteria[1]));
        return hit ? hit[1] : clean(criteria[1]);
    }
    for (const [pattern, label] of EMPLOYMENT_TYPES) {
        if (pattern.test(text)) return label;
    }
    return null;
}

// ──────────────────────────────────────────────────────────── compensation

/**
 * Pay phrases, quoted as found. Ordered most-specific first so a range beats
 * a lone figure inside it.
 *
 * India first-class: "₹25-40 LPA", "INR 30,00,000", "40 lakhs", "CTC". The
 * currency has to be ON the page — a bare "25-40" next to the word salary is
 * not a pay statement we can quote, it is a guess about units.
 */
const PAY_PATTERNS: RegExp[] = [
    // ₹ / INR / Rs ranges and single values, with an optional LPA/lakh/crore/k unit
    /(?:₹|\bINR\b|\bRs\.?)\s?\d[\d,.]*\s*(?:lakhs?|lacs?|lpa|cr(?:ore)?s?|k|l)?(?:\s*(?:-|–|to)\s*(?:₹|\bINR\b|\bRs\.?)?\s?\d[\d,.]*\s*(?:lakhs?|lacs?|lpa|cr(?:ore)?s?|k|l)?)?(?:\s*(?:per annum|p\.?a\.?|\/\s?(?:year|yr|annum)|per year|a year|ctc))?/i,
    // "25-40 LPA", "18 LPA", "12 lakhs per annum"
    /\b\d[\d,.]*\s*(?:(?:-|–|to)\s*\d[\d,.]*\s*)?(?:lpa|lakhs?\s+per\s+annum|lacs?\s+per\s+annum)\b/i,
    // $ / USD / € / £ ranges and single values
    /(?:\$|\bUSD\s?|€|\bEUR\s?|£|\bGBP\s?)\d[\d,.]*\s*[kKmM]?(?:\s*(?:-|–|to)\s*(?:\$|\bUSD\s?|€|\bEUR\s?|£|\bGBP\s?)?\d[\d,.]*\s*[kKmM]?)?(?:\s*(?:USD|EUR|GBP))?(?:\s*(?:per|\/|a)\s*(?:year|yr|annum|hour|hr|month|mo))?/,
];

/** Things that look like money and are not pay. */
const NOT_PAY_CONTEXT = /\b(?:raised|funding|valuation|revenue|series [a-e]|arr|budget|customers?|users?|market)\b/i;

export function extractCompensationText(text: string): string | null {
    for (const pattern of PAY_PATTERNS) {
        const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        for (const match of text.matchAll(global)) {
            const quoted = clean(match[0]);
            if (!/\d/.test(quoted)) continue;
            const start = match.index ?? 0;
            const window = text.slice(Math.max(0, start - 60), start);
            // "We raised $40M" is not a salary. The words before the figure decide.
            if (NOT_PAY_CONTEXT.test(window) && !/\b(?:salary|pay|compensation|ctc|base|package|stipend)\b/i.test(window)) continue;
            return quoted;
        }
    }
    return null;
}

// ────────────────────────────────────────────────────────────── experience

/**
 * The years phrase itself — "3+ years", "5-8 years" — plus "of experience"
 * only when those words directly follow. The old pattern allowed a dangling
 * "of" and stopped at the first word it did not list, so "3+ years of
 * non-internship professional experience" was quoted as "3+ years of", and
 * the detail line read "Asks for 3+ years of; you have 2".
 */
const EXPERIENCE = /\b\d{1,2}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b(?:\s+of\s+experience\b|\s+experience\b)?/i;

/** "3+ years", quoted. The first stated figure is the floor. */
export function extractExperienceText(text: string): string | null {
    const match = text.match(EXPERIENCE);
    return match ? clean(match[0]) : null;
}

/** The minimum years a quoted experience phrase states, or null. */
export function minYearsFrom(experienceText: string | null | undefined): number | null {
    if (!experienceText) return null;
    const match = experienceText.match(/(\d{1,2})/);
    if (!match) return null;
    const years = Number(match[1]);
    return Number.isFinite(years) && years <= 40 ? years : null;
}

/** The user's stated years ("5", "5+", "5 years"), or null. Never inferred. */
export function parseYears(value: string | null | undefined): number | null {
    const match = String(value ?? '').match(/(\d{1,2}(?:\.\d)?)/);
    if (!match) return null;
    const years = Number(match[1]);
    return Number.isFinite(years) && years <= 60 ? years : null;
}

// ─────────────────────────────────────────────────────────────── location

/** "Location: Pune, India" in a body, when the page gave no location field. */
export function extractLocation(text: string): string | null {
    const match = text.match(/\b(?:location|based in|office)\s*[:\-]\s*([A-Z][\w .,'()-]{2,60})/);
    return match ? clean(match[1]).replace(/[.,;]+$/, '') : null;
}

// ──────────────────────────────────────────────────────────── sponsorship

export type SponsorshipStance = 'offered' | 'not_offered' | 'unstated';

export function detectSponsorship(text: string): SponsorshipStance {
    if (/\b(?:no|not|unable to|cannot|can't|will not|won't)\b[^.]{0,40}\b(?:sponsor|sponsorship)\b/i.test(text)) return 'not_offered';
    if (/\bmust (?:be|have) (?:legally )?(?:authori[sz]ed|eligible) to work\b/i.test(text)) return 'not_offered';
    if (/\b(?:visa )?sponsorship (?:is )?(?:available|provided|offered)\b|\bwe (?:will|can) sponsor\b/i.test(text)) return 'offered';
    return 'unstated';
}

// ──────────────────────────────────────────────────────────── eligibility

/**
 * Who is allowed to take the job at all, which no amount of matching skill
 * changes. Read by code because the failure is a person told "strong fit" for
 * a role they cannot legally hold: on 2026-11-07 "Must obtain HHS Public
 * Trust before onboarding" was scored as an ordinary must-have for an
 * engineer in Bengaluru, and the remote US role was told location should not
 * decide it.
 *
 *   citizenship          "Must be a U.S. citizen", "US citizenship required"
 *   citizen_or_resident  "US citizens and green card holders", ITAR / "U.S. person"
 *   clearance            "active Secret clearance", "TS/SCI", "ability to obtain a clearance"
 *   public_trust         "HHS Public Trust", "Public Trust clearance"
 *   work_authorization   "authorized to work in the US", "without sponsorship"
 *   region_only          "US only", "must reside in Canada", "Remote - US", "DMV preferred"
 *
 * Every restriction quotes the phrase it came from. Negated phrases ("no
 * clearance required", "citizenship is not required") are not restrictions.
 */
export type EligibilityKind = 'citizenship' | 'citizen_or_resident' | 'clearance' | 'public_trust' | 'work_authorization' | 'region_only';

export type EligibilityRestriction = {
    kind: EligibilityKind;
    /** Where it applies; null when the posting does not say and nothing implies it. */
    region: RegionCode | null;
    /** The phrase, exactly as the posting has it. */
    quote: string;
    /** How it reads in a sentence: "HHS Public Trust", "a Secret clearance", "US citizenship". */
    label: string;
    /** "DMV preferred": a scope the posting prefers rather than requires. */
    preferred?: boolean;
};

const NEGATION_BEFORE = /\b(?:no|not|without|never|n't|nor|neither)\b[^.;:\n]{0,30}$/i;
const NEGATION_AFTER = /^[^.;\n]{0,25}\b(?:not|isn't|is not)\s+(?:required|needed|necessary|a requirement)\b|^[^.;\n]{0,12}\bnot required\b/i;

function negated(text: string, start: number, end: number): boolean {
    return NEGATION_BEFORE.test(text.slice(Math.max(0, start - 40), start)) || NEGATION_AFTER.test(text.slice(end, end + 40));
}

/** A region alternation, matched case-insensitively and validated by `regionFromToken`. */
const REGION_WORDS = String.raw`u\.?\s?s\.?a?|united states(?: of america)?|american|america|u\.?k\.?|united kingdom|britain|canada|india|europe|e\.?u\.?|european union|emea|apac|latam|germany|ireland|australia|singapore`;

type Finder = { kind: EligibilityKind; pattern: RegExp; build: (match: RegExpMatchArray, text: string) => Omit<EligibilityRestriction, 'kind' | 'quote'> | null };

const FINDERS: Finder[] = [
    {
        kind: 'clearance',
        pattern: /\b(?:(?:active|current|interim)\s+)?(?:top[\s-]secret(?:\s*\/\s*sci)?|ts\s*\/\s*sci|secret|dod|doe\s+[ql])\s+(?:security\s+)?clearance\b|\b(?:obtain|hold|have|possess|maintain|eligible for|eligibility for)\s+(?:an?\s+)?(?:active\s+)?(?:u\.?s\.?\s+)?(?:government\s+|federal\s+)?security\s+clearance\b|\bts\s*\/\s*sci\b/gi,
        build: (match) => {
            const quote = match[0];
            const label = /top[\s-]secret|ts\s*\/\s*sci/i.test(quote) ? 'a Top Secret clearance' : /\bsecret\b/i.test(quote) ? 'a Secret clearance' : 'a US security clearance';
            return { region: 'us', label };
        },
    },
    {
        kind: 'public_trust',
        pattern: /\b(?:([A-Z]{2,6})\s+)?public\s+trust\b/gi,
        build: (match, text) => {
            const at = match.index ?? 0;
            const around = text.slice(Math.max(0, at - 60), at + match[0].length + 60);
            const agency = match[1] && match[1] === match[1].toUpperCase() ? match[1] : null;
            // "building public trust in AI" is prose. A clearance has words around it.
            if (!agency && !/\b(?:clearance|obtain|position|investigation|eligib\w*|background|suitability|must|requir\w*|able to|moderate|high|tier|level|adjudicat\w*|onboarding)\b/i.test(around)) return null;
            return { region: 'us', label: agency ? `${agency} Public Trust` : 'a Public Trust clearance' };
        },
    },
    {
        kind: 'citizen_or_resident',
        pattern: new RegExp(String.raw`\b(${REGION_WORDS})\s+citizens?\s+(?:and|or|\/)\s+(?:green\s+card\s+holders|permanent\s+residents|lawful\s+permanent\s+residents)\b|\bitar\b|\b(${REGION_WORDS})\s+persons?\b(?=[^.]{0,80}\b(?:itar|ear|export)\b)`, 'gi'),
        build: (match) => {
            const token = match[1] ?? match[2] ?? 'US';
            const region = /^itar$/i.test(match[0].trim()) ? 'us' : regionFromToken(token);
            return region ? { region, label: `${REGION_ADJECTIVE[region]} citizenship or permanent residency` } : null;
        },
    },
    {
        kind: 'citizenship',
        pattern: new RegExp(String.raw`\b(${REGION_WORDS})\s+citizen(?:ship|s)?\b(?!\s+(?:and|or|\/)\s+(?:green|permanent|lawful))|\bcitizen(?:ship)?\s+of\s+(?:the\s+)?(${REGION_WORDS})\b`, 'gi'),
        build: (match, text) => {
            const at = match.index ?? 0;
            const around = text.slice(Math.max(0, at - 50), at + match[0].length + 40);
            // "US citizenship" in a benefits paragraph is not a condition; a requirement has a verb.
            if (!/\b(?:must|required?|requires|requirement|only|need(?:ed|s)?|eligib\w*|be a|are a|mandatory|preferred)\b/i.test(around)) return null;
            const region = regionFromToken(match[1] ?? match[2] ?? '');
            return region ? { region, label: `${REGION_ADJECTIVE[region]} citizenship` } : null;
        },
    },
    {
        kind: 'work_authorization',
        pattern: new RegExp(String.raw`\b(?:legally\s+)?(?:authori[sz]ed|eligible|permitted|able)\s+to\s+(?:legally\s+)?work\s+in\s+(?:the\s+)?(${REGION_WORDS})\b|\b(?:valid\s+)?(${REGION_WORDS})\s+work\s+(?:authori[sz]ation|permit)\b|\bwithout\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+|future\s+)?(?:visa\s+|employer\s+|immigration\s+)?sponsorship\b`, 'gi'),
        build: (match) => {
            const token = match[1] ?? match[2];
            const region = token ? regionFromToken(token) : null;
            return {
                region,
                label: region ? `authorization to work in ${REGION_NAME[region]}` : 'work authorization without sponsorship',
            };
        },
    },
    {
        kind: 'region_only',
        pattern: new RegExp(
            [
                // "US only", "US-based only", "US residents only"
                String.raw`\b(${REGION_WORDS})[\s-]+(?:based\s+)?(?:only|residents\s+only|candidates\s+only|applicants\s+only)\b`,
                // "must reside in the US", "must be based in Canada"
                String.raw`\bmust\s+(?:be\s+)?(?:reside|live|located|based|residing|living)\s+in\s+(?:the\s+)?(${REGION_WORDS})\b`,
                // "only open to candidates in the US"
                String.raw`\bonly\s+(?:open\s+to|considering|accepting|hiring)\s+(?:candidates|applicants|people|residents)?\s*(?:who\s+(?:are|live)\s+)?(?:based\s+|located\s+|residing\s+|living\s+)?in\s+(?:the\s+)?(${REGION_WORDS})\b`,
                // "Remote - US", "Remote (US)", "Remote within the US", "remote, United States"
                String.raw`\bremote(?:\s+(?:role|position|job|opportunity|work|team))?\s*(?:[-–—,:(/|]\s*|\s+(?:in|within|from|across|based in|anywhere in)\s+)(?:the\s+)?(${REGION_WORDS})\b`,
                // "US Remote", "US-remote"
                String.raw`\b(${REGION_WORDS})[\s-]+remote\b`,
            ].join('|'),
            'gi',
        ),
        build: (match) => {
            const token = match.slice(1).find((group) => typeof group === 'string' && group.trim());
            const region = token ? regionFromToken(token) : null;
            return region ? { region, label: `${REGION_NAME[region]} only` } : null;
        },
    },
    {
        kind: 'region_only',
        pattern: /\b(?:dmv|d\.c\.\s+(?:metro\s+)?area|washington,?\s*d\.?\s?c\.?(?:\s+metro(?:politan)?)?(?:\s+area)?)\b(?:\s+(?:area|region|metro))?(?:\s+(?:preferred|only|required|based|candidates))?(?!\s+(?:record|check|report|printout|history))/gi,
        build: (match) => ({ region: 'us', label: 'the DC area (US)', preferred: /\bpreferred\b/i.test(match[0]) || undefined }),
    },
];

/**
 * Every eligibility restriction the posting states, in the order the finders
 * run (strictest kind first), at most one per kind and region.
 */
export function detectEligibility(text: string | null | undefined): EligibilityRestriction[] {
    if (!text) return [];
    const out: EligibilityRestriction[] = [];
    for (const finder of FINDERS) {
        const matches: RegExpMatchArray[] = [...text.matchAll(finder.pattern)];
        for (const match of matches) {
            const start: number = match.index ?? 0;
            const end = start + match[0].length;
            if (negated(text, start, end)) continue;
            const built = finder.build(match, text);
            if (!built) continue;
            if (out.some((existing) => existing.kind === finder.kind && existing.region === built.region)) continue;
            // "Remote (India)" stops before its own bracket; the quote keeps it.
            let quote = match[0];
            if ((quote.match(/\(/g)?.length ?? 0) > (quote.match(/\)/g)?.length ?? 0) && text[end] === ')') quote += ')';
            out.push({ kind: finder.kind, quote: clean(quote), ...built });
        }
    }
    // "authorized to work in the US … without sponsorship": the placed one says it all.
    return out.filter((restriction) => restriction.region !== null
        || !out.some((other) => other !== restriction && other.kind === restriction.kind && other.region !== null));
}

export type RegionScope = {
    region: RegionCode;
    /** What to show beside it: the location field, or the phrase from the posting. */
    quote: string;
    /** "DMV preferred": still a scope, but the posting's word for it is "preferred". */
    preferred: boolean;
};

/**
 * Where a remote role may be done from, when the posting says. The location
 * field first ("Remote - US" is set by the employer), then the body's own
 * restriction phrases. Null when the posting states no region, or says
 * anywhere.
 */
export function detectRegionScope(params: { location: string | null; text: string }): RegionScope | null {
    const location = params.location?.trim() || null;
    if (location) {
        const region = regionOf(location);
        // A remote-or-region-only location field; a city is a location, not a scope.
        if (region && (/\bremote\b/i.test(location) || regionFromToken(location) !== null)) {
            return { region, quote: location, preferred: false };
        }
    }
    const scoped = detectEligibility(`${location ?? ''}\n${params.text}`).find((restriction) => restriction.kind === 'region_only' && restriction.region);
    return scoped && scoped.region ? { region: scoped.region, quote: scoped.quote, preferred: Boolean(scoped.preferred) } : null;
}

// ─────────────────────────────────────────────────────────────── apply url

const APPLY_HOST = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|careers?\.|\/careers?\/|\/jobs?\/|apply)/i;

export function extractApplyUrl(params: { sourceUrl: string | null; linkKind: string; text: string }): string | null {
    if (params.sourceUrl && (params.linkKind === 'linkedin_job' || params.linkKind === 'ats_job')) return params.sourceUrl;
    const urls = params.text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
    const apply = urls.map((url) => url.replace(/[.,;:!?]+$/, '')).find((url) => APPLY_HOST.test(url));
    return apply ?? null;
}
