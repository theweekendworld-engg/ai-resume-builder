import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { ProfileResponse } from '@/shared/types/messages';
import { useExtensionAuth } from './useExtensionAuth';

type State =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; data: ProfileResponse }
    | { status: 'error'; error: string };

/**
 * The signed-in user's profile, or why we don't have it.
 *
 * `idle` and `loading` are derived at render rather than stored. Setting them
 * from inside the effect — which is what this used to do — is a synchronous
 * setState during commit, so every mount and every auth change cost an extra
 * render pass to arrive at a state that was already knowable from `auth`.
 *
 * One consequence, accepted rather than overlooked: after a disconnect and
 * reconnect the previous fetch is still in `result`, so the last profile shows
 * as `ready` for as long as the refetch takes instead of reverting to
 * `loading`. It is the same account either way, so the worst case is a
 * momentarily stale name — cheaper than the generation counter it would take
 * to model, which would mean reading a ref during render.
 */
export function useProfile(): State {
    const auth = useExtensionAuth();
    const [result, setResult] = useState<State | null>(null);

    useEffect(() => {
        if (auth.status !== 'connected') return;
        let cancelled = false;
        (async () => {
            const res = await request<ProfileResponse>({ type: 'GET_PROFILE' });
            if (cancelled) return;
            setResult(
                res.ok
                    ? { status: 'ready', data: res.data }
                    : { status: 'error', error: res.error },
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [auth.status]);

    if (auth.status !== 'connected') return { status: 'idle' };
    return result ?? { status: 'loading' };
}
