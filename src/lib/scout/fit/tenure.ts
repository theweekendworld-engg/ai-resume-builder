/**
 * Years of experience from role dates, the way a recruiter counts them.
 * Pure, no IO.
 *
 * The first version took the earliest start year from now: an engineer with
 * two internships (May–Jul 2023, Mar–May 2024) and full-time work from June
 * 2024 was told "Asks for 3+ years; you have 3", and "3 years of experience"
 * led the Jobs list as their top strength (QA 2026-11-07). A recruiter counts
 * about two years full-time, plus internships. So:
 *
 *   - Internship, trainee, co-op and apprentice roles are counted apart, never
 *     as full-time experience. They are mentioned, not added.
 *   - Overlapping roles are merged, so a side contract during a job is not
 *     double time.
 *   - Months, not calendar years. "2024–2026" is not two years when it is
 *     June 2024 to January 2026.
 *   - A year with no month counts from mid-year: "2019" might be January or
 *     December, and the middle overstates neither way by more than six months.
 *   - Display rounds DOWN to the half year ("about 2 years" for 29 months),
 *     because a requirement is met or not by the real number, and the words
 *     must never claim more than the dates do.
 */

export type DatedRole = {
    role: string;
    company: string;
    startDate: string;
    endDate: string;
    current: boolean;
};

export type RoleSpan = {
    /** Length of the role, in months. */
    months: number;
    internship: boolean;
    current: boolean;
    /** Months between the role's end and now; 0 for a current role. */
    monthsSinceEnd: number;
};

export type Tenure = {
    /** Full-time months, overlaps merged. Null when no role has a usable date. */
    fullTimeMonths: number | null;
    /** Internship-type months, merged among themselves. */
    internshipMonths: number;
    /** Each role's span, keyed by "Role at Company" (the record line source). */
    spans: Record<string, RoleSpan>;
};

/** Titles that are not full-time experience, whatever their dates say. */
const INTERNSHIP_TITLE = /\b(?:interns?|internship|trainee|co-?op|apprentice(?:ship)?|working student|summer (?:analyst|associate|engineer|intern))\b/i;

export function isInternshipRole(role: Pick<DatedRole, 'role' | 'company'>): boolean {
    return INTERNSHIP_TITLE.test(role.role) || /\((?:intern(?:ship)?|co-?op)\)/i.test(role.company);
}

/** A short miss on a years requirement is partial; more than this is a gap. */
export const NEAR_MISS_MONTHS = 6;

const DAY = 86_400_000;
const MONTH_DAYS = 30.4375;

const MONTH_NAMES: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const PRESENT = /^(?:present|current(?:ly)?|now|today|ongoing|till date|to date|date|continuing)$/i;

/** {year, month 0–11}, 'present', or null. A bare year resolves to mid-year. */
export function parseRoleDate(value: string | null | undefined, edge: 'start' | 'end'): { year: number; month: number } | 'present' | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (PRESENT.test(raw)) return 'present';

    let match = raw.match(/\b((?:19|20)\d{2})[-/.](\d{1,2})\b/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return { year: Number(match[1]), month: Number(match[2]) - 1 };
    match = raw.match(/\b(\d{1,2})[-/.]((?:19|20)\d{2})\b/);
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) return { year: Number(match[2]), month: Number(match[1]) - 1 };
    match = raw.match(/\b([a-z]{3,9})\.?\s*,?\s*'?((?:19|20)\d{2}|\d{2})\b/i);
    if (match && MONTH_NAMES[match[1].toLowerCase()] !== undefined) {
        const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
        return { year, month: MONTH_NAMES[match[1].toLowerCase()] };
    }
    match = raw.match(/\b((?:19|20)\d{2})\b/);
    if (match) return { year: Number(match[1]), month: edge === 'start' ? 6 : 5 };
    return null;
}

type Interval = { start: number; end: number };

function mergedMonths(intervals: Interval[]): number {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    let total = 0;
    let current: Interval | null = null;
    for (const next of sorted) {
        if (!current) { current = { ...next }; continue; }
        if (next.start <= current.end) current.end = Math.max(current.end, next.end);
        else { total += current.end - current.start; current = { ...next }; }
    }
    if (current) total += current.end - current.start;
    return total / DAY / MONTH_DAYS;
}

/**
 * Full-time and internship months from role dates.
 *
 * A past role with no end date (and not marked current) ends where the next
 * role starts, or now if none does: roles are mostly back to back, and a
 * blank end should neither erase the role nor run it to today behind a later
 * job.
 */
export function computeTenure(roles: readonly DatedRole[], now: Date = new Date()): Tenure {
    const nowMs = now.getTime();
    const dated = roles.map((role) => {
        const start = parseRoleDate(role.startDate, 'start');
        const startMs = start && start !== 'present' ? Date.UTC(start.year, start.month, 1) : null;
        return { role, startMs };
    });

    const spans: Record<string, RoleSpan> = {};
    const fullTime: Interval[] = [];
    const internships: Interval[] = [];
    for (const { role, startMs } of dated) {
        if (startMs === null || startMs > nowMs) continue;
        const end = role.current ? 'present' : parseRoleDate(role.endDate, 'end');
        let endMs: number;
        if (end === 'present') endMs = nowMs;
        else if (end) endMs = Date.UTC(end.year, end.month + 1, 1);
        else {
            const later = dated
                .map((other) => other.startMs)
                .filter((other): other is number => other !== null && other > startMs)
                .sort((a, b) => a - b)[0];
            endMs = later ?? nowMs;
        }
        endMs = Math.min(endMs, nowMs);
        // An end before its start is a typo; the role still happened, for a month.
        if (endMs <= startMs) endMs = Math.min(nowMs, Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth() + 1, 1));

        const internship = isInternshipRole(role);
        (internship ? internships : fullTime).push({ start: startMs, end: endMs });
        const key = `${role.role} at ${role.company}`.trim();
        const months = (endMs - startMs) / DAY / MONTH_DAYS;
        const span: RoleSpan = {
            months,
            internship,
            current: end === 'present' || endMs >= nowMs,
            monthsSinceEnd: Math.max(0, (nowMs - endMs) / DAY / MONTH_DAYS),
        };
        const existing = spans[key];
        spans[key] = existing ? { ...span, months: Math.max(existing.months, months) } : span;
    }

    const anyDated = fullTime.length + internships.length > 0;
    return {
        fullTimeMonths: anyDated ? mergedMonths(fullTime) : null,
        internshipMonths: mergedMonths(internships),
        spans,
    };
}

/** "about 2 years", "about 2.5 years", "about 8 months". Rounded down. */
export function describeMonths(months: number): string {
    if (months < 1) return 'less than a month';
    if (months < 12) {
        const whole = Math.floor(months);
        return `about ${whole} month${whole === 1 ? '' : 's'}`;
    }
    const halves = Math.floor(months / 6) / 2;
    return `about ${halves % 1 === 0 ? halves.toFixed(0) : halves.toFixed(1)} year${halves === 1 ? '' : 's'}`;
}

/**
 * Full-time tenure in words: "about 2 years full-time (plus internships)",
 * or "no full-time experience yet (internships only)".
 */
export function describeFullTime(fullTimeMonths: number, internshipMonths: number): string {
    const plus = internshipMonths >= 1 ? ' (plus internships)' : '';
    if (fullTimeMonths < 1) return internshipMonths >= 1 ? 'no full-time experience yet (internships only)' : 'no full-time experience yet';
    return `${describeMonths(fullTimeMonths)} full-time${plus}`;
}
