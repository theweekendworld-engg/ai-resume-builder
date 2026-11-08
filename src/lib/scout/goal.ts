/**
 * What the user wants done with a share (docs/impl/07-telegram-apply.md §5).
 *
 * People share a post and add one line of their own: "apply for me",
 * "worth it?", "who should I talk to", "save for later". That line is the
 * goal; the post is the input. Two separate things, so they are separated
 * here before anything else happens:
 *
 *   1. `splitShare` cuts the note off the post. A link's surrounding text is
 *      the note. On a paste, only a short first or last line that is plainly
 *      addressed to us ("apply for me", "worth it?") is taken as the note: a
 *      post's own first line ("Apply now!", "We're hiring") must never start
 *      an application.
 *   2. `goalByCode` reads the note's keywords. Only when they do not decide
 *      does `decideShareGoal` ask ONE small model call with a closed enum.
 *      Any failure resolves to `evaluate`: today's behaviour, which spends
 *      nothing the user did not ask for.
 *
 * The post goes to Scout without the note, so the same post shared with and
 * without "apply for me" is one run (the dedupe key is the post).
 */

import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { extractUrls, parseSharedMessage } from '@/lib/scout/message';
import { SHARE_GOALS, type ShareGoal } from '@/lib/scout/types';

export { SHARE_GOALS, type ShareGoal };

