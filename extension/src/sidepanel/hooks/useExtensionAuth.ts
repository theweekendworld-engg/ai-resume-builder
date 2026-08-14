import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { AuthState } from '@/shared/types/messages';

const POLL_MS = 60_000;

export function useExtensionAuth(): AuthState {
    const [state, setState] = useState<AuthState>({ status: 'disconnected' });

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            const res = await request<AuthState>({ type: 'AUTH_GET' });
            if (cancelled) return;
            if (res.ok) setState(res.data);
        };
        refresh();
        const id = window.setInterval(refresh, POLL_MS);

        // Cross-surface auth changes (e.g. popup completes Connect) propagate
        // via chrome.storage — listen for changes to the auth keys.
        const handler = (changes: { [k: string]: chrome.storage.StorageChange }) => {
            if ('auth.token' in changes || 'auth.expiresAt' in changes) {
                refresh();
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => {
            cancelled = true;
            window.clearInterval(id);
            chrome.storage.onChanged.removeListener(handler);
        };
    }, []);

    return state;
}
