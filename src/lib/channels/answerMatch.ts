/**
 * Does this free-text message ANSWER the open question, or is it new input?
 *
 * Found in production 2026-09-26: after a job asked "Would you relocate?",
 * the user's next message, a work note, was recorded as the answer. The note
 * was lost and the job got a nonsense answer. Routing sent every free-text
 * message to whichever run was waiting on a question.
 *
 * Now a message counts as an answer only when it plausibly is one:
 *   - the question has options, and the text names one (value, label, or a
 *     common way of saying it: "yeah", "nope", "depends");
 *   - the question is open-ended, was asked in the last 30 minutes, and the
 *     text is short.
 * Anything else is new input; the question stays open and its buttons work.
 */

import type { PendingQuestion } from '@/lib/agent/run';

export const OPEN_ANSWER_WINDOW_MS = 30 * 60_000;
export const OPEN_ANSWER_MAX_CHARS = 80;

const SYNONYMS: Record<string, string[]> = {
    yes: ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'definitely', 'absolutely', 'of course', 'haan', 'ha', 'yes please', 'i would'],
    no: ['no', 'n', 'nope', 'nah', 'not really', 'never', 'no thanks', 'i would not', "i wouldn't"],
    case_by_case: ['depends', 'it depends', 'maybe', 'possibly', 'case by case', 'depends on the role', 'not sure', 'open to it'],
};

function norm(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchAnswer(
    question: PendingQuestion & { askedAt?: string },
    text: string,
    now: Date = new Date(),
): string | null {
    const said = norm(text);
    if (!said) return null;

    const options = question.options ?? [];
    if (options.length > 0) {
        for (const option of options) {
            if (said === norm(option.value) || said === norm(option.label)) return option.value;
        }
        for (const option of options) {
            const words = SYNONYMS[option.value] ?? [];
            if (words.includes(said)) return option.value;
        }
        // "Remote please" / "hybrid is fine": a short reply naming exactly one option.
        if (said.length <= 40) {
            const named = options.filter((option) => new RegExp(`\\b${norm(option.label)}\\b`).test(said));
            if (named.length === 1) return named[0].value;
        }
        return null;
    }

    const askedAt = question.askedAt ? Date.parse(question.askedAt) : NaN;
    const recent = Number.isFinite(askedAt) && now.getTime() - askedAt <= OPEN_ANSWER_WINDOW_MS;
    if (recent && text.trim().length <= OPEN_ANSWER_MAX_CHARS) return text.trim();
    return null;
}
