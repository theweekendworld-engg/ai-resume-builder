/**
 * GET /api/compose/<draftId>?t=<token>[&via=gmail]
 *
 * The "Mail app" button on a Telegram draft. Telegram buttons only open
 * http(s) URLs, so the button lands here and is redirected (302) to the
 * draft's `mailto:` link, which the phone hands to its mail app. `via=gmail`
 * redirects to Gmail web compose instead, for drafts too long to put in a
 * button URL. Patronus sends nothing: the user's mail app does, when they
 * press send.
 *
 * Authorised by the signed token alone (`src/lib/drafts/composeToken.ts`):
 * the phone's browser has no Patronus session. The token names one draft
 * version, so this route can read that version and mark it opened, nothing
 * more. It must be listed as self-authenticated in `src/proxy.ts`.
 */

import { composeLinks } from '@/lib/drafts/compose';
import { verifyComposeToken } from '@/lib/drafts/composeToken';
import { getDraftForCompose, markDraftOpened } from '@/services/drafts';
import { track } from '@/lib/track';

export const dynamic = 'force-dynamic';

const ID = /^[a-z0-9]{8,40}$/i;

function page(status: number, message: string): Response {
    return new Response(message, {
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'x-robots-tag': 'noindex',
        },
    });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params;
    const url = new URL(request.url);
    // Signature before the database: a forged link costs no query.
    if (!ID.test(id ?? '') || !verifyComposeToken(id, url.searchParams.get('t'))) {
        return page(403, 'This link has expired or is not valid. Ask Patronus on Telegram for the draft again.');
    }

    const draft = await getDraftForCompose(id);
    if (!draft) return page(404, 'That draft is no longer available.');
    const links = composeLinks(draft);
    const target = url.searchParams.get('via') === 'gmail' ? links.gmail : links.mailto;
    if (!target) return page(404, 'That draft is not an email.');

    const first = await markDraftOpened(draft.userId, draft.id).catch((error: unknown) => {
        // Bookkeeping only: the user still gets their mail app.
        console.warn('[compose] could not mark the draft opened', { draftId: draft.id, error: error instanceof Error ? error.message : String(error) });
        return false;
    });
    if (first) await track(draft.userId, 'message_draft_opened', { via: url.searchParams.get('via') === 'gmail' ? 'gmail' : 'mail_app' });

    return new Response(null, {
        status: 302,
        headers: {
            location: target,
            'cache-control': 'no-store',
            // The token is in this URL; the mail app and Gmail do not need it.
            'referrer-policy': 'no-referrer',
        },
    });
}
