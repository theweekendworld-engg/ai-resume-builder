import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Google OAuth for Calendar, done directly (not through Clerk), so it does
 * not depend on the Clerk instance's Google credentials or its migration.
 *
 * Scopes: `calendar.events` (a Google "sensitive" scope: app verification,
 * no paid security assessment) plus `openid email` to show which account is
 * connected. Gmail scopes are never requested: email arrives by forwarding.
 *
 * The state is HMAC-signed and names the user who started the flow; the
 * callback refuses it unless that same user is signed in, which is what stops
 * an attacker from finishing their own flow in a victim's session.
 */

export const CALENDAR_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'] as const;
const STATE_TTL_MS = 10 * 60_000;

export type GoogleTokens = {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
    scopes: string[];
};

export function googleConfigured(): boolean {
    return !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function clientId(): string {
    const value = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!value) throw new Error('GOOGLE_CLIENT_ID is not set');
    return value;
}

function clientSecret(): string {
    const value = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!value) throw new Error('GOOGLE_CLIENT_SECRET is not set');
    return value;
}

export function redirectUri(appUrl: string): string {
    return `${appUrl.replace(/\/$/, '')}/api/google/callback`;
}

function sign(value: string): string {
    return createHmac('sha256', clientSecret()).update(value).digest('base64url');
}

export function createState(userId: string, now: number = Date.now()): string {
    const body = `${Buffer.from(userId).toString('base64url')}.${randomBytes(9).toString('base64url')}.${now + STATE_TTL_MS}`;
    return `${body}.${sign(body)}`;
}

/** The user the flow was started for, or null when forged, altered or expired. */
export function readState(state: string, now: number = Date.now()): string | null {
    const parts = state.split('.');
    if (parts.length !== 4) return null;
    const body = parts.slice(0, 3).join('.');
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(parts[3]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    if (!(Number(parts[2]) > now)) return null;
    return Buffer.from(parts[0], 'base64url').toString('utf8') || null;
}

export function authorizationUrl(appUrl: string, state: string): string {
    const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(appUrl),
        response_type: 'code',
        scope: CALENDAR_SCOPES.join(' '),
        // A refresh token, so the daily sync works without the user present.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch): Promise<GoogleTokens> {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    const json = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !json.access_token) {
        throw new GoogleAuthError(json.error ?? `http_${response.status}`, json.error_description ?? 'Google token request failed');
    }
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: new Date(Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000),
        scopes: (json.scope ?? '').split(/\s+/).filter(Boolean),
    };
}

export class GoogleAuthError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'GoogleAuthError';
    }
    /** The grant is gone (revoked in Google, or expired): the user must reconnect. */
    get revoked(): boolean {
        return this.code === 'invalid_grant';
    }
}

export function exchangeCode(code: string, appUrl: string, fetchImpl: typeof fetch = fetch): Promise<GoogleTokens> {
    return tokenRequest({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(appUrl), grant_type: 'authorization_code' }, fetchImpl);
}

export function refreshAccessToken(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<GoogleTokens> {
    return tokenRequest({ refresh_token: refreshToken, client_id: clientId(), client_secret: clientSecret(), grant_type: 'refresh_token' }, fetchImpl);
}

export async function fetchGoogleEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => ({}))) as { email?: string };
    return json.email ?? null;
}

export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
    await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined);
}
