/**
 * Push a run's progress to the channel it came from.
 *
 * Channels register a notifier per `Channel`. `web` has none: the dashboard
 * polls. A notifier must never throw into the pipeline — callers catch, but a
 * notifier that swallows its own errors keeps the logs honest about where a
 * failure happened.
 */

import type { Channel } from '@prisma/client';
import { loadRun, type AgentRunRow } from '@/lib/agent/run';

export type ScoutNotifyPhase = 'progress' | 'finished';
export type ScoutNotifier = (run: AgentRunRow, phase: ScoutNotifyPhase) => Promise<void>;

const NOTIFIERS: Partial<Record<Channel, ScoutNotifier>> = {};

export function registerScoutNotifier(channel: Channel, notifier: ScoutNotifier): void {
    NOTIFIERS[channel] = notifier;
}

async function ensureRegistered(): Promise<void> {
    // Channel modules register themselves on import. Imported lazily so the
    // pipeline does not pull every channel SDK into every step bundle.
    // A failed import must be loud: otherwise every channel goes quiet at
    // once and nothing in the logs says why.
    await import('@/lib/channels/register').catch((error: unknown) => {
        console.warn('[scout] channel notifiers failed to load', { error: String(error) });
    });
}

export async function notifyScoutRun(runId: string, phase: ScoutNotifyPhase): Promise<void> {
    const run = await loadRun(runId);
    if (!run) return;
    await ensureRegistered();
    const notifier = NOTIFIERS[run.channel];
    if (!notifier) return;
    await notifier(run, phase);
}
