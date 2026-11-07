/**
 * The signed token behind a draft's "Mail app" button.
 *
 * Telegram URL buttons must be http(s), and a `mailto:` link is neither, so
 * the button opens `/api/compose/<draftId>?t=<token>`, which redirects to the
 * mailto link. The phone's browser has no Patronus session, so the token is
 * the whole authorisation. What a leaked token can do is bounded to: read ONE
 * draft version (it is in the mailto link) and mark it opened. Nothing else.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 *   token     = `${expiresAtSeconds}.${signature}`
 *   signature = base64url(HMAC-SHA256(key, `compose:v1:${draftId}:${expiresAtSeconds}`))
 *   key       = HMAC-SHA256(WIN_MAGIC_LINK_SECRET, "patronus/compose-link/v1")
 *
 * The key is derived from the magic-link secret under its own label, so a
 * compose token can never verify as a Win magic link or the other way round,
 * and there is no new secret to provision. The draft id is signed, not
 * carried: the route checks the token against the id in its path.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getTokenSecret } from '@/lib/winTokens';

export const COMPOSE_TOKEN_TTL_DAYS = 30;
const TTL_SECONDS = COMPOSE_TOKEN_TTL_DAYS * 86_400;
const KEY_LABEL = 'patronus/compose-link/v1';
const MAX_TOKEN_LENGTH = 128;

function deriveKey(secret: string): Buffer {
    return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function signature(draftId: string, expiresAt: number, secret: string): string {
    return createHmac('sha256', deriveKey(secret)).update(`compose:v1:${draftId}:${expiresAt}`).digest('base64url');
}

/** Null when the secret is not configured: the caller then offers no Mail app button. */
export function signComposeToken(
    draftId: string,
    options: { now?: Date; secret?: string | null } = {},
): string | null {
    const secret = options.secret === undefined ? getTokenSecret() : options.secret;
    if (!secret || !draftId) return null;
    const expiresAt = Math.floor((options.now ?? new Date()).getTime() / 1000) + TTL_SECONDS;
    return `${expiresAt}.${signature(draftId, expiresAt, secret)}`;
}

/**
 * True only for an unexpired token minted for exactly this draft id. Every
 * rejection looks the same, so the failure is not an oracle for the format.
 */
export function verifyComposeToken(
    draftId: string,
    token: string | null | undefined,
    options: { now?: Date; secret?: string | null } = {},
): boolean {
    const secret = options.secret === undefined ? getTokenSecret() : options.secret;
    if (!secret || !draftId || !token || token.length > MAX_TOKEN_LENGTH) return false;
    const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    if (!(expiresAt * 1000 > (options.now ?? new Date()).getTime())) return false;
    const expected = Buffer.from(signature(draftId, expiresAt, secret), 'utf8');
    const given = Buffer.from(match[2], 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
}
