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

/**
 * `responsibility` was added after the 8 Aug audit.
 *
 * `readPosting` had always extracted the "What you'll do" section into
 * `brief.responsibilities`, and NOTHING consumed it — not scoring, not
 * selection, not coverage, not the editor's match panel. Grep found the field
 * in its own parser and in test fixtures, nowhere else.
 *
 * For a designer posting that meant seven stated day-to-day expectations were
 * read and discarded, including "Raise the bar on craft across the design
 * team, and mentor designers earlier in their career" — while the pipeline cut
 * the candidate's "Facilitated quarterly design critiques and mentored one
 * junior designer" for space. That is the exact failure the v2 rebuild was
 * written to prevent, reproduced through a different door, because the
 * cover-pass only protects bullets answering a stated REQUIREMENT and had no
 * idea a responsibility was ever stated.
 *
 * Most modern postings put the real signal in "What you'll do" and reserve
 * "Requirements" for years-of-experience boilerplate, so this was the half of
 * the posting that mattered most.
 */
export const REQUIREMENT_KINDS = ['must', 'nice', 'responsibility'] as const;
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
    /**
     * Is time served the ONLY thing this asks for?
     *
     * Coverage credits a requirement from the resume's date range when it asks
     * for years, because no bullet says "I have six years of experience". That
     * credit used to be handed out by a regex matching `(\d+)\s*\+?\s*years`
     * anywhere in the requirement text — so a live free-score run reported
     * `{ text: "2+ years owning a paid budget over $1M", byDates: true }` for a
     * resume with no budget figure anywhere in it.
     *
     * The product told a stranger they met a $1M budget-ownership requirement
     * on the strength of having been employed. That is the fabrication
     * invariant inverted: the numeric guard stops the resume inventing
     * figures, and nothing stopped the SCORER inventing qualifications.
     *
     * The judgement is the model's because it is a judgement — "5+ years
     * designing digital products" is time served, "2+ years owning a paid
     * budget over $1M" is a specific condition that happens to mention time.
     * A regex cannot tell those apart. Fails closed: no flag, no credit.
     */
    satisfiedByTenure: boolean;
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
// Moved to `skillVocab.ts` so client bundles can use the predicate without
// pulling this module's model call — and with it the OpenAI SDK — into the
// browser. Re-exported because `posting.ts` was the published home.
export { isPlausibleSkill } from './skillVocab';
import { isPlausibleSkill } from './skillVocab';

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
            satisfiedByTenure: z.boolean(),
        }),
    ),
    skills: z.array(z.string()),
    // Objects rather than strings so a responsibility can become a scoreable
    // requirement without a second model call. `brief.responsibilities` is
    // still exposed as plain text for the writing stage.
    responsibilities: z.array(
        z.object({
            text: z.string().min(1),
            category: z.enum(REQUIREMENT_CATEGORIES),
        }),
    ),
});

const SYSTEM = `You read job postings for a resume tool. You extract only what the posting actually says. You never infer requirements the employer did not state, and you never soften or generalise their wording.`;

/** Ceiling on requirements. Beyond this a posting is repeating itself. */
const MAX_REQUIREMENTS = 14;
/** Same idea for duties. Long "What you'll do" lists restate themselves. */
const MAX_RESPONSIBILITIES = 10;

function buildPrompt(jobDescription: string): string {
    return `Read this job posting and extract what the employer will actually check for.

REQUIREMENTS — the heart of this.
Each requirement is one discrete thing a candidate is expected to have or have done.
- Split compound sentences. "6+ years of backend systems and deep experience with
  distributed systems and databases" is THREE requirements, not one.
- Use the posting's own wording, trimmed. Do not paraphrase into your own words —
  this text is quoted back to the candidate.
- "kind": "must" if the posting states it as required, "nice" if it is preferred,
  bonus, or a plus. Do not use "responsibility" here — day-to-day duties go in
  the RESPONSIBILITIES field below and are handled separately.
- "satisfiedByTenure": true ONLY when time served is the whole of what is asked.
    true  — "5+ years designing digital products"
    true  — "3+ years in a product marketing role"
    false — "2+ years owning a paid budget over $1M"   (owning a $1M budget is a
            specific condition; being employed for two years does not meet it)
    false — "5+ years, including 2 leading a team"      (leading a team is extra)
    false — anything with no length of time in it at all
  When unsure, answer false. A wrong true tells a candidate they are qualified
  for something they are not.
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

RESPONSIBILITIES — what the job involves day to day, from "What you'll do",
"In this role you will", "Responsibilities" or equivalent.
- One per duty, in the posting's own words, trimmed. Split compound sentences
  the same way you split requirements.
- Give each the same "category" taxonomy as above.
- These are weighed when deciding which of the candidate's lines earn space, so
  omitting one costs the candidate a bullet that answers it. Be complete.
- Do NOT repeat something you already listed as a requirement.

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

    // Requirements first, then the responsibilities, sharing one id space so
    // everything downstream — scoring, the cover pass, coverage, the gap
    // report — treats them as the single list of things this employer will
    // check for. Which is what they are.
    const stated: JobRequirement[] = data.requirements
        .slice(0, MAX_REQUIREMENTS)
        .map((entry, index) => ({
            id: `r${index + 1}`,
            text: entry.text.trim(),
            // The prompt says not to, but a model that returns
            // `kind: "responsibility"` in the requirements array has still told
            // us something true about the item.
            kind: entry.kind,
            category: entry.category,
            satisfiedByTenure: entry.satisfiedByTenure,
        }));

    const seen = new Set(stated.map((entry) => entry.text.toLowerCase()));
    const duties: JobRequirement[] = data.responsibilities
        .map((entry) => ({ text: entry.text.trim(), category: entry.category }))
        .filter((entry) => entry.text.length > 0)
        .filter((entry) => {
            const key = entry.text.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_RESPONSIBILITIES)
        .map((entry, index) => ({
            id: `d${index + 1}`,
            text: entry.text,
            kind: 'responsibility' as const,
            category: entry.category,
            // A duty is never satisfied by the clock.
            satisfiedByTenure: false,
        }));

    const requirements: JobRequirement[] = [...stated, ...duties];

    return {
        brief: {
            role: data.role.trim(),
            company: data.company.trim(),
            seniority: data.seniority.trim(),
            domain: data.domain.trim(),
            requirements,
            skills,
            // Still exposed as plain text: the writing stage takes them as
            // context, and giving them a home is half of why they stopped
            // ending up in the skills list.
            responsibilities: duties.map((entry) => entry.text),
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
