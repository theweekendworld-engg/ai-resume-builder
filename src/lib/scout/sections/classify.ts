/**
 * Section 2: what is this?
 *
 * A job link is a job posting — we already know from the URL, so there is no
 * model call (a `/jobs/view/` URL costs nothing to classify). Only posts,
 * articles and pasted text go to the model, and then once, capped.
 *
 * Company names are checked in code: a name the model returns that does not
 * appear in the text is dropped. "Company news: Stripe" on a post that never
 * mentions Stripe would send the openings section off to research the wrong
 * company, and nothing downstream would notice.
 */

import { z } from 'zod';
import type { ScoutSection } from '@/lib/scout/section';
import { dataOf } from '@/lib/scout/section';
import type { ClassifyData, IngestData, ScoutKind } from '@/lib/scout/types';

export const CLASSIFY_TEXT_CAP = 6_000;

const ClassifySchema = z.object({
    kind: z.enum(['job_posting', 'hiring_post', 'company_signal', 'knowledge', 'work_note', 'other']),
    confidence: z.number().min(0).max(1),
    companies: z.array(z.string().min(1).max(120)).max(6),
    roleTitle: z.string().max(160).nullable(),
    reason: z.string().min(1).max(240),
});

const SYSTEM = `You classify one LinkedIn post (or pasted text) for a job seeker. Return JSON only.

kind:
- job_posting: a job description itself (responsibilities, requirements, how to apply).
- hiring_post: a PERSON announcing openings ("we're hiring", "my team is looking for", "DM me").
- company_signal: news about a company that hints at hiring: funding round, launch, expansion, new office, acquisition, layoffs.
- knowledge: advice, insight, a lesson, interview tips, career or technical learning.
- work_note: the SENDER describing their OWN work: something they shipped, fixed, led, launched, migrated, measured, learned on the job, or feedback they received. Usually first person and short ("shipped the retry queue today, p99 down to 300ms"). A post about SOMEONE ELSE's work, a hiring post, or general advice is never work_note.
- other: anything else (celebration, promotion, meme, unrelated).

companies: company names written in the text, most relevant first. Copy each exactly as written. Never add a company that is not in the text.
roleTitle: the role being hired for, exactly as written, else null.
confidence: 0 to 1.
reason: one plain sentence a user would read, e.g. "A hiring post from an engineering manager at Park+ for a backend SDE II."`;

// ─────────────────────────────────────────────────────── work notes

const FIRST_PERSON = /\b(i|i'm|i've|i'd|me|my|we|we've|our|us)\b/i;
const WORK_VERB = /\b(shipped|fixed|launched|led|built|migrated|reduced|cut|improved|deployed|wrote|designed|refactored|automated|debugged|resolved|closed|released|rolled out|onboarded|mentored|presented|reviewed|optimi[sz]ed|scaled|delivered|finished|completed|got (?:feedback|promoted|praised)|was (?:promoted|thanked))\b/i;
const TIME_HINT = /\b(today|yesterday|this (?:week|sprint|morning|month|quarter)|last (?:week|sprint|night))\b/i;
const URL_PATTERN = /https?:\/\//i;

/** Notes are short; a long first-person text is more often a post or an essay. */
export const WORK_NOTE_MAX_CHARS = 800;

/**
 * A cheap lean, not a verdict: "shipped the retry queue today, p99 down from
 * 900ms to 300ms" has no "I" in it and is still plainly a note about the
 * sender's own work. The model decides; this line in its prompt just stops it
 * from filing a terse note as `other`.
 */
export function looksLikeWorkNote(text: string): boolean {
    const clean = text.trim();
    if (!clean || clean.length > WORK_NOTE_MAX_CHARS || URL_PATTERN.test(clean)) return false;
    if (!WORK_VERB.test(clean)) return false;
    return FIRST_PERSON.test(clean) || TIME_HINT.test(clean) || /^\s*(shipped|fixed|launched|led|built|migrated|reduced|cut|improved|deployed|wrote|designed|refactored|automated|debugged|resolved|released|delivered|finished|completed)\b/i.test(clean);
}

/**
 * Only text the user typed or pasted can be a note about THEIR work. A post
 * fetched from a link was written by someone else, and filing another
 * person's launch as the user's Win would put a claim in their record that
 * they never made.
 */
