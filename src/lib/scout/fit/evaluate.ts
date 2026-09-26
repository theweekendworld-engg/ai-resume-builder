/**
 * The fit verdict, as rules over facts. Pure: no database, no model.
 *
 * Every conclusion here has to survive "how do you know?" from the user it is
 * about, so each one is traceable to either a line of their record, a line of
 * the posting, or a preference they stated. A model writes the two-sentence
 * summary afterwards, from these fields only.
 *
 * ── Why a question is asked only when it changes the verdict ──────────────
 *
 * A missing preference is an unknown, and unknowns are normal. Asking about
 * every one would turn Scout into a form. So each unknown is simulated both
 * ways — as a conflict and as a match — and a question is asked only if the
 * two verdicts differ. "Would you relocate to Pune?" is worth an interruption
 * when the answer decides fit; it is noise when the role is already a stretch
 * on skills either way.
 */

import type { PendingQuestion } from '@/lib/agent/run';
import { findMatchedSkills } from '@/lib/extension/fitScore';
import { classifyFamily } from '@/lib/radar/role';
import type { UserGenerationPreferences } from '@/lib/userPreferences';
import type { FitData, FitVerdict, JdData, PreferenceCheck, PreferenceKey } from '@/lib/scout/types';
import { applyAnswers, isPreferenceQuestionId, type PreferenceQuestionId } from '@/lib/scout/fit/answers';
import { minYearsFrom, detectSponsorship } from '@/lib/scout/fit/jdSignals';
import { comparePay, parseMoney } from '@/lib/scout/fit/money';
import { fallbackJudgements, planMatching, type Judgement, type MatchPlan } from '@/lib/scout/fit/match';

// ───────────────────────────────────────────────────────────────── record

export type RecordLine = { text: string; source: string };

export const PROFILE_SUMMARY_SOURCE = 'Profile summary';

/** The user's working life, flattened for matching. Current AND past roles. */
export type FitRecord = {
    lines: RecordLine[];
    /** Normalised text of every line, for skill matching. */
    corpus: string;
    /** Stated years, else derived from role dates; null when neither exists. */
    years: number | null;
    yearsSource: 'stated' | 'roles' | null;
    location: string;
    defaultTitle: string;
    /** True when there is nothing to match against. */
    empty: boolean;
};

export function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export type RecordInput = {
    profile: { location: string; defaultTitle: string; defaultSummary: string; yearsExperience: string };
    experiences: {
        company: string;
        role: string;
        startDate: string;
        endDate: string;
        current: boolean;
        description: string;
        highlights: string[];
    }[];
    projects: { name: string; description: string; technologies: string[] }[];
    /** Degrees answer degree and CS-fundamentals requirements. */
    education?: { institution: string; degree: string; fieldOfStudy: string }[];
    /** skill → where it is evidenced (from `getSkillsWithEvidence`). */
    skills?: { skill: string; evidence: string[] }[];
    now?: Date;
};

function yearOf(value: string): number | null {
    const match = String(value || '').match(/\b(19[5-9]\d|20\d{2})\b/);
    return match ? Number(match[1]) : null;
}

