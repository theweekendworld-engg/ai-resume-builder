/**
 * Reading a follow-up against the task in focus (docs/impl/07-telegram-apply.md §2).
 *
 * When the user is revising a draft, "make it shorter" or "add IIT Delhi" is
 * an instruction for THAT draft. The general router, with its twelve actions,
 * read it as a new request. This is the narrow step a small model gets right:
 * three choices, and it is shown the draft it would change.
 *
 *   revise  the message is an edit to the draft
 *   done    the user is finished with it ("sent it", "thanks, all good")
 *   other   anything else: a new job, a question, a note. The normal router takes it.
 *
 * Code decides first wherever it can, so most messages cost nothing: a link or
 * a long paste is never an edit, and a slash command never reaches here.
 */

import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { extractUrls } from '@/lib/scout/message';

export const IN_TASK_CHOICES = ['revise', 'done', 'other'] as const;
export type InTaskChoice = (typeof IN_TASK_CHOICES)[number];

/** Longer than this is a paste (a job post, a note), not an edit instruction. */
export const MAX_INSTRUCTION_CHARS = 600;

const ChoiceSchema = z.object({ choice: z.enum(IN_TASK_CHOICES) });

export const IN_TASK_SYSTEM = `The user is editing a message draft with an assistant. Decide what their new message is.

- revise: it asks for any change to the draft: shorter, longer, warmer, more confident, add or remove a fact ("add that I went to IIT Delhi"), change the greeting, the subject, the tone, fix a word. Also a bare fact they want included.
- done: they are finished with the draft ("sent it", "looks good, thanks", "done").
- other: anything that is not about this draft: a new job link or post, a question about something else, a note about their work, a request for a different message or job.

Answer with one choice.`;

/** The cases code can settle without a model. Null means ask the model. */
export function decideInTaskByCode(message: string): InTaskChoice | null {
    const text = message.trim();
    if (!text) return 'other';
    if (text.startsWith('/')) return 'other';
    if (extractUrls(text).length > 0) return 'other';
    if (text.length > MAX_INSTRUCTION_CHARS) return 'other';
    if (/^(shorter|make it shorter|stronger|longer|more formal|less formal|warmer)[.!]?$/i.test(text)) return 'revise';
    if (/^(done|sent|sent it|i sent it|all good|perfect|looks good)[.!,]*(\s*(thanks|thank you|thx|ty))?[.!]*$/i.test(text)) return 'done';
    return null;
}

export async function decideInTask(params: {
    userId: string;
    message: string;
    draft: { subject: string | null; body: string };
}): Promise<{ choice: InTaskChoice; costUsd: number }> {
    const byCode = decideInTaskByCode(params.message);
    if (byCode) return { choice: byCode, costUsd: 0 };

    const draftText = [params.draft.subject ? `Subject: ${params.draft.subject}` : null, params.draft.body.slice(0, 2_000)]
        .filter(Boolean)
        .join('\n');
    try {
        const result = await generateStructured({
            task: 'chatRoute',
            feature: 'chat',
            userId: params.userId,
            schema: ChoiceSchema,
            system: IN_TASK_SYSTEM,
            prompt: `The draft:\n"""\n${draftText}\n"""\n\nThe user's new message:\n"""\n${params.message}\n"""`,
        });
        return { choice: result.data.choice, costUsd: result.usage.costUsd };
    } catch (error) {
        // A routing failure must never eat the message: the general router
        // gets it, as it did before this step existed.
        console.warn('[chat] in-task routing failed; using the general router', {
            error: error instanceof Error ? error.message : String(error),
        });
        return { choice: 'other', costUsd: 0 };
    }
}
