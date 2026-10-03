/**
 * Does a Telegram message belong to an open /generate clarification?
 *
 * Before: an open clarification captured EVERY later free-text message, with
 * no expiry and no skip. A job link sent days later became an "answer", and
 * typing "skip" was stored as the literal answer "skip". This mirrors
 * `answerMatch.ts`: a message is taken as the answer only when it plausibly
 * is one; "skip" / "skip all" always mean skip.
 */

import { extractUrls } from '@/lib/scout/message';

export const CLARIFICATION_WINDOW_MS = 30 * 60_000;
/** Longer than this reads as a pasted post or JD, not an answer. */
export const CLARIFICATION_MAX_CHARS = 600;

export type ClarificationRoute = 'answer' | 'skip' | 'skip_all' | 'cancel' | 'pass';

/**
 * "No" to "Do you have hands-on experience with X?" is a skip, not an answer
 * to store: storing "no" as evidence is how a resume ends up claiming X.
 */
const NEGATIVE = /^(no|nope|nah|none|nothing|n\/?a|not really|never|no experience|i don'?t|i do not|don'?t have( any)?|haven'?t|i haven'?t|no i haven'?t|not yet)\b[\s\w']{0,40}$/i;

const CANCEL = /^(cancel|stop|quit|abort|exit|never ?mind|forget it|cancel (it|this|that|the resume))$/i;

/**
 * Not an answer: a question, a greeting, or frustration. Production
 * 2026-10-03: "/help what should i do now" and "what the hell are you doing"
 * were both stored as answers and the second one started a generation.
 */
const NOT_AN_ANSWER = [
    /\?\s*$/,
    /^(what|why|how|who|where|when|which|can|could|should|would|will|is|are|do|does|did)\b.*\b(you|this|that|i|me|it)\b/i,
    /^(hi+|hey+|hello+|yo|sup|hola|thanks?|thank you|ok(ay)?|cool|hmm+|huh|lol|wait|help)\b[\s!.]*$/i,
    /\b(wtf|what the hell|what the fuck|are you (doing|serious|kidding)|stop (it|this)|confus|i don'?t understand|doesn'?t make sense|makes no sense|you('re| are) (wrong|broken|stupid))\b/i,
];

export function looksLikeAnswer(text: string): boolean {
    return !NOT_AN_ANSWER.some((pattern) => pattern.test(text.trim()));
}

export function routeClarificationReply(params: {
    text: string;
    /** When the session last changed, i.e. when the question was asked. */
    askedAt: Date | string | null;
    now?: Date;
}): ClarificationRoute {
    const text = params.text.trim();
    const said = text.toLowerCase().replace(/[.!]+$/, '').trim();
    if (said === 'skip all' || said === 'skip them all' || said === 'skip everything') return 'skip_all';
    if (said === 'skip' || said === 'skip this' || said === 'pass') return 'skip';
    if (CANCEL.test(said)) return 'cancel';
    // A command is never an answer, whatever words follow it.
    if (text.startsWith('/')) return 'pass';

    if (!text || extractUrls(text).length > 0 || text.length > CLARIFICATION_MAX_CHARS) return 'pass';
    if (!looksLikeAnswer(text)) return 'pass';
    const asked = params.askedAt ? new Date(params.askedAt).getTime() : NaN;
    if (!Number.isFinite(asked)) return 'pass';
    const now = (params.now ?? new Date()).getTime();
    if (now - asked > CLARIFICATION_WINDOW_MS) return 'pass';
    return NEGATIVE.test(said) ? 'skip' : 'answer';
}

/** Where the user is in the questions: "2 of 3". Null when unknown. */
export function clarificationProgress(value: unknown): { current: number; total: number } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const obj = value as { questions?: unknown; answers?: unknown };
    const questions = Array.isArray(obj.questions) ? obj.questions.filter((q) => q && typeof q === 'object' && typeof (q as { id?: unknown }).id === 'string') : [];
    if (questions.length === 0) return null;
    const answers = obj.answers && typeof obj.answers === 'object' && !Array.isArray(obj.answers) ? (obj.answers as Record<string, unknown>) : {};
    const answered = questions.filter((q) => (q as { id: string }).id in answers).length;
    return { current: Math.min(answered + 1, questions.length), total: questions.length };
}

/** The next unanswered question in a GenerationSession's `clarifications` JSON. */
export function nextClarificationQuestion(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const obj = value as { questions?: unknown; answers?: unknown };
    const questions = Array.isArray(obj.questions) ? obj.questions : [];
    const answers = obj.answers && typeof obj.answers === 'object' && !Array.isArray(obj.answers)
        ? (obj.answers as Record<string, unknown>)
        : {};
    for (const raw of questions) {
        if (!raw || typeof raw !== 'object') continue;
        const q = raw as { id?: unknown; question?: unknown };
        if (typeof q.id !== 'string' || typeof q.question !== 'string') continue;
        if (!(q.id in answers)) return q.question;
    }
    return null;
}
