/**
 * Writing the selected lines.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * One call that rewrote the summary, every experience, every project and the
 * skills list, returning a single JSON blob. Ten decisions competing for one
 * model's attention under a word limit, which is why the output read like a
 * changelog. It also carried a hardcoded thumb on the scale — "Prioritize
 * engineering signals: distributed systems, infra, automation, AI/LLM
 * pipelines, developer productivity" — which is harmless for a backend
 * engineer and actively steers a designer, a PM or an analyst away from their
 * own profession.
 *
 * ── What happens now ────────────────────────────────────────────────────────
 *
 * One call per role, given only that role's selected bullets and the specific
 * requirements they were selected to answer. The model is doing one job with
 * enough context to do it well, and it can see WHY each line is on the page.
 *
 * The summary is written last and separately, because a person writes it last:
 * you cannot position someone until you know what the document actually says.
 *
 * ── The rule that outranks the writing ──────────────────────────────────────
 *
 * Every figure must survive from the source. The numeric guard runs on both
 * calls with the candidate's own text as the source, so a rewrite that
 * invents "40%" is caught, retried once, and stripped if it persists. Rewriting
 * is allowed to change words; it is never allowed to change facts.
 */

import { z } from 'zod';

import { generateStructured } from '@/lib/ai/structured';
import { MAX_BULLET_WORDS, MAX_SUMMARY_WORDS, truncateWords } from '@/lib/resumeNormalizer';
import type { JobRequirement, PostingBrief } from './posting';
import type { ScoredBullet } from './select';

const SYSTEM = `You are an expert resume writer. You rewrite a candidate's own lines so they read well and speak to a specific job. You never add a fact, a tool, a number or a scope that is not already in the line you were given. If a line is already good, you leave it almost alone.`;

/** No defaults — see the note on BriefSchema in posting.ts. */
const BulletsSchema = z.object({
    bullets: z.array(z.object({ id: z.string(), text: z.string().min(1) })),
});

export type WrittenBullet = { id: string; text: string };

function requirementLines(
    bullets: readonly ScoredBullet[],
    requirements: readonly JobRequirement[],
): string {
    const wanted = new Set(bullets.flatMap((bullet) => bullet.answers));
    const relevant = requirements.filter((requirement) => wanted.has(requirement.id));
    if (relevant.length === 0) return '(none — write these on their own merits)';
    return relevant.map((r) => `- ${r.text}`).join('\n');
}

/**
 * Rewrite one role's bullets.
 *
 * `groupLabel` is the role and company, which the model needs to pitch the
 * voice — "Led" reads differently under a staff title than a junior one.
 */
export async function writeBullets(params: {
    groupLabel: string;
    bullets: readonly ScoredBullet[];
    brief: PostingBrief;
    userId: string;
    sessionId?: string;
}): Promise<WrittenBullet[]> {
    if (params.bullets.length === 0) return [];

    const sourceText = params.bullets.map((bullet) => bullet.text).join('\n');

    const prompt = `The candidate is applying for: ${params.brief.role}${
        params.brief.company ? ` at ${params.brief.company}` : ''
    }.

These lines come from their time as ${params.groupLabel}.

WHAT THIS EMPLOYER ASKED FOR, that these lines speak to:
${requirementLines(params.bullets, params.brief.requirements)}

THE LINES, as the candidate wrote them:
${params.bullets.map((b) => `${b.id} | ${b.text}`).join('\n')}

Rewrite each line so a hiring manager for THIS job reads it and understands the
work. Rules, in order of importance:

1. Every number, percentage, duration, currency amount and scope must already
   appear in the line you were given. Do not compute new ones — "800ms to
   180ms" does not license "77% faster". If a line has no number, it gets no
   number.
2. Do not introduce a tool, technology or responsibility the line does not
   mention.
3. Lead with what the candidate did and what changed because of it. Drop
   throat-clearing like "Responsible for" and "Worked on".
4. One line each, at most ${MAX_BULLET_WORDS} words. Plain past tense.
5. Where the line already says it well, change very little. A good line does
   not need improving.

Return one entry per id, using the id exactly as given.`;

    const { data } = await generateStructured({
        task: 'bulletWrite',
        feature: 'resume',
        userId: params.userId,
        sessionId: params.sessionId,
        schema: BulletsSchema,
        system: SYSTEM,
        prompt,
        // The whole point. Source is the candidate's own lines, so an invented
        // figure is caught here rather than by a reader at an interview.
        guard: {
            sourceText,
            fields: Array.from({ length: params.bullets.length }, (_, i) => `bullets.${i}.text`),
        },
    });

    const written = new Map(data.bullets.map((entry) => [entry.id, entry.text]));

    return params.bullets.map((bullet) => {
        const text = written.get(bullet.id)?.trim();
        return {
            id: bullet.id,
            // A bullet the model dropped, or one the guard stripped to empty,
            // falls back to what the candidate wrote. Their own words are
            // always an acceptable answer; an empty line never is.
            text: truncateWords(text || bullet.text, MAX_BULLET_WORDS),
        };
    });
}

