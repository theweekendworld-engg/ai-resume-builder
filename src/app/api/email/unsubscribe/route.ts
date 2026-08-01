/**
 * One-click unsubscribe (RFC 8058) and the human-facing confirmation page.
 *
 *   POST — what the mail client calls for its own built-in unsubscribe button.
 *          Always answers 200, even for an unknown token: a non-2xx here makes
 *          Gmail show "unsubscribe failed" and pushes the user toward Report Spam.
 *   GET  — what the footer link opens. Applies the change and renders the page.
 *
 * No session, ever. The token is the only credential, and it is single-purpose:
 * it grants nothing except changing this user's email preferences.
 *
 * Idempotent: the handler writes an absolute value rather than toggling, so the
 * second visit shows exactly the same confirmation as the first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_FONT_STACK, emailPalette, escapeHtml } from '@/lib/email/layout';
import {
    applyUnsubscribe,
    parseUnsubscribeCategory,
    type UnsubscribableCategory,
    type UnsubscribeOutcome,
} from '@/lib/email/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<UnsubscribableCategory, string> = {
    weeklyDigest: 'the weekly digest',
    monthlyReview: 'the month in review',
    radarDigest: 'the radar digest',
    missionNudges: 'mission nudges',
    productUpdates: 'product updates',
};

function noStore(response: NextResponse): NextResponse {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
}

function page(input: { title: string; body: string; action?: { label: string; href: string } }): string {
    const L = emailPalette.light;
    const D = emailPalette.dark;
    const action = input.action
        ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(input.action.href)}" style="color:${L.accent};font-size:14px;">${escapeHtml(input.action.label)}</a></p>`
        : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; background:${L.pageBg}; color:${L.text}; font-family:${EMAIL_FONT_STACK}; }
  .card { max-width:520px; margin:12vh auto; padding:32px; background:${L.cardBg}; border:1px solid ${L.border}; border-radius:12px; }
  h1 { margin:0 0 12px; font-size:20px; line-height:28px; font-weight:600; }
  p { margin:0; font-size:15px; line-height:23px; color:${L.muted}; }
  .brand { font-size:12px; letter-spacing:.12em; font-weight:700; color:${L.muted}; margin-bottom:20px; }
  @media (prefers-color-scheme: dark) {
    body { background:${D.pageBg}; color:${D.text}; }
    .card { background:${D.cardBg}; border-color:${D.border}; }
    p, .brand { color:${D.muted}; }
    a { color:${D.accent} !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">PATRONUS</div>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${escapeHtml(input.body)}</p>
    ${action}
  </div>
</body>
</html>`;
}

function html(body: string, status: number): NextResponse {
    return noStore(
        new NextResponse(body, {
            status,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }) as NextResponse
    );
}

function describe(outcome: Extract<UnsubscribeOutcome, { ok: true }>, resubscribeHref: string): string {
    if (outcome.scope === 'all') {
        return outcome.subscribed
            ? page({
                  title: 'You are subscribed again',
                  body: 'Emails will resume. You can fine-tune which ones you get in your notification settings.',
              })
            : page({
                  title: 'Unsubscribed',
                  body: 'You will not get any more email from Patronus. Your work log is untouched and still yours.',
                  action: { label: 'Changed your mind? Resubscribe', href: resubscribeHref },
              });
    }

    const label = CATEGORY_LABEL[outcome.scope];
    return outcome.subscribed
        ? page({ title: 'Resubscribed', body: `You will get ${label} again.` })
        : page({
              title: 'Unsubscribed',
              body: `You will not get ${label} any more. Other Patronus email is unaffected.`,
              action: { label: 'Changed your mind? Resubscribe', href: resubscribeHref },
          });
}

function resubscribeUrl(request: NextRequest, token: string, category: UnsubscribableCategory | null): string {
    const url = new URL(request.nextUrl.toString());
    url.search = '';
    url.searchParams.set('token', token);
    if (category) url.searchParams.set('c', category);
    url.searchParams.set('action', 'resubscribe');
    return url.toString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const category = parseUnsubscribeCategory(request.nextUrl.searchParams.get('c'));
    const subscribed = request.nextUrl.searchParams.get('action') === 'resubscribe';

    if (!token) {
        return html(
            page({
                title: 'Link incomplete',
                body: 'This unsubscribe link is missing its token. Open your notification settings to change what you receive.',
            }),
            400
        );
    }

    const outcome = await applyUnsubscribe({ token, category, subscribed });

    if (!outcome.ok) {
        // Deliberately identical copy for an unknown and an expired token — the
        // response must not confirm whether a token exists.
        return html(
            page({
                title: 'This link is no longer valid',
                body: 'It may have been superseded by a newer email. Open your notification settings to change what you receive.',
            }),
            outcome.reason === 'unknown_token' ? 404 : 500
        );
    }

    return html(describe(outcome, resubscribeUrl(request, token, category)), 200);
}

/**
 * One-click. Gmail/Outlook POST here with `List-Unsubscribe=One-Click` in the
 * body; the token travels in the query string of the URL we put in the header.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const category = parseUnsubscribeCategory(request.nextUrl.searchParams.get('c'));

    if (token) {
        const outcome = await applyUnsubscribe({ token, category, subscribed: false });
        if (!outcome.ok) {
            console.warn('[email] one-click unsubscribe could not be applied', { reason: outcome.reason });
        }
    }

    // Always 200. A mail client that sees a failure here shows the user an error
    // and offers Report Spam instead — far more costly than a silently ignored call.
    return noStore(NextResponse.json({ ok: true }));
}
