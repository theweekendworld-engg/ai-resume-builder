/**
 * "Send" is a compose link, never a send (owner decision, 2026-11-07): the
 * user opens the draft in their own mail app, attaches the PDF and sends it
 * themselves. Patronus has no mail scope and never will for this.
 *
 * Two links for an email draft:
 *   - Gmail web compose, which Gmail documents only by use, so the parameter
 *     set is the long-stable one: `view=cm&fs=1&to&su&body`.
 *   - `mailto:` (RFC 6068) for every other mail app. Telegram buttons cannot
 *     carry it, so the button goes through `/api/compose/<id>` (signed), which
 *     redirects here.
 *
 * Pure: no IO. Every value is percent-encoded, so a subject with "&" or a
 * body with "#" cannot cut the link short.
 */

import type { DraftView } from '@/lib/drafts/types';

type ComposeFields = Pick<DraftView, 'format' | 'toEmail' | 'subject' | 'body'>;

export type ComposeLinks = { gmail: string | null; mailto: string | null };

/** RFC 6068 wants CRLF line breaks in a mailto body. */
function crlf(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

export function gmailComposeUrl(draft: ComposeFields): string {
    const params = [
        'view=cm',
        'fs=1',
        draft.toEmail ? `to=${encodeURIComponent(draft.toEmail)}` : null,
        draft.subject ? `su=${encodeURIComponent(draft.subject)}` : null,
        `body=${encodeURIComponent(draft.body)}`,
    ].filter(Boolean);
    return `https://mail.google.com/mail/?${params.join('&')}`;
}

export function mailtoUrl(draft: ComposeFields): string {
    // The address sits in the path; "@" stays literal because some clients do
    // not decode %40 there. Everything else in it is code-validated already.
    const to = draft.toEmail ? encodeURIComponent(draft.toEmail).replace(/%40/g, '@') : '';
    const params = [
        draft.subject ? `subject=${encodeURIComponent(draft.subject)}` : null,
        `body=${encodeURIComponent(crlf(draft.body))}`,
    ].filter(Boolean);
    return `mailto:${to}?${params.join('&')}`;
}

/** Both links, or nulls for a draft that is not an email (a LinkedIn note has no compose). */
export function composeLinks(draft: ComposeFields): ComposeLinks {
    if (draft.format !== 'email') return { gmail: null, mailto: null };
    return { gmail: gmailComposeUrl(draft), mailto: mailtoUrl(draft) };
}

export type ComposeVia = 'mail' | 'gmail';

/** The signed redirect route for one draft version. */
export function composeRouteUrl(appUrl: string, draftId: string, token: string, via: ComposeVia = 'mail'): string {
    const base = `${appUrl.replace(/\/+$/, '')}/api/compose/${encodeURIComponent(draftId)}?t=${encodeURIComponent(token)}`;
    return via === 'gmail' ? `${base}&via=gmail` : base;
}
