/**
 * The parts of a job posting a regex reads better than a model.
 *
 * Work mode, employment type, the stated pay and the stated years are all
 * phrases the posting either contains or does not. Asking a model for them
 * invites the one failure this product cannot have: a plausible number that
 * is not on the page. So every value here is either QUOTED from the text —
 * the exact substring, never reformatted — or null.
 */

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

// ─────────────────────────────────────────────────────────────── apply url

const APPLY_HOST = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|careers?\.|\/careers?\/|\/jobs?\/|apply)/i;

export function extractApplyUrl(params: { sourceUrl: string | null; linkKind: string; text: string }): string | null {
    if (params.sourceUrl && (params.linkKind === 'linkedin_job' || params.linkKind === 'ats_job')) return params.sourceUrl;
    const urls = params.text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
    const apply = urls.map((url) => url.replace(/[.,;:!?]+$/, '')).find((url) => APPLY_HOST.test(url));
    return apply ?? null;
}