export function buildFitRecord(input: RecordInput): FitRecord {
    const lines: RecordLine[] = [];
    for (const role of input.experiences) {
        const where = `${role.role} at ${role.company}`.trim();
        const specifics = role.highlights.map((line) => line.trim()).filter(Boolean);
        if (specifics.length) {
            for (const line of specifics) lines.push({ text: line, source: where });
        } else if (role.description.trim()) {
            lines.push({ text: role.description.trim(), source: where });
        }
        // The title itself is evidence ("Senior Backend Engineer at X").
        lines.push({ text: where, source: where });
    }
    for (const project of input.projects) {
        const tech = project.technologies.length ? ` (${project.technologies.join(', ')})` : '';
        const text = `${project.name}: ${project.description}`.trim() + tech;
        lines.push({ text, source: `Project: ${project.name}` });
    }
    for (const school of input.education ?? []) {
        const text = [school.degree, school.fieldOfStudy].filter((part) => part?.trim()).join(', ');
        if (text || school.institution) lines.push({ text: `${text}${text ? ', ' : ''}${school.institution}`.trim(), source: 'Education' });
    }
    if (input.profile.defaultSummary.trim()) {
        lines.push({ text: input.profile.defaultSummary.trim(), source: PROFILE_SUMMARY_SOURCE });
    }
    for (const entry of input.skills ?? []) {
        lines.push({ text: `${entry.skill} — ${entry.evidence.join('; ')}`, source: entry.evidence[0] ?? 'Skills' });
    }

    const stated = parseStatedYears(input.profile.yearsExperience);
    let years = stated;
    let yearsSource: FitRecord['yearsSource'] = stated === null ? null : 'stated';
    if (years === null && input.experiences.length) {
        const now = (input.now ?? new Date()).getUTCFullYear();
        const starts = input.experiences.map((role) => yearOf(role.startDate)).filter((y): y is number => y !== null);
        if (starts.length) {
            years = Math.max(0, now - Math.min(...starts));
            yearsSource = 'roles';
        }
    }

    const hasWork = input.experiences.length > 0 || input.projects.length > 0;
    return {
        lines,
        corpus: normalizeForMatch(lines.map((line) => line.text).join(' ')),
        years,
        yearsSource,
        location: input.profile.location.trim(),
        defaultTitle: input.profile.defaultTitle.trim(),
        empty: !hasWork,
    };
}

function parseStatedYears(value: string): number | null {
    const match = String(value ?? '').match(/(\d{1,2}(?:\.\d)?)/);
    if (!match) return null;
    const years = Number(match[1]);
    return Number.isFinite(years) && years <= 60 ? years : null;
}

// ─────────────────────────────────────────────────────────── requirements

function quote(line: RecordLine): string {
    const text = line.text.length > 180 ? `${line.text.slice(0, 177).trimEnd()}…` : line.text;
    return line.source && !text.includes(line.source) ? `${text} (${line.source})` : text;
}

/** One scored requirement's outcome. `credit` is what it adds to coverage. */
export type RequirementResult = {
    requirementId: string;
    text: string;
    kind: 'must' | 'nice';
    /** 1 direct, 0.5 partial, 0 gap. */
    credit: number;
    evidence: string | null;
    severity: 'blocking' | 'minor' | null;
};

/**
 * Apply the matcher's judgements, and judge years in code.
 *
 * Years are never the model's call, and never evidence for anything but
 * years. A pure tenure requirement ("3+ years of professional software
 * development") is met by tenure. A qualified one ("2+ years of design or
 * architecture") needs tenure AND a line showing the design work: tenure
 * alone leaves it a gap, the line alone makes it partial. That second rule is
 * the one that was broken — "2 years of experience" was quoted back as proof
 * of architecture experience.
 */
export function applyJudgements(params: {
    plan: MatchPlan;
    judgements: Map<string, Judgement>;
    record: FitRecord;
}): RequirementResult[] {
    const { plan, judgements, record } = params;
    const years = record.years;
    const yearsBasis = record.yearsSource === 'stated' ? 'stated on your profile' : 'from your role dates';

    return plan.hard.map((requirement): RequirementResult => {
        const kind = requirement.kind === 'nice' ? 'nice' : 'must';
        const isMust = kind === 'must';
        const base = { requirementId: requirement.id, text: requirement.text, kind } as const;

        const pure = plan.pureTenure.get(requirement.id);
        if (pure) {
            if (years !== null && years >= pure.minYears) {
                return { ...base, credit: 1, evidence: `${years} years of experience (${yearsBasis})`, severity: null };
            }
            // Unknown years, or short by at most a year: a gap, but not a wall.
            const close = years === null || years >= pure.minYears - 1;
            return { ...base, credit: 0, evidence: null, severity: isMust && !close ? 'blocking' : 'minor' };
        }

        const judgement = plan.prefiltered.get(requirement.id) ?? judgements.get(requirement.id);
        const line = judgement && judgement.lineIndex !== null ? record.lines[judgement.lineIndex] ?? null : null;
        let credit = line ? (judgement?.strength === 'direct' ? 1 : 0.5) : 0;
        // A profile summary is the user describing themselves ("strong interest
        // in distributed systems"), not a record of doing the thing. It can
        // support a requirement, never settle one.
        if (line && line.source === PROFILE_SUMMARY_SOURCE) credit = Math.min(credit, 0.5);

        const qualified = plan.qualifiedTenure.get(requirement.id);
        if (qualified && line) {
            const tenureMet = years !== null && years >= qualified.minYears;
            if (!tenureMet) credit = Math.min(credit, 0.5);
        }

        if (!line) return { ...base, credit: 0, evidence: null, severity: isMust ? 'blocking' : 'minor' };
        return { ...base, credit, evidence: quote(line), severity: null };
    });
}

