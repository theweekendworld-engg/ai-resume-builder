import type { AuthState } from '@/shared/types/messages';

const TOKEN_KEY = 'auth.token';
const USER_KEY = 'auth.userId';
const EMAIL_KEY = 'auth.email';
const EXP_KEY = 'auth.expiresAt';

type StoredAuth = {
    token: string;
    userId: string;
    email?: string;
    expiresAt: string;
};

async function readAll(): Promise<Partial<StoredAuth>> {
    const out = await chrome.storage.local.get([TOKEN_KEY, USER_KEY, EMAIL_KEY, EXP_KEY]);
    return {
        token: out[TOKEN_KEY] as string | undefined,
        userId: out[USER_KEY] as string | undefined,
        email: out[EMAIL_KEY] as string | undefined,
        expiresAt: out[EXP_KEY] as string | undefined,
    };
}

export async function setAuth(input: StoredAuth): Promise<void> {
    await chrome.storage.local.set({
        [TOKEN_KEY]: input.token,
        [USER_KEY]: input.userId,
        [EMAIL_KEY]: input.email ?? '',
        [EXP_KEY]: input.expiresAt,
    });
}

export async function clearAuth(): Promise<void> {
    await chrome.storage.local.remove([TOKEN_KEY, USER_KEY, EMAIL_KEY, EXP_KEY]);
}

export async function getToken(): Promise<string | null> {
    const a = await readAll();
    return a.token ?? null;
}

export async function getAuthState(): Promise<AuthState> {
    const a = await readAll();
    // The token + expiry are the only fields that prove authorization. userId
    // and email are display-only — `/api/extension/me` may not have returned by
    // the time we persist auth, so treating an empty userId as "disconnected"
    // would loop the popup on the Connect button despite a valid token.
    if (!a.token || !a.expiresAt) return { status: 'disconnected' };
    const expired = Date.parse(a.expiresAt) <= Date.now();
    if (expired) return { status: 'expired' };
    return {
        status: 'connected',
        userId: a.userId ?? '',
        email: a.email,
        expiresAt: a.expiresAt,
    };
}
