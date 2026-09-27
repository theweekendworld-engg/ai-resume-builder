/**
 * Periodic scheduling.
 *
 * Pure apart from the injected enqueue, so this runs with no database. The
 * property that matters is idempotence: the tick runs hourly, and every one of
 * those invocations calls this (daily in production, but a retry or an
 * external pinger can call it more often). If the dedupe keys are wrong the
 * result is 24 nudge dispatches a day, which is the failure mode the whole
 * notification budget exists to prevent — arriving through the back door.
 */

import { describe, expect, test } from 'bun:test';

import type { EnqueueFn } from './types';
import { DISPATCH_HOUR_UTC, RADAR_SNAPSHOT_DAY, schedulePeriodicWork } from './schedule';
void RADAR_SNAPSHOT_DAY;

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

describe('every tick dispatches (the tick is daily on Vercel Hobby)', () => {
    // Regression, 2026-09-27: the old gate `getUTCHours() === 8` was never
    // true for the daily 03:xx tick, so nothing periodic could ever fire.
    test('any hour of any day dispatches the daily work', async () => {
        for (const [day, hour] of [[1, 3], [7, 0], [22, 23], [31, 3]] as const) {
            const { fn, calls } = recorder();
            await schedulePeriodicWork(at(day, hour), fn);
            const kinds = new Set(calls.map((call) => call.kind));
            for (const kind of ['mission_nudge', 'capture_sync', 'ingest_board', 'skill_rollup', 'proactive_downgrade']) {
                expect(kinds.has(kind)).toBe(true);
            }
        }
    });

    test('the monthly and weekly dispatchers are keyed to their period, not a day', async () => {
        const { fn, calls } = recorder();
        await schedulePeriodicWork(at(9, 3), fn);
        const key = (kind: string) => calls.find((call) => call.kind === kind)?.dedupeKey;
        expect(key('radar_snapshot')).toBe('radar_snapshot:2026-08');
        expect(key('month_in_review')).toBe('month_in_review:2026-08');
        expect(key('reconcile_qdrant')).toMatch(/^reconcile_qdrant:2026-W\d{2}$/);
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
        expect(Object.values(result).every((value) => value === null)).toBe(true);
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
