/**
 * Resolving a GitHub identity and token for a user.
 *
 * Reuses the existing Clerk OAuth linkage (`src/actions/github.ts` already
 * treats "is there a linked GitHub external account" as the connection test) —
 * we do not introduce a second place where GitHub credentials live.
 *
 * Everything here is best-effort by design. A token that cannot be fetched is a
 * *source health* problem (the run degrades, the settings page says "Needs
 * attention"), never an exception that takes a digest down with it.
 */

import { clerkClient } from '@clerk/nextjs/server';

export type GithubIdentity = {
    login: string;
    /** Null when the user connected in public-only mode, or the token is gone. */
    token: string | null;
    scopes: string[];
};

function normalizeLogin(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.includes('github.com')) {
        try {
            const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
            return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
        } catch {
            return '';
        }
    }
    return trimmed.replace(/^@/, '').toLowerCase();
}

/** The linked GitHub login, or '' when the user has not connected OAuth. */
export async function getGithubLogin(userId: string): Promise<string> {
    try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        const accounts = Array.isArray((user as unknown as { externalAccounts?: unknown[] }).externalAccounts)
            ? (user as unknown as { externalAccounts: Array<Record<string, unknown>> }).externalAccounts
            : [];

        for (const account of accounts) {
            const provider = typeof account.provider === 'string' ? account.provider.toLowerCase() : '';
            if (!provider.includes('github')) continue;
            const login =
                normalizeLogin(account.username) ||
                normalizeLogin(account.emailAddress) ||
                normalizeLogin(account.identificationId);
            if (login) return login;
        }
    } catch (error: unknown) {
        console.warn('[capture/github] login lookup failed', {
            userId,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
    return '';
}

/**
 * The user's GitHub OAuth access token, via Clerk.
 *
 * Returns null rather than throwing: public-only mode is a supported product
 * state (§3.2), and an unauthenticated Octokit still reads public repos.
 */
export async function getGithubToken(userId: string): Promise<{ token: string | null; scopes: string[] }> {
    try {
        const client = await clerkClient();
        const response = await client.users.getUserOauthAccessToken(userId, 'github');
        const first = response.data?.[0];
        if (!first?.token) return { token: null, scopes: [] };
        return { token: first.token, scopes: Array.isArray(first.scopes) ? first.scopes : [] };
    } catch (error: unknown) {
        console.warn('[capture/github] token lookup failed', {
            userId,
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return { token: null, scopes: [] };
    }
}

export async function getGithubIdentity(userId: string): Promise<GithubIdentity> {
    const [login, credentials] = await Promise.all([getGithubLogin(userId), getGithubToken(userId)]);
    return { login, token: credentials.token, scopes: credentials.scopes };
}

/** §3.2 — "Full" mode needs `repo`; without it we can only see public work. */
export function hasPrivateRepoAccess(scopes: readonly string[]): boolean {
    return scopes.some((scope) => scope === 'repo' || scope === 'repo:status' || scope.startsWith('repo,'));
}
