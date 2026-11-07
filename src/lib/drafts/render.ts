/**
 * A draft version → the chat message with its compose buttons.
 *
 * The message itself is `renderDraftMessage` (pure, in the channel renderer).
 * This adds the two things that need the server: the app URL, and the signed
 * token behind the "Mail app" button. Used by the Telegram button handler
 * (`src/lib/channels/scoutActions.ts`) and by chat when a free-text revision
 * comes in (`src/services/chat.ts`, through `src/services/drafts.ts`).
 */

import { renderDraftMessage, type DraftLinks } from '@/lib/channels/scoutRender';
import type { RichMessage } from '@/lib/channels/types';
import { config } from '@/lib/config';
import { composeLinks, composeRouteUrl } from '@/lib/drafts/compose';
import { signComposeToken } from '@/lib/drafts/composeToken';
import type { DraftView } from '@/lib/drafts/types';

/**
 * Above this a prefilled Gmail link goes through the compose route instead:
 * Telegram does not document a URL-button limit, and a link that is too long
 * fails the whole message. A 120-word email encodes to roughly 1,200.
 */
export const MAX_DIRECT_BUTTON_URL = 2_000;

type LinkOptions = { appUrl?: string; secret?: string | null; now?: Date };

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
    return renderDraftMessage(draft, draftLinks(draft, options), 'telegram');
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
