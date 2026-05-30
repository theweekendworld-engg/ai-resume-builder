// Fire-and-forget telemetry batched at the surface level and flushed via the
// background worker (which holds the bearer token). Never throws. PII rules:
// no JD text, no field values, no question text — only structural counts,
// platform names, durations.

import { request } from '@/background/messageBus';
import type { Message } from '@/shared/types/messages';

export type ExtensionEventType =
    | 'sidepanel.opened'
    | 'sidepanel.route'
    | 'page.parsed'
    | 'fill.applied'
    | 'fill.rejected'
    | 'question.drafted'
    | 'question.inserted'
    | 'session.bound'
    | 'session.step.advanced'
    | 'session.resumed'
    | 'workspace.saved';

type EventEnvelope = {
    type: ExtensionEventType;
    payload: Record<string, unknown>;
    extVersion: string;
    clientOccurredAt: string;
};

const EXT_VERSION = '0.1.0';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 20;

const queue: EventEnvelope[] = [];
let flushTimer: number | null = null;

function scheduleFlush(): void {
    if (typeof window === 'undefined') return;
    if (flushTimer != null) return;
    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        void flush();
    }, FLUSH_INTERVAL_MS);
}

export async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    try {
        // Route through the background worker so it can use the bearer token
        // without exposing it to every surface. The worker's TELEMETRY_BATCH
        // handler is the gatekeeper.
        await request<{ accepted: boolean }>({
            type: 'TELEMETRY_BATCH',
            events: batch,
        } as Message);
    } catch {
        // Re-queue on transient failure, but cap to avoid unbounded growth.
        if (queue.length < 200) {
            queue.unshift(...batch.slice(0, 200 - queue.length));
        }
    }
}

export function trackExtensionEvent(
    type: ExtensionEventType,
    payload: Record<string, unknown> = {}
): void {
    queue.push({
        type,
        payload,
        extVersion: EXT_VERSION,
        clientOccurredAt: new Date().toISOString(),
    });

    if (queue.length >= FLUSH_BATCH_SIZE) {
        void flush();
        return;
    }
    scheduleFlush();
}