/**
 * "Evidence for 5 of 10" read as half covered, next to a "not a fit" verdict
 * that counted four of the five as partial. Say which is which.
 */
export function mustEvidenceSentence(results: readonly RequirementResult[], mustTotal: number): string {
    const musts = results.filter((result) => result.kind === 'must');
    const direct = musts.filter((result) => result.credit >= 1).length;
    const partial = musts.filter((result) => result.credit > 0 && result.credit < 1).length;
    if (direct + partial === 0) return `Your record shows no evidence for any of the ${mustTotal} must-have requirements`;
    const parts = [
        direct ? `clear evidence for ${direct}` : null,
        partial ? `partial evidence for ${partial}` : null,
    ].filter(Boolean).join(' and ');
    return `Of ${mustTotal} must-have requirements, your record shows ${parts}`;
}

export type Coverage = {
    /** Hard musts with any evidence (direct or partial). */
    mustCovered: number;
    mustTotal: number;
    /** Weighted coverage of hard musts, 0–1; null when there are none. */
    mustRatio: number | null;
    niceRatio: number | null;
    /** Hard musts with no evidence at all. */
    uncoveredMusts: number;
};

export function coverageOf(results: readonly RequirementResult[]): Coverage {
    const musts = results.filter((result) => result.kind === 'must');
    const nices = results.filter((result) => result.kind === 'nice');
    const ratio = (list: readonly RequirementResult[]) =>
        list.length ? list.reduce((sum, result) => sum + result.credit, 0) / list.length : null;
    return {
        mustCovered: musts.filter((result) => result.credit > 0).length,
        mustTotal: musts.length,
        mustRatio: ratio(musts),
        niceRatio: ratio(nices),
        uncoveredMusts: musts.filter((result) => result.credit === 0).length,
    };
}

// ─────────────────────────────────────────────────────────── preferences

/** A check plus what it would take to resolve it. */
export type EvaluatedCheck = PreferenceCheck & {
    /** Whether this check, if a conflict, rules the role out. */
    blocking: boolean;
    /** When unknown: the question whose answer would decide it. */
    resolves?: PreferenceQuestionId;
    /** Detail to show if the simulation turns out to be a conflict. */
    conflictDetail?: string;
};

const CITY_ALIASES: [RegExp, string][] = [
    [/\bbangalore\b/g, 'bengaluru'],
    [/\bgurgaon\b/g, 'gurugram'],
    [/\bbombay\b/g, 'mumbai'],
    [/\bmadras\b/g, 'chennai'],
    [/\bcalcutta\b/g, 'kolkata'],
    [/\bnew delhi\b|\bdelhi ncr\b|\bncr\b/g, 'delhi'],
    [/\bsf\b|\bsan francisco bay area\b|\bbay area\b/g, 'san francisco'],
    [/\bnyc\b/g, 'new york'],
];

