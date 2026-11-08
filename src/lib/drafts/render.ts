/**
 * A draft version → the chat message with its compose buttons.
 *
 * The message itself is `renderDraftMessage` (pure, in the channel renderer).
 * This adds the two things that need the server: the app URL, and the signed
 * token behind the "Mail app" button. Used by the Telegram button handler
 * (`src/lib/channels/scoutActions.ts`) and by chat when a free-text revision
 * comes in (`src/services/chat.ts`, through `src/services/drafts.ts`).
 */

import { renderDraftMessage, type DraftLinks, type DraftMessageOptions } from '@/lib/channels/scoutRender';
import type { Line, RichMessage, ScoutAction } from '@/lib/channels/types';
import { config } from '@/lib/config';
import { composeLinks, composeRouteUrl } from '@/lib/drafts/compose';
import { signComposeToken } from '@/lib/drafts/composeToken';
import type { DraftView } from '@/lib/drafts/types';
import { skippedSkillsLine } from '@/lib/scout/applyChain';

/**
 * Above this a prefilled Gmail link goes through the compose route instead:
 * Telegram does not document a URL-button limit, and a link that is too long
 * fails the whole message. A 120-word email encodes to roughly 1,200.
 */
export const MAX_DIRECT_BUTTON_URL = 2_000;

type LinkOptions = { appUrl?: string; secret?: string | null; now?: Date; message?: DraftMessageOptions };

export function draftLinks(draft: DraftView, options: LinkOptions = {}): DraftLinks {
    const links = composeLinks(draft);
    if (!links.gmail) return { gmail: null, mailApp: null };
    const appUrl = options.appUrl ?? config.app.url;
    const token = signComposeToken(draft.id, { secret: options.secret, now: options.now });
    const mailApp = token ? composeRouteUrl(appUrl, draft.id, token, 'mail') : null;
    const gmail = links.gmail.length <= MAX_DIRECT_BUTTON_URL
        ? links.gmail
        : token ? composeRouteUrl(appUrl, draft.id, token, 'gmail') : null;
    return { gmail, mailApp };
}

/** The draft as a Telegram message: To / Subject / Body, Open in Gmail, Mail app, Shorter, Stronger. */
export function renderDraftForTelegram(draft: DraftView, options: LinkOptions = {}): RichMessage {
    return renderDraftMessage(draft, draftLinks(draft, options), 'telegram', options.message);
}

/** WhatsApp has no URL buttons: the compose link travels in the text, the revisions as buttons. */
export function renderDraftForWhatsApp(draft: DraftView, options: LinkOptions = {}): RichMessage {
    const links = composeLinks(draft);
    if (!links.gmail) return renderDraftMessage(draft, { gmail: null, mailApp: null }, 'whatsapp');
    const token = signComposeToken(draft.id, { secret: options.secret, now: options.now });
    const appUrl = options.appUrl ?? config.app.url;
    return renderDraftMessage(draft, {
        gmail: token ? composeRouteUrl(appUrl, draft.id, token, 'gmail') : links.gmail,
        mailApp: token ? composeRouteUrl(appUrl, draft.id, token, 'mail') : null,
    }, 'whatsapp');
}

/** The apply chain's draft hint when the PDF went out as a document just above. */
export const ATTACH_PDF_ABOVE = 'Attach the PDF above and send.';
/** Discoverability for marking it Applied (docs/impl/07-telegram-apply.md §5, step d). */
export const SENT_IT_HINT = 'Tell me "sent it" once it is gone and I will mark the job Applied.';

/**
 * The apply chain's draft: the usual draft message (Open in Gmail, Mail app,
 * Shorter, Stronger) with the chain's own lines. An email says to attach the
 * PDF above; a LinkedIn message (the posting gave no address) leads with
 * "Open the application", the posting's own apply link. The skills the
 * skipped questions asked about are named, so nothing unclaimed is a surprise.
 */
export function renderApplicationDraftForTelegram(
    draft: DraftView,
    params: { pdfAttached: boolean; skipped: readonly string[]; applyUrl: string | null },
    options: LinkOptions = {},
): RichMessage {
    const email = draft.format === 'email';
    const recipient = draft.target === 'poster' ? 'the poster' : 'the recruiter';
    const attachHint = email
        ? params.pdfAttached ? ATTACH_PDF_ABOVE : 'Attach your tailored resume (Open resume, above) and send.'
        : `Apply with the ${params.pdfAttached ? 'PDF above' : 'tailored resume above'}${params.applyUrl ? ' at the application link' : ''}, then send this to ${recipient} on LinkedIn.`;
    const skipped = skippedSkillsLine(params.skipped, email ? 'email' : 'message');
    const extraLines: Line[] = [
        ...(skipped ? [[{ text: skipped }]] : []),
        [{ text: SENT_IT_HINT, italic: true }],
    ];
    const leadActions: ScoutAction[] = !email && params.applyUrl ? [{ kind: 'open', label: 'Open the application', url: params.applyUrl }] : [];
    return renderDraftForTelegram(draft, { ...options, message: { attachHint, extraLines, leadActions } });
}

/** The resume is done but the draft failed: say so, and offer the one tap that retries it. */
export function renderApplicationDraftFailure(params: { label: string; error: string; target: 'p' | 'r'; applyUrl: string | null }): RichMessage {
    return {
        lines: [
            [{ text: `Your resume for ${params.label} is above, but I could not write the application draft: ${params.error}` }],
        ],
        actions: [
            { kind: 'draft', target: params.target, format: 'e', label: '✉️ Draft the email' },
            ...(params.applyUrl ? [{ kind: 'open' as const, label: 'Open the application', url: params.applyUrl }] : []),
        ],
    };
}
