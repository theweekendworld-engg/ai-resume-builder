/**
 * Requirement ↔ evidence matching: which line of the user's record answers
 * which requirement of the posting.
 *
 * ── Why this is not a keyword matcher any more ─────────────────────────────
 *
 * The first version matched words. On a real Amazon SDE II posting, for a
 * working full-stack engineer, it reported "Experience programming with at
 * least one software programming language" and "a sound understanding of the
 * fundamentals of Computer Science" as gaps — neither sentence shares a word
 * with "Built React.js dashboards" or "Developed 5 microservices", and both
 * are plainly answered by them. It also listed "hustle" and "customer-centric"
 * as missing must-haves, and credited "2+ years of design or architecture
 * experience" with "2 years of experience (stated on your profile)", which is
 * tenure, not architecture. Run cmue7pqf7000065wvgw2qkkoe, 2026-09-23.
 *
 * ── The division of labour ────────────────────────────────────────────────
 *
 *   Code decides:  which requirements are soft (traits and culture — never a
 *                  gap, never scored), anything answered by years alone, and
 *                  the obvious named-skill matches (so the model is not paid
 *                  to confirm that "Go" appears in a line containing "Go").
 *   The model:     reads the remaining requirements against NUMBERED lines of
 *                  the record and answers with line numbers. It never writes
 *                  evidence text; code maps each number back to the real line
 *                  and drops any number out of range. A model cannot quote the
 *                  user something they did not write.
 *
 * If the model call fails, the keyword matcher below is the fallback — worse,
 * but never invented.
 */

import { z } from 'zod';
import { findMatchedSkills } from '@/lib/extension/fitScore';
import type { JdData, ScoutRequirement } from '@/lib/scout/types';
import { minYearsFrom } from '@/lib/scout/fit/jdSignals';

export type MatchStrength = 'direct' | 'partial';

export type Judgement = {
    requirementId: string;
    /** Index into `FitRecord.lines`, or null for "no evidence". */
    lineIndex: number | null;
    strength: MatchStrength | null;
    source: 'prefilter' | 'model' | 'fallback';
};

/** The record as the matcher sees it: plain lines, indexable. */
export type MatchRecord = {
    lines: { text: string; source: string }[];
    corpus: string;
};

// ────────────────────────────────────────────────────────────── soft traits

/**
 * Traits, culture and adjectives. A requirement that is only these cannot be
 * evidenced from a record and cannot be failed by one — "hustle" is not a
 * thing anyone's resume proves or disproves. They are dropped from scoring.
 */
const SOFT_PATTERNS: RegExp[] = [
    /\bcommunicat\w*\b/i,
    /\bteam\s*(?:work|player|spirit|oriented)\b|\bcommitment to team/i,
    /\bhustle\b|\bgrit\b|\bdrive\b|\bself[\s-]?(?:starter|motivated|driven)\b|\bmotivated\b/i,
    /\bcustomer[\s-]?(?:centric|obsess\w*|focus\w*|first)\b/i,
    /\bpassion\w*\b|\benthusias\w*\b|\bcurio\w*\b|\beager\b/i,
    /\bownership\b|\bbias for action\b|\bgrowth mindset\b|\battitude\b|\bintegrity\b|\bempath\w*\b|\bhumble\b|\bhumility\b/i,
    /\bdetail[\s-]oriented\b|\battention to detail\b|\bproblem[\s-]solv\w*\b|\bcritical think\w*\b|\banalytical (?:skills|mind)\b/i,
    /\binterpersonal\b|\bstakeholder management\b|\bwork independently\b|\bfast[\s-]paced\b|\bambiguity\b|\bcollaborat\w*\b/i,
    /^(?:exceptional|excellent|strong|outstanding|deep|solid)\s+(?:technical\s+)?(?:expertise|skills|abilities|judgement|judgment)$/i,
];

/**
 * Words that make a requirement checkable. A trait sentence that still has
 * one of these after the trait is removed ("distributed systems and strong
 * problem solving") is hard, and goes to the matcher — the lexicon only drops
 * requirements that are nothing BUT traits.
 */
const HARD_SIGNAL = /\b(?:experience|systems?|design|architect\w*|degree|language|framework|data|cloud|api|apis|infrastructure|scal\w*|security|machine learning|ml|algorithms?|database\w*|backend|frontend|mobile|distributed|services?|product|platform|code|coding|programming|testing|devops|analytics|model\w*|computer science|engineering)\b/i;

/**
 * Soft = a trait with nothing checkable left. A trait sentence that also
 * names a skill ("strong communication skills in English and SQL") is hard:
 * the SQL is real.
 */
export function isSoftRequirement(text: string, skills: readonly string[] = []): boolean {
    const t = text.trim();
    if (minYearsFrom(t) !== null && /\byears?\b|\byrs?\b/i.test(t)) return false;
    if (skills.length && findMatchedSkills([...skills], normalize(t)).length) return false;
    if (/\bdegree\b|\bbachelor|\bmaster|\bph\.?d\b|\bb\.?tech\b|\bcertif/i.test(t)) return false;
    if (!SOFT_PATTERNS.some((pattern) => pattern.test(t))) return false;
    const rest = SOFT_PATTERNS.reduce((acc, pattern) => acc.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), ' '), t);
    return !HARD_SIGNAL.test(rest);
}