// ─────────────────────────────────────────────────────────── the summary

const SummarySchema = z.object({ summary: z.string() });

/**
 * Write the summary last, from the document that now exists.
 *
 * The old one produced "Senior backend engineer specializing in payments
 * infrastructure, high-throughput services, and reliability. Led Kubernetes
 * migrations on AWS, cut invoice p95 from 4.2s to 900ms, reduced settlement
 * failures 2.4% to 0.3%, and rolled out structured logging/tracing to shrink
 * MTTR 45 to 8 minutes" — every metric on the resume, chained with commas,
 * repeating what the reader is about to read anyway. It inventoried. A summary
 * should position: who this person is and why they fit THIS job.
 *
 * So the prompt asks for at most one figure, and only the single most
 * impressive one. The rest of the document is where numbers live.
 */
export async function writeSummary(params: {
    currentTitle: string;
    yearsHint: string;
    bullets: readonly WrittenBullet[];
    brief: PostingBrief;
    /**
     * Skills the posting wants that the candidate cannot evidence.
     *
     * The summary is the one place a tool name can appear without coming from
     * a bullet, because the prompt hands the model the posting's requirements —
     * and those contain tool names. The first live v2 run wrote "Brings deep
     * PostgreSQL and Kafka expertise" for a candidate who has never mentioned
     * PostgreSQL: it had been lifted straight out of the requirement "Deep
     * experience with databases (PostgreSQL, Kafka)".
     *
     * The numeric guard cannot catch that — it polices figures, not nouns. So
     * these are named as forbidden in the prompt AND checked afterwards.
     */
    forbiddenTerms: readonly string[];
    userId: string;
    sessionId?: string;
}): Promise<string> {
    const sourceText = params.bullets.map((b) => b.text).join('\n');

    const musts = params.brief.requirements
        .filter((r) => r.kind === 'must')
        .slice(0, 5)
        .map((r) => `- ${r.text}`)
        .join('\n');

    const prompt = `Write the opening summary for a resume.

APPLYING FOR: ${params.brief.role}${params.brief.company ? ` at ${params.brief.company}` : ''}
THE CANDIDATE IS CURRENTLY: ${params.currentTitle || 'unstated'}${
        params.yearsHint ? ` (${params.yearsHint})` : ''
    }

WHAT THIS EMPLOYER SAID THEY NEED:
${musts || '(not stated)'}

WHAT THE RESUME GOES ON TO SAY:
${sourceText}

Write 2 sentences, ${MAX_SUMMARY_WORDS} words maximum, in the third person with
no pronoun ("Backend engineer who…", not "I am…").

The first sentence says who this person is, opening with the title above —
"${params.currentTitle || params.brief.role}" — in terms this employer would
recognise. The second says what they do that this role needs.

NEVER address the employer or name the company or the role. The reader already
knows which job they posted; a resume that tells them is a mail merge, and it is
the tell that gets a document binned as AI-written. All of these are WRONG:
  "Fit for Northbeam's Senior Product Designer, Payments role through…"
  "Well-suited to Palvo's Growth Marketing Lead role by focusing on…"
  "…well-suited to the Data Analyst role at Verrick Logistics."
Write what they do, and let the fit be obvious:
  "Designs payment flows end to end, from research through a shipped design
   system." 

Do NOT list their achievements — the reader is about to read them. Use at most
ONE number, and only if it is the single most striking thing about them. Every
figure must already appear above.

Never write "results-focused", "proven track record", "passionate", or
"seasoned professional".${forbiddenClause(params.forbiddenTerms)}`;

    const attempt = async (extra: string): Promise<string> => {
        const { data } = await generateStructured({
            task: 'bulletWrite',
            feature: 'resume',
            userId: params.userId,
            sessionId: params.sessionId,
            schema: SummarySchema,
            system: SYSTEM,
            prompt: extra ? `${prompt}\n\n${extra}` : prompt,
            guard: { sourceText, fields: ['summary'] },
        });
        return truncateWords(data.summary.trim(), MAX_SUMMARY_WORDS);
    };

    let summary = await attempt('');

    // Addressing the employer survives the prompt often enough to need a
    // check. All three live audit runs produced the same construction in
    // sentence two, unprompted, and it is the first line a recruiter reads.
    if (addressesEmployer(summary, params.brief)) {
        summary = await attempt(
            `Your previous attempt addressed the employer by name or named the role. Rewrite it so it never mentions ${
                [params.brief.company, params.brief.role].filter(Boolean).join(' or ')
            }. Describe what this person does; the fit speaks for itself.`,
        );
    }

    // Check, then one corrective retry — the same shape the numeric guard
    // uses, for the class of claim it cannot see.
    let offending = mentionedTerms(summary, params.forbiddenTerms);
    if (offending.length > 0) {
        summary = await attempt(
            `Your previous attempt claimed ${offending.join(', ')}. The candidate has NO evidence of ${
                offending.length === 1 ? 'that' : 'those'
            }. Rewrite without ${offending.length === 1 ? 'it' : 'them'}.`,
        );
        offending = mentionedTerms(summary, params.forbiddenTerms);
    }

    // Still claiming it. Fall back to a summary that names no tools at all —
    // duller than the model's, and true, which is the trade this product is
    // built on.
    if (offending.length > 0) {
        console.warn('[resume] summary claimed unevidenced skills; using the safe fallback', {
            userId: params.userId,
            offending,
        });
        return safeSummary(params.currentTitle, params.brief, params.yearsHint);
    }

    return summary;
}

