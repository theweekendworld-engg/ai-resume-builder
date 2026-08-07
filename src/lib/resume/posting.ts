/**
 * Reading a job posting the way a person reads one.
 *
 * A human resume writer does not extract a bag of keywords. They read the
 * posting and come away with a list of things this employer is going to check
 * for, in rough order of how much the posting cares. Everything downstream —
 * which bullets earn space, what the summary positions for, whether the resume
 * is any good — keys off that list. So it has to be the first thing we get
 * right, and it was the first thing that was wrong.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * The old prompt, in full: "Parse the job description into structured JSON.
 * Return ONLY JSON with keys: role, company, requiredSkills, preferredSkills,
 * …". No definition of a skill, no line between a skill and a responsibility.
 *
 * It returned `requiredSkills: ["Building backend systems at scale", "Design
 * and operate high-throughput services", "Measurable reliability or
 * performance improvements"]` — three sentences from the responsibilities
 * section — and the ATS step spliced them straight into the candidate's skills
 * list. Those are real strings from the 7 Aug audit run.
 *
 * Two defences, because one was not enough:
 *
 *   The prompt now defines a skill as a NAMEABLE THING, gives the model the
 *   failing examples verbatim, and puts responsibilities in their own field so
 *   there is somewhere correct for them to go.
 *
 *   {@link isPlausibleSkill} then rejects what gets through. A model asked for
 *   short noun phrases will still occasionally return a sentence, and the cost
 *   of one slipping past is a resume that reads as machine-written.
 */

import { z } from 'zod';

import { generateStructured } from '@/lib/ai/structured';

// ─────────────────────────────────────────────────────────── the brief

