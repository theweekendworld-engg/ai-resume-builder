/**
 * Where a signed-out click wanted to end up.
 *
 * ── Why this needs a parser at all ──────────────────────────────────────────
 *
 * Every marketing CTA carries `?redirect_url=`, and every one of them was
 * ignored: Clerk's `forceRedirectUrl` takes precedence over the query
 * parameter, so "Get Career" — the highest-intent click in the funnel — landed
 * people in the builder instead of at checkout. Carrying the intent through
 * means putting a caller-supplied string into a redirect, and a redirect
 * target that came from a URL is an open-redirect waiting to happen.
 *
 * So: same-origin paths only, and the check is a whitelist of shape rather
 * than a blacklist of tricks. `//evil.com` and `https://evil.com` are both
 * valid values of `redirect_url` and both must be refused.
 */

/** Absolute, same-origin path, or null. Never throws. */
export function parseInternalPath(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 512) return null;

    // Must be an absolute path on this origin. `//host` is protocol-relative
    // and leaves the site; `/\evil.com` is treated as protocol-relative by
    // some agents, so backslash is refused in the same position.
    if (!trimmed.startsWith('/')) return null;
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;

    // A scheme anywhere before the first slash-delimited segment means this is
    // not the path it appears to be.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

    // Control characters can be used to split headers or truncate the check.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

    return trimmed;
}
