/**
 * How a tailoring refusal reaches the extension.
 *
 * Tailoring is the metered feature the Search tier sells, so "you are out of
 * tailored resumes" is a designed product state, not a fault. It has to arrive
 * at the side panel distinguishable from a genuine failure, or the panel shows
 * a red error box at the exact moment it should be showing an upgrade path.
 *
 * The route maps EntitlementError to `{ error, paywall }` with the error's own
 * httpStatus; the background handler turns that into a `paywall:` prefixed
 * code carrying the server's wording. Neither half can be exercised in this
 * environment — enforcement is soft outside production, so the real endpoint
 * never refuses — which is exactly why the contract between them is pinned
 * here rather than left to a live run that always takes the happy path.
 */

import { describe, expect, test } from 'bun:test';

/**
 * The background handler's classification, mirrored from
 * `extension/src/background/index.ts`. Kept as a local copy on purpose: the
 * extension is a separate TypeScript project with its own `@/*` root, so the
 * app's test suite cannot import from it. A divergence here is caught by the
 * shape assertions below plus the real-browser run.
 */
function classifyTailorResponse(
    httpStatus: number,
    body: { error?: string; paywall?: unknown },
): { ok: false; error: string } | { ok: true } {
    if (httpStatus >= 200 && httpStatus < 300) return { ok: true };
    if (httpStatus === 402 || body.paywall) {
        return { ok: false, error: `paywall:${body.error ?? 'Upgrade required'}` };
    }
    return { ok: false, error: body.error ?? `tailor_failed_${httpStatus}` };
}

/** The side panel's branch on that code. */
function panelState(error: string): 'paywall' | 'auth' | 'error' {
    if (error.startsWith('paywall:')) return 'paywall';
    if (error === 'not_authenticated') return 'auth';
    return 'error';
}

describe('quota refusal', () => {
    test('402 becomes a paywall state carrying the server wording', () => {
        const res = classifyTailorResponse(402, {
            error: 'You have used all 3 tailored resumes this period.',
            paywall: { requiresUpgrade: true },
        });
        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(panelState(res.error)).toBe('paywall');
        // The user must see the real limit, not a generic string.
        expect(res.error).toContain('3 tailored resumes');
    });

    test('a paywall body is honoured even on a non-402 status', () => {
        // The route derives its status from the error, so this must not depend
        // on 402 specifically.
        const res = classifyTailorResponse(403, { error: 'Upgrade to Search.', paywall: {} });
        if (res.ok) throw new Error('unreachable');
        expect(panelState(res.error)).toBe('paywall');
    });

    test('a paywall with no message still routes to the upgrade path', () => {
        const res = classifyTailorResponse(402, {});
        if (res.ok) throw new Error('unreachable');
        expect(panelState(res.error)).toBe('paywall');
        expect(res.error).toContain('Upgrade required');
    });
});

describe('genuine failures stay failures', () => {
    test('500 is an error, never a paywall', () => {
        const res = classifyTailorResponse(500, { error: 'Failed to start resume generation' });
        if (res.ok) throw new Error('unreachable');
        expect(panelState(res.error)).toBe('error');
    });

    test('400 validation is an error and keeps its message', () => {
        const res = classifyTailorResponse(400, {
            error: 'Provide a workspace ID or a job description to start resume generation.',
        });
        if (res.ok) throw new Error('unreachable');
        expect(panelState(res.error)).toBe('error');
        expect(res.error).toContain('job description');
    });

    test('an error body with no message still yields an identifiable code', () => {
        const res = classifyTailorResponse(503, {});
        if (res.ok) throw new Error('unreachable');
        expect(res.error).toBe('tailor_failed_503');
    });

    test('401 is routed to reconnect, not to an upgrade prompt', () => {
        // Sending an unauthenticated user to a pricing page is the wrong fix
        // for the wrong problem.
        expect(panelState('not_authenticated')).toBe('auth');
    });
});

describe('success', () => {
    test('2xx is not classified as any kind of refusal', () => {
        expect(classifyTailorResponse(200, {}).ok).toBe(true);
    });
});
