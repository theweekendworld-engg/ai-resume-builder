/**
 * Channel-neutral reading of an inbound chat message.
 *
 * Everything a linked user sends is recorded somewhere: a link or a pasted
 * post becomes a Scout run, and so does a short note about their work, which
 * Scout classifies as `work_note` and drafts into the Work Log. The one
 * exception is a reply to a question Scout is waiting on — that is an answer,
 * not a new thing to record.
 */

import { extractUrls } from '@/lib/scout/message';

/** Long enough to be a pasted post or JD rather than a reply. */
export const SHARE_TEXT_MIN = 200;
/**
 * Below this a message is chatter ("ok", "thanks", "hi"), not a note. The
 * shortest real note seen in practice ("fixed flaky CI") is 14–20 characters,
 * so 15 keeps notes and drops acknowledgements.
 */
export const NOTE_MIN = 15;

export type InboundIntent =
    /** A link, or a pasted post: start (or reuse) a Scout run. */
    | 'share'
    /** Link-free text a note could be: an answer if a question is open, else a note. */
    | 'reply'
    /** Too short to be a note: an answer if a question is open, else help. */
    | 'tiny'
    | 'command'
    | 'empty';

export function classifyInbound(raw: string): InboundIntent {
    const text = String(raw ?? '').trim();
    if (!text) return 'empty';
    if (text.startsWith('/')) return 'command';
    if (extractUrls(text).length > 0) return 'share';
    if (text.length >= SHARE_TEXT_MIN) return 'share';
    if (text.length < NOTE_MIN) return 'tiny';
    return 'reply';
}

/** What a linked user gets for "ok" / "hi" with nothing open. */
export const TINY_HELP =
    'Send me a job link, a LinkedIn post, or a line about what you worked on, and I will record it. Try /help for everything else.';

/** The user-facing sentence for a start failure, by error code. */
export function startFailureText(error: string, code: string | undefined, appUrl: string): string {
    if (code === 'entitlement_required') {
        return `${error}\n\nSee plans: ${appUrl.replace(/\/$/, '')}/settings/plan`;
    }
    return error;
}
