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

export type ClarificationRoute = 'answer' | 'skip' | 'skip_all' | 'pass';

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

    if (!text || extractUrls(text).length > 0 || text.length > CLARIFICATION_MAX_CHARS) return 'pass';
    const asked = params.askedAt ? new Date(params.askedAt).getTime() : NaN;
    if (!Number.isFinite(asked)) return 'pass';
    const now = (params.now ?? new Date()).getTime();
    return now - asked <= CLARIFICATION_WINDOW_MS ? 'answer' : 'pass';
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
