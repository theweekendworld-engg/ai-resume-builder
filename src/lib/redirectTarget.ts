import { parseInternalPath } from '@/lib/safeNext';

/**
 * Where a sign-in should land, from the `redirect_url` it arrived with.
 *
 * Clerk's `auth.protect()` sends ABSOLUTE urls (`https://host/log/review/…`),
 * while our own CTAs send paths. `parseInternalPath` accepts only paths, so an
 * absolute url is accepted only when its host is this app's host, and then
 * reduced to its path. Anything else is refused: this value lands in a redirect.
 */
export function resolveRedirectTarget(raw: string | null | undefined, host: string | null | undefined): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) {
        if (!host) return null;
        try {
            const url = new URL(value);
            if (url.host.toLowerCase() !== host.toLowerCase()) return null;
            return parseInternalPath(`${url.pathname}${url.search}${url.hash}`);
        } catch {
            return null;
        }
    }
    return parseInternalPath(value);
}

/** `/welcome`, carrying the intended destination and the score stash when present. */
export function welcomeUrl(params: { next?: string | null; stash?: string | null }): string {
    const query = new URLSearchParams();
    if (params.next) query.set('next', params.next);
    if (params.stash) query.set('stash', params.stash);
    const qs = query.toString();
    return qs ? `/welcome?${qs}` : '/welcome';
}
