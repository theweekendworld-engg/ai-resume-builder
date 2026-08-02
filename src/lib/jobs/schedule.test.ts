/**
 * Periodic scheduling.
 *
 * Pure apart from the injected enqueue, so this runs with no database. The
 * property that matters is idempotence: the tick runs hourly, and every one of
 * those 24 daily invocations calls this. If the dedupe keys are wrong the
 * result is 24 nudge dispatches a day, which is the failure mode the whole
 * notification budget exists to prevent — arriving through the back door.
 */

import { describe, expect, test } from 'bun:test';

import type { EnqueueFn } from './types';
import { DISPATCH_HOUR_UTC, RADAR_SNAPSHOT_DAY, schedulePeriodicWork } from './schedule';

type Enqueued = { kind: string; payload: object; dedupeKey?: string };

function recorder(): { fn: EnqueueFn; calls: Enqueued[] } {
    const calls: Enqueued[] = [];
    const fn: EnqueueFn = async (kind, payload, opts) => {
        calls.push({ kind, payload, dedupeKey: opts?.dedupeKey });
        return { jobId: `job-${calls.length}`, deduped: false };
    };
    return { fn, calls };
}

/** A date at the dispatch hour on the given day of the month. */
function at(day: number, hour = DISPATCH_HOUR_UTC): Date {
    return new Date(Date.UTC(2026, 7, day, hour, 0, 0));
}

describe('the dispatch hour', () => {
    test('nothing is scheduled outside it', async () => {
        for (const hour of [0, 7, 9, 23]) {
            const { fn, calls } = recorder();
            await schedulePeriodicWork(at(RADAR_SNAPSHOT_DAY, hour), fn);
            expect(calls).toEqual([]);
        }
    });

    test('the mission nudge dispatch fires at it, every day', async () => {
        for (const day of [1, 7, 22, 31]) {
            const { fn, calls } = recorder();
            await schedulePeriodicWork(at(day), fn);
            expect(calls.some((call) => call.kind === 'mission_nudge')).toBe(true);
        }
    });

    test('08:00 UTC, not midnight', async () => {
        // These fan out into email. Composing at 00:00 UTC delivers into the
        // middle of the night across Europe.
        expect(DISPATCH_HOUR_UTC).toBe(8);
    });
});

describe('the Radar snapshot is monthly', () => {
    test('it fires on the first', async () => {
        const { fn, calls } = recorder();
        await schedulePeriodicWork(at(RADAR_SNAPSHOT_DAY), fn);
        expect(calls.some((call) => call.kind === 'radar_snapshot')).toBe(true);
    });

    test('and on no other day', async () => {
        for (const day of [2, 15, 28, 31]) {
            const { fn, calls } = recorder();
            await schedulePeriodicWork(at(day), fn);
            expect(calls.some((call) => call.kind === 'radar_snapshot')).toBe(false);
        }
    });
});

describe('idempotence — the tick runs hourly', () => {
    test('a whole day of ticks produces one nudge dispatch key', async () => {
        const { fn, calls } = recorder();
        for (let hour = 0; hour < 24; hour += 1) {
            await schedulePeriodicWork(at(9, hour), fn);
        }
        const keys = new Set(calls.filter((c) => c.kind === 'mission_nudge').map((c) => c.dedupeKey));
        // One key. The queue's unique constraint turns repeats into no-ops;
        // if the key varied by hour it would not, and the user would get 24.
        expect(keys.size).toBe(1);
        expect([...keys][0]).toBe('mission_nudge:2026-08-09');
    });

    test('a whole month produces one snapshot key', async () => {
        const { fn, calls } = recorder();
        for (let day = 1; day <= 31; day += 1) {
            await schedulePeriodicWork(at(day), fn);
        }
        const keys = new Set(calls.filter((c) => c.kind === 'radar_snapshot').map((c) => c.dedupeKey));
        expect(keys.size).toBe(1);
        expect([...keys][0]).toBe('radar_snapshot:2026-08');
    });

    test('consecutive days get different nudge keys', async () => {
        const { fn, calls } = recorder();
        await schedulePeriodicWork(at(9), fn);
        await schedulePeriodicWork(at(10), fn);
        const keys = calls.filter((c) => c.kind === 'mission_nudge').map((c) => c.dedupeKey);
        expect(new Set(keys).size).toBe(2);
    });
});

describe('scheduling never takes the tick down', () => {
    test('an enqueue failure is swallowed and reported as null', async () => {
        // A missed nudge is one quiet day. An exception here would stop the
        // drain, and the drain is what recovers stuck jobs and dead letters.
        const failing: EnqueueFn = async () => {
            throw new Error('queue unavailable');
        };
        const result = await schedulePeriodicWork(at(RADAR_SNAPSHOT_DAY), failing);
        expect(result).toEqual({ missionNudgeJobId: null, radarSnapshotJobId: null });
    });

    test('one failing job does not prevent the other', async () => {
        const onlyRadarWorks: EnqueueFn = async (kind) => {
            if (kind === 'mission_nudge') throw new Error('nope');
            return { jobId: 'radar-1', deduped: false };
        };
        const result = await schedulePeriodicWork(at(RADAR_SNAPSHOT_DAY), onlyRadarWorks);
        expect(result.missionNudgeJobId).toBeNull();
        expect(result.radarSnapshotJobId).toBe('radar-1');
    });
});

describe('the dispatchers are dispatchers', () => {
    test('they are enqueued with an empty payload — fan-out is the handler’s job', async () => {
        const { fn, calls } = recorder();
        await schedulePeriodicWork(at(RADAR_SNAPSHOT_DAY), fn);
        // impl/00 §P-2: a payload carrying a user list here would mean the
        // scheduler had already done the work the handler exists to fan out.
        for (const call of calls) {
            expect(call.payload).toEqual({});
        }
    });
});
