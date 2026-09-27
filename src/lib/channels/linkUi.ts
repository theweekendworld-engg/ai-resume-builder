/**
 * The dashboard's Telegram-link state machine, as pure functions.
 *
 * Before: generate a token, copy "/start link_…", open a hardcoded bot, tap
 * START (which replied "link from the dashboard first"), paste, send, then
 * reload the dashboard to see it worked. About seven steps inside fifteen
 * minutes. Now: one button opens t.me/<bot>?start=link_<token>, Telegram's
 * own START sends the token, and the page polls until the link lands.
 */

export type LinkStage =
    /** A verified identity exists for this user. */
    | 'linked'
    /** A token is live; we are waiting for the user to tap START in Telegram. */
    | 'waiting'
    /** A token was issued and has run out without being used. */
    | 'expired'
    /** Nothing in flight. */
    | 'idle';

export const LINK_POLL_MS = 3_000;

export function linkStage(params: { linked: boolean; tokenExpiresAt: string | null; now?: number }): LinkStage {
    if (params.linked) return 'linked';
    if (!params.tokenExpiresAt) return 'idle';
    const expires = Date.parse(params.tokenExpiresAt);
    if (!Number.isFinite(expires)) return 'idle';
    return (params.now ?? Date.now()) < expires ? 'waiting' : 'expired';
}

/** Poll only while the user might be mid-link: token live, not yet linked. */
export function shouldPollLink(stage: LinkStage): boolean {
    return stage === 'waiting';
}

/** The one-tap URL. Falls back to building it when the server omitted it. */
export function telegramStartUrl(params: { deepLink?: string | null; botUsername: string | null; token: string }): string | null {
    if (params.deepLink) return params.deepLink;
    if (!params.botUsername) return null;
    return `https://t.me/${params.botUsername}?start=link_${encodeURIComponent(params.token)}`;
}

/** Minutes left on a token, rounded up; 0 once expired. */
export function minutesLeft(tokenExpiresAt: string | null, now: number = Date.now()): number {
    if (!tokenExpiresAt) return 0;
    const ms = Date.parse(tokenExpiresAt) - now;
    return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}