// ───────────────────────────────────────────────────────────────── tenure

/** Words that restate "time served" without adding a condition to it. */
const GENERIC_TENURE_WORDS = new Set([
    'non', 'internship', 'professional', 'software', 'development', 'developer', 'engineering', 'engineer',
    'industry', 'work', 'working', 'relevant', 'experience', 'experienced', 'hands', 'on', 'of', 'in', 'a', 'an',
    'the', 'and', 'or', 'total', 'overall', 'full', 'time', 'post', 'graduation', 'with', 'least', 'at',
    'minimum', 'plus', 'years', 'year', 'yrs', 'yr', 'programming', 'coding',
]);

export type TenureRequirement = {
    minYears: number;
    /**
     * True when the years qualify something ("2+ years of design or
     * architecture"). Then tenure is necessary but not sufficient, and the
     * qualifier needs evidence from the record like any other requirement.
     */
    qualified: boolean;
};

export function tenureRequirement(text: string): TenureRequirement | null {
    const minYears = minYearsFrom(text);
    if (minYears === null || !/\byears?\b|\byrs?\b/i.test(text)) return null;
    const rest = normalize(text.replace(/\b\d{1,2}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/gi, ' '))
        .split(' ')
        .filter((word) => word.length > 1 && !GENERIC_TENURE_WORDS.has(word));
    return { minYears, qualified: rest.length > 0 };
}

// ─────────────────────────────────────────────────────────────── planning

function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export type MatchPlan = {
    /** Scored requirements (hard), in posting order. */
    hard: ScoutRequirement[];
    /** Dropped from scoring: traits and culture. */
    soft: ScoutRequirement[];
    /** Answered by years alone; code judges these, never the model. */
    pureTenure: Map<string, TenureRequirement>;
    /** Years plus a qualifier: code judges the years, the matcher the qualifier. */
    qualifiedTenure: Map<string, TenureRequirement>;
    /** Obvious named-skill matches, settled without a model call. */
    prefiltered: Map<string, Judgement>;
    /** What the model is asked about. */
    toAsk: ScoutRequirement[];
};

function lineContaining(record: MatchRecord, needle: string): number | null {
    const target = normalize(needle);
    if (!target) return null;
    const index = record.lines.findIndex((line) => ` ${normalize(line.text)} `.includes(` ${target} `));
    return index >= 0 ? index : null;
}

/** Named skills the requirement's own text mentions. */
function namedSkillsIn(requirement: ScoutRequirement, jd: JdData): string[] {
    const text = ` ${normalize(requirement.text)} `;
    return jd.skills.filter((skill) => {
        const s = normalize(skill);
        return s.length > 0 && text.includes(` ${s} `);
    });
}

export function planMatching(jd: JdData, record: MatchRecord): MatchPlan {
    const plan: MatchPlan = {
        hard: [],
        soft: [],
        pureTenure: new Map(),
        qualifiedTenure: new Map(),
        prefiltered: new Map(),
        toAsk: [],
    };

    for (const requirement of jd.requirements) {
        if (requirement.kind === 'responsibility') continue;

        const tenure = tenureRequirement(requirement.text);
        if (tenure && !tenure.qualified) {
            plan.hard.push(requirement);
            plan.pureTenure.set(requirement.id, tenure);
            continue;
        }
        if (!tenure && isSoftRequirement(requirement.text, jd.skills)) {
            plan.soft.push(requirement);
            continue;
        }

        plan.hard.push(requirement);
        if (tenure) plan.qualifiedTenure.set(requirement.id, tenure);

        // Prefilter: every named skill in the requirement is in one line.
        const named = namedSkillsIn(requirement, jd);
        if (!tenure && named.length > 0 && findMatchedSkills(named, record.corpus).length === named.length) {
            const index = lineContaining(record, named[0]);
            if (index !== null) {
                plan.prefiltered.set(requirement.id, { requirementId: requirement.id, lineIndex: index, strength: 'direct', source: 'prefilter' });
                continue;
            }
        }
        plan.toAsk.push(requirement);
    }
    return plan;
}

// ─────────────────────────────────────────────────────────────── the model

/** Lines longer than this are cut for the prompt; the full line is what we quote. */
const PROMPT_LINE_CHARS = 220;
export const MAX_PROMPT_LINES = 120;

export const MatchResponseSchema = z.object({
    judgements: z.array(z.object({
        requirement: z.number().int(),
        /** The model may flag a trait the lexicon missed. Ignored for years. */
        soft: z.boolean(),
        evidence: z.number().int().nullable(),
        strength: z.enum(['direct', 'partial']).nullable(),
    })),
});

export type MatchResponse = z.infer<typeof MatchResponseSchema>;

