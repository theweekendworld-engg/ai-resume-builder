'use client';

import type { FunnelEventType } from '@/lib/funnelEventSchema';

const SESSION_ID_KEY = 'patronus:funnelSessionId';

function generateSessionId(): string {
    // 16 bytes of randomness as hex; sufficient to avoid collisions across the
    // free-checker funnel and short-lived enough to be privacy-friendly.
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns a stable per-session id for the funnel, generating one on first call
 * and persisting it in sessionStorage so it survives the score → sign-up →
 * /build navigation. Safe to call on the server (returns a no-op id that is
 * never persisted).
 */
export function getOrCreateFunnelSessionId(): string {
    if (typeof window === 'undefined' || !window.sessionStorage) {
        // Server-side or no-storage fallback: generate, do not persist. Caller
        // should not rely on the value being stable across requests.
        return generateSessionId();
    }
    try {
        const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
        if (existing && existing.length >= 8) return existing;
        const fresh = generateSessionId();
        window.sessionStorage.setItem(SESSION_ID_KEY, fresh);
        return fresh;
    } catch {
        return generateSessionId();
    }
}

/**
 * Fire-and-forget funnel event. Never throws. Failures are silent so
 * instrumentation never blocks user flow.
 */
export function trackFunnelEvent(
    type: FunnelEventType,
    payload: Record<string, unknown> = {}
): void {
    try {
        const sessionId = getOrCreateFunnelSessionId();
        const body = JSON.stringify({
            sessionId,
            type,
            payload,
            clientOccurredAt: new Date().toISOString(),
        });

        // Prefer sendBeacon for unload-safe delivery (e.g. CTA-then-navigate),
        // fall back to fetch keepalive for older browsers.
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon('/api/events/funnel', blob);
            return;
        }

        void fetch('/api/events/funnel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => {});
    } catch {
        // Telemetry must never break the page.
    }
}