/**
 * Does this summary talk TO the employer rather than about the candidate?
 *
 * Matches the company name and the posting's role title. Both are things a
 * candidate would never write about themselves and a mail merge always does.
 *
 * The role check needs the multi-word form: a summary for a designer should be
 * free to say "product design", and only "Senior Product Designer" — the
 * posting's own headline, repeated back — is the tell.
 */
export function addressesEmployer(
    summary: string,
    brief: Pick<PostingBrief, 'role' | 'company'>,
): boolean {
    const haystack = summary.toLowerCase();

    const company = brief.company.trim().toLowerCase();
    if (company.length >= 3 && haystack.includes(company)) return true;

    const role = brief.role.trim().toLowerCase();
    if (role.split(/\s+/).length >= 2 && haystack.includes(role)) return true;

    return false;
}

function forbiddenClause(terms: readonly string[]): string {
    if (terms.length === 0) return '';
    return `\n\nThe candidate has NO evidence of: ${terms.join(', ')}. These appear in the
posting but not in their history. Never mention them — naming one would put a
claim on this resume that the candidate cannot defend in an interview.`;
}

/** Which forbidden terms does this text actually name? Word-boundary, not substring. */
export function mentionedTerms(text: string, terms: readonly string[]): string[] {
    const haystack = text.toLowerCase();
    return terms.filter((term) => {
        const needle = term.trim().toLowerCase();
        if (needle.length < 2) return false;
        const escaped = needle.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(haystack);
    });
}

/**
 * The last resort. States the role and the seniority and stops.
 *
 * Deliberately says nothing a reader could challenge: no tools, no figures, no
 * adjectives. A dull true sentence beats an impressive false one on the line a
 * hiring manager reads first.
 */
function safeSummary(currentTitle: string, brief: PostingBrief, yearsHint: string): string {
    const role = currentTitle || brief.role || 'Experienced professional';
    const years = /about (\d+) years/.exec(yearsHint)?.[1];
    const opener = years ? `${role} with ${years} years of experience.` : `${role}.`;
    // Deliberately does NOT name the role or the company. This is the path
    // taken when the model would not stop making unevidenced claims, and
    // "Applying for X at Y" was the same mail-merge tell the main path is
    // checked for — the fallback must not reintroduce what it is rescuing us
    // from. The domain is a description of the work, not an address.
    const focus = brief.domain.trim() ? ` Focused on ${brief.domain.trim()}.` : '';
    return truncateWords(`${opener}${focus}`, MAX_SUMMARY_WORDS);
}

/**
 * The title line.
 *
 * The old pipeline assigned `parsedJD.role` verbatim and produced "Senior
 * Backend Engineer Payments Infrastructure" — the posting's headline with its
 * punctuation stripped, on the top line of the document. A title is the
 * candidate's, not the posting's; the most it should do is meet the posting
 * halfway.
 */
export function chooseTitle(params: { candidateTitle: string; postingRole: string }): string {
    const candidate = params.candidateTitle.trim();
    const posting = params.postingRole.trim();

    if (!posting) return candidate;
    if (!candidate) return cleanRole(posting);

    // Same job, different words for it — take the posting's phrasing, since
    // that is what the reader is looking for.
    if (candidate.toLowerCase() === posting.toLowerCase()) return candidate;

    const cleaned = cleanRole(posting);
    // A posting title that has drifted into a department name ("… Payments
    // Infrastructure") is not a job title. Keep the candidate's.
    return cleaned.split(/\s+/).length <= 4 ? cleaned : candidate;
}

/** Trim a posting headline down to the job title inside it. */
function cleanRole(role: string): string {
    return role
        // Everything after a comma or dash is the team, not the title.
        .split(/[,–—]| - /)[0]
        .replace(/\s*\(.*?\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