export const MATCH_SYSTEM = `You are a senior engineering recruiter screening one candidate against one job's requirements.

You get numbered REQUIREMENTS and numbered EVIDENCE lines from the candidate's own record (role bullets across current and past jobs, projects, skills, education).

For EACH requirement, answer with:
- "evidence": the number of the single evidence line that best shows the candidate meets it, or null if no line does.
- "strength": "direct" when the line clearly shows it; "partial" when it shows something close but weaker (adjacent technology, smaller scale, part of the requirement). null when evidence is null.
- "soft": true ONLY for personality/culture traits no record can prove (e.g. "hustle", "customer-centric", "team player", "strong communication"). Knowledge, skills, degrees and experience are never soft.

Judge like a recruiter, not a keyword filter:
- "Experience with at least one programming language" is met by any line showing the candidate wrote software.
- "Fundamentals of computer science" is met by a CS or engineering degree, or by clearly non-trivial systems work.
- "Large-scale distributed systems" needs evidence of services, data pipelines, or scale — not a stated interest.
- A profile summary describing interests is weak evidence; prefer concrete role bullets and projects.
- For a requirement that mentions years ("2+ years of design or architecture"), judge ONLY the thing after the years — whether the candidate has done design/architecture. Ignore the number; it is checked separately.
- If unsure, prefer null. A wrong match tells the candidate they are qualified when they are not.

Return {"judgements": [...]} with exactly one entry per requirement, using the requirement numbers given.`;

export function buildMatchPrompt(toAsk: readonly ScoutRequirement[], record: MatchRecord): string {
    const requirements = toAsk.map((requirement, i) => `${i + 1}. ${requirement.text}`).join('\n');
    const lines = record.lines
        .slice(0, MAX_PROMPT_LINES)
        .map((line, i) => {
            const text = line.text.length > PROMPT_LINE_CHARS ? `${line.text.slice(0, PROMPT_LINE_CHARS - 1)}…` : line.text;
            return `${i + 1}. ${text}${line.source && !line.text.includes(line.source) ? ` [${line.source}]` : ''}`;
        })
        .join('\n');
    return `REQUIREMENTS:\n${requirements}\n\nEVIDENCE:\n${lines}`;
}

/**
 * Model answers → judgements. Requirement and line numbers are 1-based in
 * the prompt. Anything out of range is dropped rather than guessed at: a line
 * number that does not exist is a model that lost track, and its match is
 * worth nothing.
 */
export function resolveModelJudgements(
    response: MatchResponse,
    toAsk: readonly ScoutRequirement[],
    lineCount: number,
): { judgements: Map<string, Judgement>; softIds: Set<string> } {
    const judgements = new Map<string, Judgement>();
    const softIds = new Set<string>();
    const visibleLines = Math.min(lineCount, MAX_PROMPT_LINES);

    for (const entry of response.judgements) {
        const requirement = toAsk[entry.requirement - 1];
        if (!requirement || judgements.has(requirement.id)) continue;
        if (entry.soft && !tenureRequirement(requirement.text)) softIds.add(requirement.id);
        const index = entry.evidence === null ? null : entry.evidence - 1;
        const inRange = index !== null && index >= 0 && index < visibleLines;
        judgements.set(requirement.id, {
            requirementId: requirement.id,
            lineIndex: inRange ? index : null,
            strength: inRange ? (entry.strength ?? 'partial') : null,
            source: 'model',
        });
    }
    return { judgements, softIds };
}

// ─────────────────────────────────────────────────────────────── fallback

const STOPWORDS = new Set([
    'about', 'across', 'ability', 'able', 'build', 'building', 'deep', 'design', 'experience', 'excellent',
    'familiarity', 'have', 'including', 'knowledge', 'least', 'minimum', 'other', 'plus', 'preferred',
    'proven', 'related', 'relevant', 'required', 'similar', 'skills', 'solid', 'something', 'strong',
    'their', 'these', 'understanding', 'using', 'where', 'which', 'while', 'with', 'within', 'working',
    'years', 'should', 'would', 'could', 'track', 'record', 'good', 'great', 'demonstrated', 'practical',
]);

/**
 * The keyword matcher, kept for when the model is unavailable. Conservative
 * by construction: it only ever says `partial`, because shared vocabulary is
 * not proof, and a named skill found verbatim is already `direct` via the
 * prefilter.
 */
export function fallbackJudgements(toAsk: readonly ScoutRequirement[], record: MatchRecord): Map<string, Judgement> {
    const out = new Map<string, Judgement>();
    for (const requirement of toAsk) {
        const terms = [...new Set(normalize(requirement.text).split(' ').filter((term) => term.length >= 5 && !STOPWORDS.has(term)))];
        let best: { index: number; hits: number } | null = null;
        if (terms.length) {
            record.lines.forEach((line, index) => {
                const text = normalize(line.text);
                const hits = terms.filter((term) => text.includes(term)).length;
                if (!best || hits > best.hits) best = { index, hits };
            });
        }
        const needed = terms.length <= 2 ? 1 : 2;
        const found = best as { index: number; hits: number } | null;
        const matched = found !== null && found.hits >= needed;
        out.set(requirement.id, {
            requirementId: requirement.id,
            lineIndex: matched ? found.index : null,
            strength: matched ? 'partial' : null,
            source: 'fallback',
        });
    }
    return out;
}