export type SplitShare = {
    url: string | null;
    /** The post to analyse, without the note. */
    text: string | null;
    /** The user's own line about it, or null. */
    note: string | null;
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

/** Same bound as `parseSharedMessage`: above it, text around a link is the post, not a note. */
const COMMENTARY_MAX = 280;
/** A note line on a paste is short. A post's opening sentence usually is not. */
const PASTE_NOTE_MAX = 80;

// ──────────────────────────────────────────────────────────────── keywords

/** "Should I apply?" is a question about fit, so it is read before APPLY. */
const EVALUATE: RegExp[] = [
    /\bshould i (?:apply|go for|bother|take)\b/i,
    /\b(?:is (?:it|this|that)|it'?s|this) (?:worth|a good (?:fit|match|role|job|one)|for me|legit|any good)\b/i,
    /\bworth (?:it|applying|a shot|a try)\b/i,
    /\b(?:am i|would i be|i'?m) (?:a )?(?:good |strong )?(?:fit|match|qualified|eligible)\b/i,
    /\b(?:thoughts|what do you think|wdyt|your take|do i (?:fit|qualify|match)|how do i (?:look|stack up))\b/i,
    /\b(?:evaluate|fit check|check (?:the |my )?fit|score (?:it|this))\b/i,
    /^(?:fit|good fit|any good|legit)\s*\?*$/i,
];

const APPLY: RegExp[] = [
    /\bapply (?:for me|on my behalf|to (?:this|it|that)(?: one)?|for (?:this|it|that)(?: one| job| role)?)\b/i,
    /^(?:please |pls |plz |just |go ahead and |can you |could you |let'?s )?apply(?: now)?(?: please| pls| plz)?[\s!.]*$/i,
    /\bhelp me apply\b/i,
    /\b(?:send|submit|email|mail) (?:my|the) (?:resume|cv|application)\b/i,
    /\b(?:send|submit) (?:it|this) (?:in )?for me\b/i,
    /\b(?:tailor|prepare|make) (?:my |a )?(?:resume|cv) and (?:apply|send|email)\b/i,
    /\bapply\b[^.?!]{0,40}\bfor me\b/i,
];

const SAVE: RegExp[] = [
    /\b(?:save|bookmark|park|stash) (?:it|this|that)(?: one)?\b/i,
    /\b(?:keep|save) (?:it |this )?for later\b/i,
    /^(?:save|bookmark|later|for later|save for later|saving)[\s!.]*$/i,
    /\b(?:look at (?:it|this) later|remind me (?:later|about (?:it|this)))\b/i,
];

const PEOPLE: RegExp[] = [
    /\bwho (?:should|can|do|could|would) i (?:talk|speak|reach out|reach|contact|message|ping|email|write|connect|network)\b/i,
    /\bwho(?:'?s| is) (?:hiring|the (?:recruiter|hiring manager|poster))\b/i,
    /\b(?:find|get) me (?:a |the )?(?:referral|referrer|recruiter|hiring manager|contacts?|people)\b/i,
    /\b(?:referral|refer me|get referred|reach out to|intro(?:duction)? to|who (?:works|do i know) (?:there|at))\b/i,
    /\bpeople (?:to|i should) (?:talk|contact|reach)\b/i,
];

/**
 * The goal the note's own words state, or null when they do not say.
 * Order matters: "should I apply?" is evaluate, "save it, apply later" is save,
 * "apply and find me a referral" is apply (the bigger job).
 */
export function goalByCode(note: string | null | undefined): ShareGoal | null {
    const text = String(note ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (EVALUATE.some((pattern) => pattern.test(text))) return 'evaluate';
    if (APPLY.some((pattern) => pattern.test(text))) return 'apply';
    if (SAVE.some((pattern) => pattern.test(text))) return 'save';
    if (PEOPLE.some((pattern) => pattern.test(text))) return 'people';
    return null;
}

// ──────────────────────────────────────────────────────────────── splitting

/**
 * Text a share sheet adds by itself ("Check out this job at Acme: …"). It is
 * not the user talking, so it is not a note.
 */
const SHARE_SHEET = /^(?:check out|see|view|look at|i(?:'m| am) interested in|interested in) this (?:job|post|role|position|opening|opportunity|profile)\b|\b(?:via|on) linkedin[.!]?$/i;

/**
 * Commentary that is really a bit of the post (a short hiring post with its
 * link): an address, or the poster's own wording. Read only when the keywords
 * found no goal, so "who's the hiring manager?" stays a people note.
 */
const POST_LIKE = /[\w.+-]+@[\w-]+\.[\w.-]+|\b(?:we(?:'re| are) hiring|is hiring|join (?:us|our team)|job description|responsibilities|requirements|apply (?:at|via|here|through|using|by|on)|send (?:your )?(?:resumes?|cvs?) to|dm me)\b/i;

/** On a paste, a line is a note only when it speaks to us: first person, or a short question. */
const FIRST_PERSON = /\b(?:i|me|my|i'?m|i'?ve|i'?d)\b/i;

function cleanNote(raw: string): string | null {
    const kept = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !SHARE_SHEET.test(line));
    const note = kept.join(' ').replace(/\s+/g, ' ').replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '').trim();
    return note.length >= 2 ? note : null;
}

function addressedToUs(line: string): boolean {
    if (line.length > PASTE_NOTE_MAX || !goalByCode(line)) return false;
    return FIRST_PERSON.test(line) || (line.endsWith('?') && line.length <= 40);
}

/**
 * Separate the post from the note. `hint` is for a file, where the two
 * arrived apart (the caption, and the document's text).
 */
export function splitShare(raw: string, hint?: { post: string; note?: string | null }): SplitShare {
    if (hint) {
        const post = parseSharedMessage(hint.post);
        return { ...post, note: cleanNote(hint.note ?? '') };
    }

    const text = String(raw ?? '').trim();
    if (!text) return { url: null, text: null, note: null };

    const urls = extractUrls(text);
    const commentary = text.replace(URL_PATTERN, ' ').replace(/[ \t]+/g, ' ').trim();
    if (urls.length > 0 && commentary.replace(/\s+/g, ' ').length <= COMMENTARY_MAX) {
        const note = cleanNote(commentary);
        // A short hiring post with its link is the post, not a note to us.
        const isNote = note !== null && (goalByCode(note) !== null || !POST_LIKE.test(note));
        return { ...parseSharedMessage(text), note: isNote ? note : null };
    }

    // A paste: maybe a short first or last line addressed to us.
    const lines = text.split('\n');
    const filled = lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => entry.line);
    if (filled.length >= 2) {
        const first = filled[0];
        const last = filled[filled.length - 1];
        for (const candidate of [first, last]) {
            if (!addressedToUs(candidate.line)) continue;
            const post = lines.filter((_, index) => index !== candidate.index).join('\n').trim();
            return { ...parseSharedMessage(post), note: candidate.line };
        }
    }
    return { ...parseSharedMessage(text), note: null };
}

// ──────────────────────────────────────────────────────────────── the call

const GoalSchema = z.object({ goal: z.enum(SHARE_GOALS) });

export const SHARE_GOAL_SYSTEM = `A user shared a job posting or a post with their career assistant and typed a short note with it. Decide what they want done:

- apply: they want the assistant to go ahead and apply: tailor the resume and prepare the application ("go for it", "do it", "send it in", "get me in there").
- evaluate: they want to know whether it fits them or is worth it, or they only shared it.
- people: they want to know who to contact, network with, or ask for a referral.
- save: they want it kept for later.

If the note reads like part of the post itself (a job title, a hiring announcement, instructions to candidates), answer evaluate. When unsure, answer evaluate.`;

export type GoalDecision = {
    goal: ShareGoal;
    /** `none`: there was no note; `code`: keywords decided; `model`: the one call did. */
    by: 'none' | 'code' | 'model' | 'fallback';
    costUsd: number;
};

/** The goal for a share's note. Never throws: a failed call is `evaluate`. */
export async function decideShareGoal(params: { userId: string; note: string | null; runId?: string | null }): Promise<GoalDecision> {
    const note = params.note?.trim() ?? '';
    if (!note) return { goal: 'evaluate', by: 'none', costUsd: 0 };
    const byCode = goalByCode(note);
    if (byCode) return { goal: byCode, by: 'code', costUsd: 0 };
    try {
        const result = await generateStructured({
            task: 'shareGoal',
            feature: 'scout',
            userId: params.userId,
            ...(params.runId ? { sessionId: params.runId } : {}),
            schema: GoalSchema,
            system: SHARE_GOAL_SYSTEM,
            prompt: `The user's note:\n"""\n${note.slice(0, COMMENTARY_MAX)}\n"""`,
            maxRetries: 0,
        });
        return { goal: result.data.goal, by: 'model', costUsd: result.usage.costUsd };
    } catch (error) {
        console.warn('[scout] share goal call failed; evaluating', { error: error instanceof Error ? error.message : String(error) });
        return { goal: 'evaluate', by: 'fallback', costUsd: 0 };
    }
}

/** A stored goal, read defensively: anything unknown is `evaluate`. */
export function goalOf(input: { goal?: unknown } | null | undefined): ShareGoal {
    const goal = input?.goal;
    return typeof goal === 'string' && (SHARE_GOALS as readonly string[]).includes(goal) ? (goal as ShareGoal) : 'evaluate';
}