export const REQUIREMENT_KINDS = ['must', 'nice'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/**
 * Categories exist so selection can tell "you must know Kafka" from "you must
 * have mentored people". They score differently: a tool is answered by having
 * used it, a behaviour is answered by an instance of doing it.
 */
export const REQUIREMENT_CATEGORIES = [
    'skill',
    'experience',
    'outcome',
    'behaviour',
    'domain',
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export type JobRequirement = {
    /** Stable within one parse — `r1`, `r2`. Selection refers to these. */
    id: string;
    /** The posting's own wording, so a gap report can quote it back. */
    text: string;
    kind: RequirementKind;
    category: RequirementCategory;
};

export type PostingBrief = {
    role: string;
    company: string;
    seniority: string;
    domain: string;
    requirements: JobRequirement[];
    /** Nameable tools/technologies only. Never a phrase. */
    skills: string[];
    /** What the job involves day to day. Deliberately NOT skills. */
    responsibilities: string[];
};

// ─────────────────────────────────────────────────────────── the filter

/** A skill is a thing you could put on a t-shirt. These are not. */
const VERB_PHRASE = /\b(build|building|design|designing|develop|operate|operating|own|owning|improve|improving|deliver|delivering|drive|driving|manage|managing|partner|mentor|mentoring|ship|shipping|scale|scaling|work|working|ensure|maintain|maintaining|lead|leading|collaborate|support)\b/i;

/** Conjunctions and prepositions that only appear inside sentences. */
const SENTENCE_GLUE = /\b(and|or|with|for|that|which|across|within|from|into|to)\b/i;

const MAX_SKILL_WORDS = 4;
const MAX_SKILL_CHARS = 34;

/**
 * Would a person write this in a skills section?
 *
 * Deliberately strict, and asymmetric on purpose: dropping a real skill costs
 * one line on the resume, while keeping a fake one costs the reader's trust in
 * the whole document. When in doubt, drop.
 *
 * Multi-word names are allowed — "Google Cloud Platform", "React Native",
 * "Adobe Illustrator" are all skills — so the test is not word count alone.
 * It is: does this read like a name, or like a sentence?
 */
export function isPlausibleSkill(raw: string): boolean {
    const value = raw.trim();
    if (!value) return false;
    if (value.length > MAX_SKILL_CHARS) return false;

    const words = value.split(/\s+/);
    if (words.length > MAX_SKILL_WORDS) return false;

    // A single word is almost always a real skill name, even if it collides
    // with a verb — "Design" is a discipline, "Scala" is a language. The
    // sentence tests below only make sense on phrases.
    if (words.length === 1) return true;

    if (VERB_PHRASE.test(value)) return false;
    if (SENTENCE_GLUE.test(value)) return false;

    return true;
}

/**
 * Clean a skills list.
 *
 * Also splits on commas and slashes, because the audit turned up
 * `"Reliability, latency and observability improvements"` arriving as ONE
 * entry and rendering as two bogus skills after a naive split downstream.
 * Splitting here, then filtering, means the fragments face the same test as
 * anything else.
 */
export function cleanSkills(raw: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        for (const part of String(entry ?? '').split(/[,/•|]| – | - /)) {
            const value = part.trim().replace(/\.$/, '');
            if (!isPlausibleSkill(value)) continue;
            const key = value.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(value);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────── the model call

/**
 * Every field is required and nothing carries `.default()`.
 *
 * OpenAI's structured-output mode requires `required` to list every key in
 * `properties`, and a zod default makes a key optional — which surfaces as
 * `Invalid schema for response_format: Missing 'kind'` at call time, not at
 * compile time. The first version of this file had defaults on `kind` and
 * `category` and failed on the first live run. Absence is expressed with
 * `.nullable()` and normalised below, which is the convention the rest of the
 * codebase already follows (see `ThemeResponseSchema` in reviewPacket).
 */
const BriefSchema = z.object({
    role: z.string(),
    company: z.string(),
    seniority: z.string(),
    domain: z.string(),
    requirements: z.array(
        z.object({
            text: z.string().min(1),
            kind: z.enum(REQUIREMENT_KINDS),
            category: z.enum(REQUIREMENT_CATEGORIES),
        }),
    ),
    skills: z.array(z.string()),
    responsibilities: z.array(z.string()),
});

const SYSTEM = `You read job postings for a resume tool. You extract only what the posting actually says. You never infer requirements the employer did not state, and you never soften or generalise their wording.`;

/** Ceiling on requirements. Beyond this a posting is repeating itself. */
const MAX_REQUIREMENTS = 14;

function buildPrompt(jobDescription: string): string {
    return `Read this job posting and extract what the employer will actually check for.

REQUIREMENTS — the heart of this.
Each requirement is one discrete thing a candidate is expected to have or have done.
- Split compound sentences. "6+ years of backend systems and deep experience with
  distributed systems and databases" is THREE requirements, not one.
- Use the posting's own wording, trimmed. Do not paraphrase into your own words —
  this text is quoted back to the candidate.
- "kind": "must" if the posting states it as required, "nice" if it is preferred,
  bonus, or a plus.
- "category":
    skill      — a named tool, language or technology
    experience — a length or type of background ("6+ years backend")
    outcome    — a demonstrable result ("track record of reliability improvements")
    behaviour  — something they do with people ("mentor engineers")
    domain     — industry or problem-space familiarity ("payments")
- At most ${MAX_REQUIREMENTS}, ordered by how much the posting emphasises them.

SKILLS — nameable things only.
A skill is something with a NAME: a language, framework, tool, platform or
recognised discipline. Go, PostgreSQL, Kubernetes, Figma, SQL, Terraform,
financial modelling.
It is NOT a sentence or an activity. These are all WRONG and must never appear:
  "Building backend systems at scale"
  "Design and operate high-throughput services"
  "Measurable reliability or performance improvements"
  "Reliability, latency and observability improvements"
Those belong in "responsibilities". If you cannot name it in one to three words,
it is not a skill.

RESPONSIBILITIES — what the job involves day to day, in the posting's words.

JOB POSTING:
"""
${jobDescription}
"""`;
}

export type ReadPostingResult = {
    brief: PostingBrief;
    /** Skills the model proposed that failed the filter. Useful in logs. */
    rejectedSkills: string[];
};

export async function readPosting(params: {
    jobDescription: string;
    userId: string;
    sessionId?: string;
}): Promise<ReadPostingResult> {
    const { data } = await generateStructured({
        task: 'postingRead',
        feature: 'resume',
        userId: params.userId,
        sessionId: params.sessionId,
        schema: BriefSchema,
        system: SYSTEM,
        prompt: buildPrompt(params.jobDescription.slice(0, 20_000)),
    });

    const skills = cleanSkills(data.skills);
    const rejectedSkills = data.skills.filter(
        (entry) => !skills.some((kept) => kept.toLowerCase() === entry.trim().toLowerCase()),
    );

    const requirements: JobRequirement[] = data.requirements
        .slice(0, MAX_REQUIREMENTS)
        .map((entry, index) => ({
            id: `r${index + 1}`,
            text: entry.text.trim(),
            kind: entry.kind,
            category: entry.category,
        }));

    return {
        brief: {
            role: data.role.trim(),
            company: data.company.trim(),
            seniority: data.seniority.trim(),
            domain: data.domain.trim(),
            requirements,
            skills,
            // Responsibilities are kept because they are real context for the
            // writing stage — and because giving them a home is half of why
            // they stopped ending up in the skills list.
            responsibilities: data.responsibilities.map((entry) => entry.trim()).filter(Boolean),
        },
        rejectedSkills,
    };
}

/** Must-haves first — selection and the gap report both lead with these. */
export function orderedRequirements(brief: PostingBrief): JobRequirement[] {
    return [...brief.requirements].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'must' ? -1 : 1;
        return 0;
    });
}
