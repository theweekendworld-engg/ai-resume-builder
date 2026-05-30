import { getAppBaseUrl } from './backendConfig';
import { setAuth } from './tokenStore';

const PENDING_KEY = 'connect.pending';
const POLL_ALARM = 'connect:poll';
// chrome.alarms enforces a 30s floor in packed/release extensions; for
// unpacked dev builds 0.05 (3s) works and matches the grant TTL well.
const POLL_PERIOD_MIN = 0.05;
// Grant TTL is 10 minutes; give the loop a small grace window before
// abandoning.
const POLL_TIMEOUT_MS = 11 * 60 * 1000;

type PendingConnect = {
    grantId: string;
    verifier: string;
    startedAt: number;
};

type ConnectStartResponse =
    | {
          success: true;
          grantId: string;
          verifier: string;
          connectUrl: string;
          expiresAt: string;
      }
    | { success: false; error?: string };

type ConnectPollResponse = {
    success?: boolean;
    status?:
        | 'pending'
        | 'authorized'
        | 'expired'
        | 'consumed'
        | 'not_found'
        | 'invalid_verifier'
        | 'invalid_request'
        | 'server_error';
    session?: {
        accessToken: string;
        expiresAt: string;
    };
    error?: string;
};

async function readPending(): Promise<PendingConnect | null> {
    const out = await chrome.storage.local.get(PENDING_KEY);
    const v = out[PENDING_KEY];
    if (!v || typeof v !== 'object') return null;
    const p = v as Partial<PendingConnect>;
    if (!p.grantId || !p.verifier || typeof p.startedAt !== 'number') return null;
    return p as PendingConnect;
}

async function writePending(p: PendingConnect): Promise<void> {
    await chrome.storage.local.set({ [PENDING_KEY]: p });
}

async function clearPending(): Promise<void> {
    await chrome.storage.local.remove(PENDING_KEY);
}

export async function startConnectFlow(): Promise<
    { ok: true; connectUrl: string } | { ok: false; error: string }
> {
    const base = await getAppBaseUrl();
    let payload: ConnectStartResponse;
    try {
        const res = await fetch(`${base}/api/extension/connect/start`, {
            method: 'POST',
        });
        payload = (await res.json()) as ConnectStartResponse;
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'connect_start_failed',
        };
    }
    if (
        !payload.success ||
        !payload.grantId ||
        !payload.verifier ||
        !payload.connectUrl
    ) {
        return {
            ok: false,
            error:
                ('error' in payload && payload.error) || 'connect_start_failed',
        };
    }

    await writePending({
        grantId: payload.grantId,
        verifier: payload.verifier,
        startedAt: Date.now(),
    });

    try {
        await chrome.alarms.clear(POLL_ALARM);
        await chrome.alarms.create(POLL_ALARM, {
            periodInMinutes: POLL_PERIOD_MIN,
        });
    } catch {
        // No alarms permission or quirky chromium build — the alarm registration
        // is best-effort; the first manual poll below still authorizes the
        // happy path once the user signs in.
    }

    return { ok: true, connectUrl: payload.connectUrl };
}

export async function cancelConnectFlow(): Promise<void> {
    try {
        await chrome.alarms.clear(POLL_ALARM);
    } catch {
        // ignore
    }
    await clearPending();
}

export async function pollConnectOnce(): Promise<void> {
    const pending = await readPending();
    if (!pending) {
        try {
            await chrome.alarms.clear(POLL_ALARM);
        } catch {
            // ignore
        }
        return;
    }

    if (Date.now() - pending.startedAt > POLL_TIMEOUT_MS) {
        await cancelConnectFlow();
        return;
    }

    const base = await getAppBaseUrl();
    let json: ConnectPollResponse;
    try {
        const res = await fetch(`${base}/api/extension/connect/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grantId: pending.grantId,
                verifier: pending.verifier,
            }),
        });
        json = (await res.json().catch(() => ({}))) as ConnectPollResponse;
    } catch {
        return; // transient network failure — try again on the next alarm tick
    }

    if (json.success && json.status === 'authorized' && json.session) {
        let userIdOrEmail = '';
        let email: string | undefined;
        try {
            const meRes = await fetch(`${base}/api/extension/me`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${json.session.accessToken}` },
            });
            if (meRes.ok) {
                const me = (await meRes.json()) as {
                    bundle?: {
                        profile?: { email?: string; fullName?: string };
                    };
                };
                email = me.bundle?.profile?.email;
                userIdOrEmail = email ?? '';
            }
        } catch {
            // /me failure is non-fatal — the token still authorizes API calls;
            // the popup falls back to userId when email is missing.
        }
        await setAuth({
            token: json.session.accessToken,
            userId: userIdOrEmail,
            email,
            expiresAt: json.session.expiresAt,
        });
        await cancelConnectFlow();
        return;
    }

    // Any terminal non-pending status means the grant is dead; stop polling so
    // the user can start a fresh flow.
    if (json.status && json.status !== 'pending') {
        await cancelConnectFlow();
    }
}