function normalizePlace(value: string): string {
    let v = normalizeForMatch(value);
    for (const [pattern, canonical] of CITY_ALIASES) v = v.replace(pattern, canonical);
    return v.replace(/\b(?:remote|hybrid|onsite|on site|area|metropolitan|region|urban)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Is `jdLocation` within any of the user's places? City or country level. */
export function placeMatches(jdLocation: string, places: readonly string[]): boolean {
    const jd = normalizePlace(jdLocation);
    if (!jd) return false;
    const jdTokens = new Set(jd.split(' '));
    return places.some((place) => {
        const p = normalizePlace(place);
        if (!p) return false;
        const jdCity = jd.split(' ')[0];
        if (jd.includes(p) || (jdCity.length >= 4 && p.includes(jdCity))) return true;
        // Multi-word places: all tokens present ("new york", "san francisco").
        const tokens = p.split(' ').filter((token) => token.length > 2);
        return tokens.length > 0 && tokens.every((token) => jdTokens.has(token));
    });
}

/** How office-bound a mode is. A remote-only user conflicts with onsite, not vice versa. */
const OFFICE_BOUND: Record<'remote' | 'hybrid' | 'onsite', number> = { remote: 0, hybrid: 1, onsite: 2 };

function checkWorkMode(jd: JdData, prefs: UserGenerationPreferences): EvaluatedCheck | null {
    if (jd.workMode === 'unknown') {
        return { key: 'work_mode', status: 'unknown', detail: 'The posting does not say whether it is remote, hybrid or onsite', blocking: false };
    }
    const mode = jd.workMode;
    const label = mode === 'onsite' ? 'Onsite' : mode === 'hybrid' ? 'Hybrid' : 'Remote';
    if (prefs.preferredWorkModes.length === 0) {
        const mostFlexible = 'remote';
        return {
            key: 'work_mode',
            status: 'unknown',
            detail: `${label}; you have not said which work modes you want`,
            blocking: OFFICE_BOUND[mode] > OFFICE_BOUND[mostFlexible],
            resolves: 'pref.workMode',
            conflictDetail: `${label} role; you want ${mostFlexible} work`,
        };
    }
    if (prefs.preferredWorkModes.includes(mode)) {
        return { key: 'work_mode', status: 'match', detail: `${label}, which you are open to`, blocking: false };
    }
    const leastBound = Math.max(...prefs.preferredWorkModes.map((m) => OFFICE_BOUND[m]));
    const wants = prefs.preferredWorkModes.join(' or ');
    return {
        key: 'work_mode',
        status: 'conflict',
        detail: `${label} role; you want ${wants}`,
        // More office time than the user will do rules it out; less does not.
        blocking: OFFICE_BOUND[mode] > leastBound,
    };
}

function checkLocation(jd: JdData, prefs: UserGenerationPreferences, record: FitRecord): EvaluatedCheck | null {
    if (jd.workMode === 'remote') {
        return { key: 'location', status: 'match', detail: 'Remote role, so location should not decide it', blocking: false };
    }
    if (!jd.location) {
        return { key: 'location', status: 'unknown', detail: 'The posting does not state a location', blocking: false };
    }
    const places = [...prefs.targetLocations, record.location].filter((place) => place.trim());
    if (places.length === 0) {
        return {
            key: 'location',
            status: 'unknown',
            detail: `Based in ${jd.location}; you have not said where you want to work`,
            blocking: true,
            resolves: 'pref.location',
            conflictDetail: `Based in ${jd.location}, which is not where you want to work`,
        };
    }
    if (placeMatches(jd.location, places)) {
        return { key: 'location', status: 'match', detail: `Based in ${jd.location}, which fits where you want to work`, blocking: false };
    }
    const where = places.slice(0, 3).join(', ');
    switch (prefs.willingToRelocate) {
        case 'yes':
            return { key: 'location', status: 'match', detail: `Based in ${jd.location}; you are open to relocating`, blocking: false };
        case 'no':
            return {
                key: 'location',
                status: 'conflict',
                detail: `Based in ${jd.location}, outside ${where}, and you are not relocating`,
                blocking: true,
            };
        case 'case_by_case':
            return { key: 'location', status: 'unknown', detail: `Needs a move to ${jd.location}; you said relocation is case by case`, blocking: false };
        case 'unknown':
            return {
                key: 'location',
                status: 'unknown',
                detail: `Based in ${jd.location}, outside ${where}`,
                blocking: true,
                resolves: 'pref.relocate',
                conflictDetail: `Based in ${jd.location}, outside ${where}, and you are not relocating`,
            };
    }
}

function checkCompensation(jd: JdData, prefs: UserGenerationPreferences): EvaluatedCheck | null {
    if (!jd.compensationText) return null;
    if (!prefs.minCompensationText.trim()) {
        return {
            key: 'compensation',
            status: 'unknown',
            detail: `Posted pay: ${jd.compensationText}; you have not set a floor`,
            blocking: true,
            resolves: 'pref.minComp',
            conflictDetail: `Posted pay (${jd.compensationText}) is below your floor`,
        };
    }
    const comparison = comparePay(parseMoney(jd.compensationText), parseMoney(prefs.minCompensationText));
    if (comparison === 'meets') {
        return { key: 'compensation', status: 'match', detail: `Posted pay ${jd.compensationText} reaches your ${prefs.minCompensationText} floor`, blocking: false };
    }
    if (comparison === 'below') {
        return { key: 'compensation', status: 'conflict', detail: `Posted pay ${jd.compensationText} is below your ${prefs.minCompensationText} floor`, blocking: true };
    }
    return {
        key: 'compensation',
        status: 'unknown',
        detail: `Posted pay ${jd.compensationText} cannot be compared with your ${prefs.minCompensationText} floor (different currency or period)`,
        blocking: false,
    };
}

function checkSeniority(jd: JdData, record: FitRecord): EvaluatedCheck | null {
    const min = minYearsFrom(jd.experienceText);
    if (min === null) return null;
    if (record.years === null) {
        return { key: 'seniority', status: 'unknown', detail: `Asks for ${jd.experienceText}; your years of experience are not on your profile`, blocking: false };
    }
    const years = record.years;
    if (years >= min) {
        if (min <= 2 && years >= min + 6) {
            return { key: 'seniority', status: 'conflict', detail: `Asks for ${jd.experienceText}; with ${years} years this may be junior for you`, blocking: false };
        }
        return { key: 'seniority', status: 'match', detail: `Asks for ${jd.experienceText}; you have ${years}`, blocking: false };
    }
    if (years >= min - 1) {
        return { key: 'seniority', status: 'match', detail: `Asks for ${jd.experienceText}; you have ${years}, close enough to apply`, blocking: false };
    }
    return {
        key: 'seniority',
        status: 'conflict',
        detail: `Asks for ${jd.experienceText}; you have ${years}`,
        // Half the stated floor, and at least three years short, is not a stretch.
        blocking: years < min / 2 && min - years >= 3,
    };
}

function roleMatches(role: string, targets: readonly string[]): boolean {
    const family = classifyFamily(role);
    const roleTerms = new Set(normalizeForMatch(role).split(' ').filter((term) => term.length >= 3));
    return targets.some((target) => {
        const targetFamily = classifyFamily(target);
        if (family !== 'unknown' && family === targetFamily) return true;
        const terms = normalizeForMatch(target).split(' ').filter((term) => term.length >= 3 && !['senior', 'junior', 'lead'].includes(term));
        return terms.length > 0 && terms.some((term) => roleTerms.has(term));
    });
}

function checkRole(jd: JdData, prefs: UserGenerationPreferences, record: FitRecord): EvaluatedCheck | null {
    if (!jd.role) return null;
    const targets = [...prefs.targetRoles, record.defaultTitle].filter((target) => target.trim());
    if (targets.length === 0) {
        return {
            key: 'role',
            status: 'unknown',
            detail: `${jd.role}; you have not said which roles you are targeting`,
            blocking: false,
            resolves: 'pref.targetRoles',
            conflictDetail: `${jd.role} is not a role you are targeting`,
        };
    }
    if (roleMatches(jd.role, targets)) {
        return { key: 'role', status: 'match', detail: `${jd.role} is in line with ${targets.slice(0, 2).join(' / ')}`, blocking: false };
    }
    return { key: 'role', status: 'conflict', detail: `${jd.role} is outside the roles you target (${targets.slice(0, 3).join(', ')})`, blocking: false };
}

function checkSponsorship(jdText: string, prefs: UserGenerationPreferences): EvaluatedCheck | null {
    const stance = detectSponsorship(jdText);
    if (prefs.requiresSponsorship !== 'yes' && prefs.requiresSponsorship !== 'case_by_case') return null;
    if (stance === 'unstated') {
        return { key: 'sponsorship', status: 'unknown', detail: 'The posting does not say whether it sponsors visas', blocking: false };
    }
    if (stance === 'offered') {
        return { key: 'sponsorship', status: 'match', detail: 'The posting says it offers visa sponsorship', blocking: false };
    }
    return prefs.requiresSponsorship === 'yes'
        ? { key: 'sponsorship', status: 'conflict', detail: 'The posting says it does not sponsor visas, and you need sponsorship', blocking: true }
        : { key: 'sponsorship', status: 'unknown', detail: 'The posting says it does not sponsor visas; you said it depends', blocking: false };
}

// ─────────────────────────────────────────────────────────────── verdict

export type VerdictInputs = {
    checks: EvaluatedCheck[];
    coverage: Coverage;
    score: number | null;
    recordEmpty: boolean;
};

const DOWNGRADE: Record<FitVerdict, FitVerdict> = {
    strong: 'possible',
    possible: 'stretch',
    stretch: 'stretch',
    not_a_fit: 'not_a_fit',
    unknown: 'unknown',
};

/** Coverage floors. The verdict can never be warmer than the numbers. */
export const STRONG_MIN_MUST_COVERAGE = 0.7;
export const POSSIBLE_MIN_MUST_COVERAGE = 0.45;
export const NOT_A_FIT_MAX_MUST_COVERAGE = 0.35;

export function decideVerdict(inputs: VerdictInputs): FitVerdict {
    if (inputs.recordEmpty) return 'unknown';
    if (inputs.checks.some((check) => check.status === 'conflict' && check.blocking)) return 'not_a_fit';

    const must = inputs.coverage.mustRatio;
    if (must !== null && must < NOT_A_FIT_MAX_MUST_COVERAGE && inputs.coverage.uncoveredMusts >= 2) return 'not_a_fit';
    if (inputs.score === null) return 'unknown';

    const mustOk = (floor: number) => must === null || must >= floor;
    let verdict: FitVerdict = inputs.score >= 70 && mustOk(STRONG_MIN_MUST_COVERAGE)
        ? 'strong'
        : inputs.score >= 50 && mustOk(POSSIBLE_MIN_MUST_COVERAGE)
            ? 'possible'
            : 'stretch';
    const softConflicts = inputs.checks.filter((check) => check.status === 'conflict' && !check.blocking).length;
    if (softConflicts > 0) verdict = DOWNGRADE[verdict];
    return verdict;
}

/** Priority when more than one question could change the verdict. */
const QUESTION_PRIORITY: PreferenceQuestionId[] = ['pref.location', 'pref.relocate', 'pref.workMode', 'pref.targetRoles', 'pref.minComp'];

export function questionFor(id: PreferenceQuestionId, jd: JdData): PendingQuestion {
    const place = jd.location ?? 'this location';
    const mode = jd.workMode === 'unknown' ? '' : `${jd.workMode} `;
    switch (id) {
        case 'pref.location':
            return {
                id,
                step: 'fit',
                prompt: `This role is ${mode}in ${place}. Where do you want to work? (a city, several, or e.g. "Remote India")`,
            };
        case 'pref.relocate':
            return {
                id,
                step: 'fit',
                prompt: `This role is ${mode}in ${place}. Would you relocate for the right role?`,
                options: [
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                    { value: 'case_by_case', label: 'Depends on the role' },
                ],
            };
        case 'pref.workMode':
            return {
                id,
                step: 'fit',
                prompt: `This role is ${jd.workMode}. Which work modes would you take?`,
                options: [
                    { value: 'remote', label: 'Remote only' },
                    { value: 'remote, hybrid', label: 'Remote or hybrid' },
                    { value: 'any', label: 'Any, including onsite' },
                ],
            };
        case 'pref.targetRoles':
            return {
                id,
                step: 'fit',
                prompt: `Is "${jd.role}" the kind of role you are after? Tell me the roles you are targeting (e.g. "Backend Engineer, SDE II").`,
            };
        case 'pref.minComp':
            return {
                id,
                step: 'fit',
                prompt: `This posting states ${jd.compensationText}. What is the lowest compensation you would take? (e.g. "₹35 LPA" or "$150k")`,
            };
    }
}

/**
 * The fit score: hard-requirement coverage, blended with named-skill overlap.
 *
 * Coverage leads (70%) because it is what the verdict and the summary talk
 * about — a score of 87 next to "evidence for 2 of 12 requirements" is a
 * product contradicting itself, which is what the keyword-only score did.
 * Musts weigh 80% of coverage and nice-to-haves 20%; partial evidence counts
 * half. Skill overlap is the share of the posting's named skills found in the
 * record — the same matcher the extension and Radar use. Null when there is
 * nothing to score or nothing to score against.
 */
export function scoreFit(params: { record: FitRecord; coverage: Coverage; skills: readonly string[] }): number | null {
    if (params.record.empty) return null;
    const { mustRatio, niceRatio } = params.coverage;
    const coverage = mustRatio === null
        ? niceRatio
        : niceRatio === null ? mustRatio : 0.8 * mustRatio + 0.2 * niceRatio;
    const skillRatio = params.skills.length
        ? findMatchedSkills([...params.skills], params.record.corpus).length / params.skills.length
        : null;
    if (coverage === null && skillRatio === null) return null;
    const blended = coverage === null ? skillRatio! : skillRatio === null ? coverage : 0.7 * coverage + 0.3 * skillRatio;
    return Math.round(Math.max(0, Math.min(1, blended)) * 100);
}

// ─────────────────────────────────────────────────────────────── evaluate

export type FitEvaluation = {
    fit: Omit<FitData, 'summary'>;
    checks: EvaluatedCheck[];
    coverage: Coverage;
    /** Traits dropped from scoring, for display beside the fit. */
    softRequirements: string[];
    /** Set when one unknown would change the verdict and it has not been asked. */
    question: PendingQuestion | null;
};

export function evaluateFit(params: {
    jd: JdData;
    jdText: string;
    record: FitRecord;
    prefs: UserGenerationPreferences;
    answers: Record<string, string>;
    /** The plan the judgements were made against. Built here when absent. */
    plan?: MatchPlan;
    /** Matcher output. Absent → the deterministic fallback. */
    judgements?: Map<string, Judgement>;
    /** Extra requirement ids the matcher flagged as traits. */
    softIds?: ReadonlySet<string>;
}): FitEvaluation {
    const { jd, record } = params;
    const prefs = applyAnswers(params.prefs, params.answers);

    const basePlan = params.plan ?? planMatching(jd, record);
    const softIds = params.softIds ?? new Set<string>();
    const plan: MatchPlan = softIds.size
        ? {
            ...basePlan,
            hard: basePlan.hard.filter((r) => !softIds.has(r.id)),
            soft: [...basePlan.soft, ...basePlan.hard.filter((r) => softIds.has(r.id))],
        }
        : basePlan;
    const judgements = params.judgements ?? fallbackJudgements(plan.toAsk, record);

    const results = applyJudgements({ plan, judgements, record });
    const coverage = coverageOf(results);
    const score = scoreFit({ record, coverage, skills: jd.skills });

    const matched: FitData['matched'] = results
        .filter((result) => result.evidence !== null)
        .map((result) => ({
            requirementId: result.requirementId,
            text: result.text,
            evidence: result.evidence!,
            strength: result.credit >= 1 ? 'direct' as const : 'partial' as const,
        }));
    const gaps: FitData['gaps'] = results
        .filter((result) => result.evidence === null)
        .map((result) => ({ requirementId: result.requirementId, text: result.text, severity: result.severity ?? 'minor' }));

    const checks = [
        checkRole(jd, prefs, record),
        checkSeniority(jd, record),
        checkWorkMode(jd, prefs),
        checkLocation(jd, prefs, record),
        checkCompensation(jd, prefs),
        checkSponsorship(params.jdText, prefs),
    ].filter((check): check is EvaluatedCheck => check !== null);

    const inputs: VerdictInputs = { checks, coverage, score, recordEmpty: record.empty };
    const verdict = decideVerdict(inputs);

    // One question per run, and never re-ask anything already answered.
    const alreadyAsked = Object.keys(params.answers).some(isPreferenceQuestionId);
    let question: PendingQuestion | null = null;
    if (!alreadyAsked && !record.empty) {
        for (const id of QUESTION_PRIORITY) {
            const index = checks.findIndex((check) => check.status === 'unknown' && check.resolves === id);
            if (index < 0) continue;
            const asConflict = checks.map((c, i) => (i === index ? { ...c, status: 'conflict' as const } : c));
            const asMatch = checks.map((c, i) => (i === index ? { ...c, status: 'match' as const, blocking: false } : c));
            if (decideVerdict({ ...inputs, checks: asConflict }) !== decideVerdict({ ...inputs, checks: asMatch })) {
                question = questionFor(id, jd);
                break;
            }
        }
    }

    const notFitReasons: string[] = [];
    if (verdict === 'not_a_fit' || verdict === 'stretch') {
        for (const check of checks) {
            if (check.status === 'conflict' && check.blocking) notFitReasons.push(check.detail);
        }
        if (coverage.mustTotal > 0 && coverage.mustRatio !== null && coverage.mustRatio < STRONG_MIN_MUST_COVERAGE) {
            notFitReasons.push(mustEvidenceSentence(results, coverage.mustTotal));
        }
        // A years requirement already stated as the seniority conflict is the
        // same reason; saying it twice reads as two problems.
        const seniorityStated = checks.some((check) => check.key === 'seniority' && check.status === 'conflict');
        for (const gap of gaps) {
            if (gap.severity !== 'blocking') continue;
            if (seniorityStated && plan.pureTenure.has(gap.requirementId)) continue;
            notFitReasons.push(`No evidence in your record for: "${gap.text}"`);
        }
        for (const check of checks) {
            if (check.status === 'conflict' && !check.blocking) notFitReasons.push(check.detail);
        }
    }

    return {
        fit: {
            score,
            verdict,
            matched,
            gaps,
            preferenceChecks: checks.map(({ key, status, detail }) => ({ key: key as PreferenceKey, status, detail })),
            notFitReasons: notFitReasons.slice(0, 6),
            softRequirements: plan.soft.map((requirement) => requirement.text),
        },
        checks,
        coverage,
        softRequirements: plan.soft.map((requirement) => requirement.text),
        question,
    };
}

// ─────────────────────────────────────────────────────────────── summary

function coverageSentence(coverage: Coverage): string {
    if (coverage.mustTotal === 0) return '';
    return `Your record shows evidence for ${coverage.mustCovered} of ${coverage.mustTotal} must-have requirements.`;
}

/** The summary when the model is unavailable, or disagreed with the numbers. */
export function deterministicSummary(fit: Omit<FitData, 'summary'>, jd: JdData, coverage: Coverage): string {
    const role = jd.company ? `${jd.role} at ${jd.company}` : jd.role;
    const cover = coverageSentence(coverage);
    switch (fit.verdict) {
        case 'strong':
            return `${role} looks like a strong fit. ${cover}`.trim();
        case 'possible':
            return `${role} is a possible fit. ${cover}`.trim();
        case 'stretch':
            return `${role} is a stretch. ${cover}`.trim();
        case 'not_a_fit': {
            const reason = fit.notFitReasons[0]?.replace(/\.$/, '') ?? 'see the reasons below';
            return `${role} does not look like a fit: ${reason}.`;
        }
        case 'unknown':
            return fit.score === null
                ? 'Not enough of your work history is in Patronus to judge fit. Add your roles or import a resume.'
                : `Fit for ${role} is unclear from what the posting states.`;
    }
}

const WARMER_THAN: Record<FitVerdict, RegExp | null> = {
    strong: null,
    possible: /\bstrong (?:fit|match|candidate)\b|\bexcellent fit\b|\bgreat fit\b/i,
    stretch: /\bstrong (?:fit|match|candidate)\b|\b(?:excellent|great|good|solid) fit\b|\bwell[\s-]matched\b/i,
    not_a_fit: /\b(?:strong|excellent|great|good|solid|possible) (?:fit|match)\b|\bwell[\s-]matched\b/i,
    unknown: /\b(?:strong|excellent|great|good|solid) (?:fit|match)\b/i,
};

const COLDER_THAN: Record<FitVerdict, RegExp | null> = {
    strong: /\bnot (?:a|an ideal|a good|a strong) (?:fit|match)\b|\bstretch\b|\bpoor fit\b/i,
    possible: /\bnot (?:a|a good) (?:fit|match)\b|\bpoor fit\b/i,
    stretch: null,
    not_a_fit: null,
    unknown: null,
};

/**
 * Does a model-written summary agree with the computed fit?
 *
 * The summary may never be warmer or colder than the verdict, and any "N of M"
 * it states must be the real coverage count. When it fails, the deterministic
 * summary ships — it is plainer, and it is true.
 */
export function summaryAgrees(summary: string, verdict: FitVerdict, coverage: Coverage): boolean {
    if (WARMER_THAN[verdict]?.test(summary)) return false;
    if (COLDER_THAN[verdict]?.test(summary)) return false;
    for (const match of summary.matchAll(/\b(\d+)\s+(?:out\s+)?of\s+(?:the\s+)?(\d+)\b/gi)) {
        if (Number(match[1]) !== coverage.mustCovered || Number(match[2]) !== coverage.mustTotal) return false;
    }
    return true;
}