export function workNoteAllowed(ingest: IngestData): boolean {
    return ingest.linkKind === 'text' && (ingest.fetchVia === 'provided_text' || ingest.fetchVia === 'extension') && !ingest.author;
}

/** Normalise for a containment check: case, whitespace and punctuation-insensitive. */
function squash(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Keep names that appear in the text; dedupe; cap. */
export function verifiedCompanies(candidates: readonly string[], text: string): string[] {
    const haystack = squash(text);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of candidates) {
        const name = raw.trim().replace(/\s*\|\s*LinkedIn$/i, '');
        const key = squash(name);
        if (key.length < 2 || seen.has(key) || !haystack.includes(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out.slice(0, 5);
}

/** The no-model answers. Null means "ask the model". */
export function deterministicClassification(ingest: IngestData): ClassifyData | null {
    const companies = ingest.companyName ? [ingest.companyName] : [];
    switch (ingest.linkKind) {
        case 'linkedin_job':
        case 'ats_job':
            // A job URL shared as text-with-link is still classified by the
            // model: the text may be a post that merely links to a job. And
            // extension text carries no structured company, which the model
            // can read off the page.
            if (ingest.fetchVia === 'provided_text') return null;
            if (ingest.fetchVia === 'extension' && !ingest.companyName) return null;
            return {
                kind: 'job_posting',
                confidence: 1,
                companies,
                roleTitle: ingest.title,
                reason: ingest.linkKind === 'linkedin_job'
                    ? 'A job posting on LinkedIn.'
                    : 'A job posting on the company’s job board.',
            };
        case 'linkedin_company': {
            const name = ingest.title?.replace(/\s*\|\s*LinkedIn$/i, '').replace(/:.*$/, '').trim() || null;
            return {
                kind: 'company_signal',
                confidence: 0.9,
                companies: name ? [name] : [],
                roleTitle: null,
                reason: name ? `The LinkedIn page for ${name}.` : 'A LinkedIn company page.',
            };
        }
        case 'linkedin_profile':
            return {
                kind: 'other',
                confidence: 1,
                companies: [],
                roleTitle: null,
                reason: 'This is a person’s profile. Share a job, a hiring post or a company page instead.',
            };
        default:
            return null;
    }
}

export const classifySection: ScoutSection<'classify'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    if (!ingest) return { status: 'unavailable', reason: 'Nothing was read from the link, so there is nothing to classify.' };

    const shortcut = deterministicClassification(ingest);
    if (shortcut) return { status: 'ok', data: shortcut };

    const text = ingest.text.slice(0, CLASSIFY_TEXT_CAP);
    const noteAllowed = workNoteAllowed(ingest);
    const noteHint = noteAllowed && looksLikeWorkNote(text);
    const { data } = await ctx.step.ai({
        task: 'scoutClassify',
        feature: 'scout',
        schema: ClassifySchema,
        system: SYSTEM,
        prompt: [
            ingest.author ? `Posted by: ${ingest.author}` : null,
            ingest.title ? `Title: ${ingest.title}` : null,
            noteAllowed
                ? 'The sender typed this themselves; it may be a note about their own work.'
                : 'This was read from a link: it was written by someone else, so it is not the sender\'s work_note.',
            noteHint ? 'Hint: it reads like a short note about the sender\'s own work.' : null,
            `Text:\n"""\n${text}\n"""`,
        ].filter(Boolean).join('\n'),
    });

    const haystack = `${ingest.title ?? ''}\n${ingest.text}`;
    // Enforced in code, not trusted to the prompt: see `workNoteAllowed`.
    const kind: ScoutKind = data.kind === 'work_note' && !noteAllowed ? 'other' : data.kind;
    const roleTitle = data.roleTitle && squash(haystack).includes(squash(data.roleTitle)) ? data.roleTitle : null;

    return {
        status: 'ok',
        data: {
            kind,
            confidence: Math.round(data.confidence * 100) / 100,
            companies: verifiedCompanies(data.companies, haystack),
            roleTitle,
            reason: kind === 'other' && data.kind === 'work_note'
                ? 'This is someone else’s post about their work, so it was not added to your Work Log.'
                : data.reason.trim(),
        },
    };
};
