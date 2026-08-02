import { useEffect, useState } from 'react';
import { getAppBaseUrl } from '@/background/backendConfig';

/**
 * The configured web-app origin, for links out of the side panel.
 *
 * Every route used to inline `const APP_BASE_DEFAULT = 'http://localhost:3000'`
 * and build links from it, which meant a build pointed at any other backend
 * still sent users to localhost — a dead link for every real user, on
 * "Open in editor" and "See plans" alike. Settings already lets someone change
 * the backend; this makes the rest of the panel honour that.
 *
 * Starts at the same default `getAppBaseUrl` falls back to, so the first paint
 * has a usable href rather than an empty one.
 */
export function useAppBaseUrl(): string {
    const [base, setBase] = useState('http://localhost:3000');

    useEffect(() => {
        let cancelled = false;
        void getAppBaseUrl().then((value) => {
            if (!cancelled) setBase(value);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return base;
}
