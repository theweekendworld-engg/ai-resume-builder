import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { ProfileResponse } from '@/shared/types/messages';
import { useExtensionAuth } from './useExtensionAuth';

type State =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; data: ProfileResponse }
    | { status: 'error'; error: string };

export function useProfile(): State {
    const auth = useExtensionAuth();
    const [state, setState] = useState<State>({ status: 'idle' });

    useEffect(() => {
        if (auth.status !== 'connected') {
            setState({ status: 'idle' });
            return;
        }
        let cancelled = false;
        setState({ status: 'loading' });
        (async () => {
            const res = await request<ProfileResponse>({ type: 'GET_PROFILE' });
            if (cancelled) return;
            if (res.ok) setState({ status: 'ready', data: res.data });
            else setState({ status: 'error', error: res.error });
        })();
        return () => {
            cancelled = true;
        };
    }, [auth.status]);

    return state;
}
