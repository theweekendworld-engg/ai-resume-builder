import { describe, test, expect } from 'bun:test';
import { JobStatus } from '@prisma/client';
import {
    CHAIN_DEPTH_HEADER,
    CRON_TICK_PATH,
    DEFAULT_BATCH_SIZE,
    DEFAULT_BUDGET_MS,
    DUE_JOBS_ORDER_BY,
    JobDeadlineError,
    MAX_BACKOFF_MINUTES,
    MAX_BATCH_SIZE,
    MAX_BUDGET_MS,
    MAX_CHAIN_DEPTH,
    MAX_ERROR_LENGTH,
    MIN_BUDGET_MS,
    MIN_HANDLER_GRACE_MS,
    STUCK_AFTER_MS,
    buildDedupeKey,
    claimWhere,
    computeBackoffMinutes,
    computeHandlerDeadline,
    computeNextRunAt,
    createInstanceId,
    cronTickUrl,
    decideFailureOutcome,
    dueJobsWhere,
    elapsedMs,
    extractBearerToken,
    formatJobError,
    getHandler,
    isBudgetExhausted,
    parseChainDepth,
    registerHandler,
    registeredKinds,
    remainingBudgetMs,
    resolveBatchSize,
    resolveBudgetMs,
    runWithConcurrency,
    safeEqual,
    shouldRetrigger,
    stuckJobsWhere,
    verifyCronSecret,
    withDeadline,
} from './runner';
import { isJobKind, JOB_KINDS } from './types';

const MINUTE = 60_000;

/** Local sleep — avoids depending on @types/bun for the `Bun` global. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

describe('resolveBatchSize', () => {
    test('defaults when unset', () => {
        expect(resolveBatchSize(undefined)).toBe(DEFAULT_BATCH_SIZE);
    });

    test('defaults on empty / whitespace / non-numeric', () => {
        expect(resolveBatchSize('')).toBe(DEFAULT_BATCH_SIZE);
        expect(resolveBatchSize('   ')).toBe(DEFAULT_BATCH_SIZE);
        expect(resolveBatchSize('twenty-five')).toBe(DEFAULT_BATCH_SIZE);
        expect(resolveBatchSize('NaN')).toBe(DEFAULT_BATCH_SIZE);
    });

    test('defaults on zero and negatives rather than claiming nothing forever', () => {
        expect(resolveBatchSize('0')).toBe(DEFAULT_BATCH_SIZE);
        expect(resolveBatchSize('-10')).toBe(DEFAULT_BATCH_SIZE);
    });

    test('honours a valid value and truncates fractions', () => {
        expect(resolveBatchSize('5')).toBe(5);
        expect(resolveBatchSize(' 7 ')).toBe(7);
        expect(resolveBatchSize('9.9')).toBe(9);
    });

    test('clamps absurd values to MAX_BATCH_SIZE', () => {
        expect(resolveBatchSize('100000')).toBe(MAX_BATCH_SIZE);
    });
});

describe('resolveBudgetMs', () => {
    test('defaults when unset or invalid', () => {
        expect(resolveBudgetMs(undefined)).toBe(DEFAULT_BUDGET_MS);
        expect(resolveBudgetMs('')).toBe(DEFAULT_BUDGET_MS);
        expect(resolveBudgetMs('soon')).toBe(DEFAULT_BUDGET_MS);
        expect(resolveBudgetMs('0')).toBe(DEFAULT_BUDGET_MS);
        expect(resolveBudgetMs('-1')).toBe(DEFAULT_BUDGET_MS);
    });

    test('honours a valid value', () => {
        expect(resolveBudgetMs('240000')).toBe(240_000);
    });

    test('clamps to the min and max window', () => {
        expect(resolveBudgetMs('10')).toBe(MIN_BUDGET_MS);
        expect(resolveBudgetMs('99999999')).toBe(MAX_BUDGET_MS);
    });
});

// ---------------------------------------------------------------------------
// Dedupe keys — idempotency depends entirely on this
// ---------------------------------------------------------------------------

describe('buildDedupeKey', () => {
    test('joins namespace and parts with colons', () => {
        expect(buildDedupeKey('digest', ['user_123', '2026-07-27'])).toBe('digest:user_123:2026-07-27');
    });

    test('namespace alone is a valid key', () => {
        expect(buildDedupeKey('radar_snapshot')).toBe('radar_snapshot');
    });

    test('drops null, undefined and empty segments', () => {
        expect(buildDedupeKey('embed', ['a', null, undefined, '', '   ', 'b'])).toBe('embed:a:b');
    });

    test('accepts numbers and zero', () => {
        expect(buildDedupeKey('noop', [0, 42])).toBe('noop:0:42');
    });

    test('serializes Dates deterministically', () => {
        const date = new Date('2026-07-27T00:00:00.000Z');
        expect(buildDedupeKey('digest', ['u1', date])).toBe('digest:u1:2026-07-27T00_00_00.000Z');
    });

    test('escapes colons inside a segment so segments cannot merge ambiguously', () => {
        expect(buildDedupeKey('k', ['a:b', 'c'])).toBe('k:a_b:c');
        expect(buildDedupeKey('k', ['a', 'b:c'])).not.toBe(buildDedupeKey('k', ['a:b', 'c']));
    });

    test('collapses internal whitespace and trims', () => {
        expect(buildDedupeKey('k', ['  hello   world  '])).toBe('k:hello-world');
    });

    test('is stable across calls with equal input', () => {
        expect(buildDedupeKey('digest', ['u', 'w'])).toBe(buildDedupeKey('digest', ['u', 'w']));
    });

    test('throws when every segment is empty', () => {
        expect(() => buildDedupeKey('   ', [null])).toThrow();
    });
});

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

describe('computeBackoffMinutes', () => {
    test('follows 2^attempts', () => {
        expect(computeBackoffMinutes(1)).toBe(2);
        expect(computeBackoffMinutes(2)).toBe(4);
        expect(computeBackoffMinutes(3)).toBe(8);
        expect(computeBackoffMinutes(4)).toBe(16);
        expect(computeBackoffMinutes(5)).toBe(32);
    });

    test('caps at 60 minutes from attempt 6 on', () => {
        expect(computeBackoffMinutes(6)).toBe(MAX_BACKOFF_MINUTES);
        expect(computeBackoffMinutes(7)).toBe(MAX_BACKOFF_MINUTES);
        expect(computeBackoffMinutes(1000)).toBe(MAX_BACKOFF_MINUTES);
    });

    test('is monotonically non-decreasing', () => {
        let previous = 0;
        for (let attempt = 0; attempt <= 20; attempt += 1) {
            const value = computeBackoffMinutes(attempt);
            expect(value).toBeGreaterThanOrEqual(previous);
            previous = value;
        }
    });

    test('degenerate inputs never produce zero or negative delay', () => {
        expect(computeBackoffMinutes(0)).toBe(1);
        expect(computeBackoffMinutes(-5)).toBe(1);
        expect(computeBackoffMinutes(Number.NaN)).toBe(1);
        expect(computeBackoffMinutes(Number.POSITIVE_INFINITY)).toBe(1);
        expect(computeBackoffMinutes(2.9)).toBe(4);
    });
});

describe('computeNextRunAt', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');

    test('adds the backoff window to now', () => {
        expect(computeNextRunAt(1, now).toISOString()).toBe('2026-08-01T12:02:00.000Z');
        expect(computeNextRunAt(5, now).toISOString()).toBe('2026-08-01T12:32:00.000Z');
        expect(computeNextRunAt(9, now).toISOString()).toBe('2026-08-01T13:00:00.000Z');
    });

    test('always returns a future timestamp', () => {
        for (let attempt = 0; attempt <= 8; attempt += 1) {
            expect(computeNextRunAt(attempt, now).getTime()).toBeGreaterThan(now.getTime());
        }
    });
});

// ---------------------------------------------------------------------------
// Failure disposition
// ---------------------------------------------------------------------------

describe('decideFailureOutcome', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');

    test('reschedules while attempts remain', () => {
        const outcome = decideFailureOutcome({ attempts: 1, maxAttempts: 3, error: new Error('boom'), now });
        expect(outcome.status).toBe(JobStatus.pending);
        expect(outcome.attempts).toBe(1);
        expect(outcome.runAt.getTime()).toBe(now.getTime() + 2 * MINUTE);
        expect(outcome.finishedAt).toBeNull();
        expect(outcome.lastError).toBe('boom');
    });

    test('second failure backs off further', () => {
        const outcome = decideFailureOutcome({ attempts: 2, maxAttempts: 3, error: 'again', now });
        expect(outcome.status).toBe(JobStatus.pending);
        expect(outcome.runAt.getTime()).toBe(now.getTime() + 4 * MINUTE);
    });

    test('exhausting maxAttempts marks the job dead, never dropped', () => {
        const outcome = decideFailureOutcome({ attempts: 3, maxAttempts: 3, error: 'fatal', now });
        expect(outcome.status).toBe(JobStatus.dead);
        expect(outcome.finishedAt).toEqual(now);
        expect(outcome.lastError).toBe('fatal');
    });

    test('overshooting maxAttempts is still dead, not a retry', () => {
        expect(decideFailureOutcome({ attempts: 9, maxAttempts: 3, error: 'x', now }).status).toBe(JobStatus.dead);
    });

    test('maxAttempts of 1 dies on the first failure', () => {
        expect(decideFailureOutcome({ attempts: 1, maxAttempts: 1, error: 'x', now }).status).toBe(JobStatus.dead);
    });

    test('a nonsensical maxAttempts of 0 is treated as 1 and dies rather than looping', () => {
        expect(decideFailureOutcome({ attempts: 1, maxAttempts: 0, error: 'x', now }).status).toBe(JobStatus.dead);
    });

    test('every terminal state is pending or dead — `failed` is never a resting state', () => {
        for (let attempts = 1; attempts <= 6; attempts += 1) {
            const outcome = decideFailureOutcome({ attempts, maxAttempts: 5, error: 'x', now });
            expect([JobStatus.pending, JobStatus.dead]).toContain(outcome.status);
        }
    });
});

describe('formatJobError', () => {
    test('uses the Error message', () => {
        expect(formatJobError(new Error('kaboom'))).toBe('kaboom');
    });

    test('falls back to the error name when the message is empty', () => {
        expect(formatJobError(new TypeError(''))).toBe('TypeError');
    });

    test('passes strings through, trimmed', () => {
        expect(formatJobError('  plain  ')).toBe('plain');
    });

    test('serializes objects', () => {
        expect(formatJobError({ code: 'P2002' })).toBe('{"code":"P2002"}');
    });

    test('survives non-serializable throws', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(typeof formatJobError(circular)).toBe('string');
        expect(formatJobError(circular).length).toBeGreaterThan(0);
    });

    test('never returns an empty string', () => {
        expect(formatJobError(undefined)).toBe('undefined');
        expect(formatJobError('')).toBe('unknown error');
        expect(formatJobError(null)).toBe('null');
    });

    test('truncates to the column budget', () => {
        const long = 'x'.repeat(MAX_ERROR_LENGTH + 500);
        const formatted = formatJobError(long);
        expect(formatted.length).toBe(MAX_ERROR_LENGTH);
        expect(formatted.endsWith('…')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Time budget
// ---------------------------------------------------------------------------

describe('time budget helpers', () => {
    const start = 1_000_000;

    test('elapsedMs is never negative even with clock skew', () => {
        expect(elapsedMs(start, start + 250)).toBe(250);
        expect(elapsedMs(start, start - 5_000)).toBe(0);
    });

    test('budget is not exhausted before the deadline', () => {
        expect(isBudgetExhausted(start, 45_000, start)).toBe(false);
        expect(isBudgetExhausted(start, 45_000, start + 44_999)).toBe(false);
    });

    test('budget is exhausted exactly at and after the deadline', () => {
        expect(isBudgetExhausted(start, 45_000, start + 45_000)).toBe(true);
        expect(isBudgetExhausted(start, 45_000, start + 90_000)).toBe(true);
    });

    test('remainingBudgetMs floors at zero', () => {
        expect(remainingBudgetMs(start, 45_000, start + 5_000)).toBe(40_000);
        expect(remainingBudgetMs(start, 45_000, start + 45_000)).toBe(0);
        expect(remainingBudgetMs(start, 45_000, start + 999_999)).toBe(0);
    });
});

describe('computeHandlerDeadline', () => {
    const start = 1_000_000;

    test('is the drain deadline while plenty of budget remains', () => {
        expect(computeHandlerDeadline(start, 45_000, start + 1_000).getTime()).toBe(start + 45_000);
    });

    test('grants a minimum grace when claimed near the cutoff', () => {
        const nowMs = start + 44_990;
        expect(computeHandlerDeadline(start, 45_000, nowMs).getTime()).toBe(nowMs + MIN_HANDLER_GRACE_MS);
    });

    test('is always in the future relative to now', () => {
        for (const offset of [0, 10_000, 44_999, 45_000, 60_000]) {
            const nowMs = start + offset;
            expect(computeHandlerDeadline(start, 45_000, nowMs).getTime()).toBeGreaterThan(nowMs);
        }
    });

    test('grace is configurable', () => {
        const nowMs = start + 50_000;
        expect(computeHandlerDeadline(start, 45_000, nowMs, 1_000).getTime()).toBe(nowMs + 1_000);
    });
});

// ---------------------------------------------------------------------------
// Query predicates
// ---------------------------------------------------------------------------

describe('claim and recovery predicates', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');

    test('dueJobsWhere selects pending work that is due', () => {
        expect(dueJobsWhere(now)).toEqual({ status: JobStatus.pending, runAt: { lte: now } });
    });

    test('due jobs are ordered by priority then runAt', () => {
        expect(DUE_JOBS_ORDER_BY).toEqual([{ priority: 'asc' }, { runAt: 'asc' }]);
    });

    test('claimWhere restates the full precondition so the update is atomic', () => {
        expect(claimWhere('job_1', now)).toEqual({
            id: 'job_1',
            status: JobStatus.pending,
            runAt: { lte: now },
        });
    });

    test('claimWhere never omits the status guard — this is what prevents double-claims', () => {
        const where = claimWhere('job_1', now) as { status?: unknown; runAt?: unknown };
        expect(where.status).toBe(JobStatus.pending);
        expect(where.runAt).toBeDefined();
    });

    test('stuckJobsWhere targets running rows locked longer than 10 minutes ago', () => {
        expect(stuckJobsWhere(now)).toEqual({
            status: JobStatus.running,
            lockedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        });
    });

    test('a job locked 11 minutes ago is inside the stuck window; 9 minutes is not', () => {
        const cutoff = (stuckJobsWhere(now).lockedAt as { lt: Date }).lt.getTime();
        expect(new Date(now.getTime() - 11 * MINUTE).getTime()).toBeLessThan(cutoff);
        expect(new Date(now.getTime() - 9 * MINUTE).getTime()).toBeGreaterThan(cutoff);
    });

    test('the stale window is configurable', () => {
        const where = stuckJobsWhere(now, 60_000);
        expect((where.lockedAt as { lt: Date }).lt).toEqual(new Date(now.getTime() - 60_000));
    });
});

describe('createInstanceId', () => {
    test('is unique per call', () => {
        const ids = new Set(Array.from({ length: 50 }, () => createInstanceId()));
        expect(ids.size).toBe(50);
    });

    test('is deterministic given a fixed clock and token', () => {
        const now = new Date('2026-08-01T12:00:00.000Z');
        expect(createInstanceId(now, 'abcdefgh-rest')).toBe(createInstanceId(now, 'abcdefgh-rest'));
    });

    test('fits comfortably in the lockedBy column', () => {
        expect(createInstanceId().length).toBeLessThan(120);
    });
});

// ---------------------------------------------------------------------------
// Cron auth
// ---------------------------------------------------------------------------

describe('extractBearerToken', () => {
    test('extracts the token', () => {
        expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    });

    test('is scheme-case-insensitive and tolerates padding', () => {
        expect(extractBearerToken('bearer  abc123  ')).toBe('abc123');
        expect(extractBearerToken('  BEARER\tabc123')).toBe('abc123');
    });

    test('rejects a missing or malformed header', () => {
        expect(extractBearerToken(null)).toBeNull();
        expect(extractBearerToken(undefined)).toBeNull();
        expect(extractBearerToken('')).toBeNull();
        expect(extractBearerToken('abc123')).toBeNull();
        expect(extractBearerToken('Basic abc123')).toBeNull();
        expect(extractBearerToken('Bearer')).toBeNull();
        expect(extractBearerToken('Bearer    ')).toBeNull();
    });

    test('keeps tokens containing spaces intact after the scheme', () => {
        expect(extractBearerToken('Bearer a b')).toBe('a b');
    });
});

describe('safeEqual', () => {
    test('true only for identical strings', () => {
        expect(safeEqual('secret', 'secret')).toBe(true);
        expect(safeEqual('secret', 'secreT')).toBe(false);
        expect(safeEqual('', '')).toBe(true);
    });

    test('handles differing lengths without throwing', () => {
        expect(safeEqual('short', 'a-much-longer-secret')).toBe(false);
        expect(safeEqual('a-much-longer-secret', 'short')).toBe(false);
        expect(safeEqual('secret', '')).toBe(false);
    });

    test('handles multibyte input', () => {
        expect(safeEqual('sécret✓', 'sécret✓')).toBe(true);
        expect(safeEqual('sécret✓', 'secret✓')).toBe(false);
    });
});

describe('verifyCronSecret', () => {
    test('accepts the configured secret', () => {
        expect(verifyCronSecret('Bearer s3cr3t', 's3cr3t')).toBe(true);
        expect(verifyCronSecret('bearer s3cr3t', '  s3cr3t  ')).toBe(true);
    });

    test('rejects a wrong, absent or partial secret', () => {
        expect(verifyCronSecret('Bearer nope', 's3cr3t')).toBe(false);
        expect(verifyCronSecret('Bearer s3cr3', 's3cr3t')).toBe(false);
        expect(verifyCronSecret('Bearer s3cr3tt', 's3cr3t')).toBe(false);
        expect(verifyCronSecret(null, 's3cr3t')).toBe(false);
        expect(verifyCronSecret('s3cr3t', 's3cr3t')).toBe(false);
    });

    test('fails closed when CRON_SECRET is unconfigured', () => {
        expect(verifyCronSecret('Bearer anything', undefined)).toBe(false);
        expect(verifyCronSecret('Bearer anything', '')).toBe(false);
        expect(verifyCronSecret('Bearer anything', '   ')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Self-retrigger chain
// ---------------------------------------------------------------------------

describe('parseChainDepth', () => {
    test('missing or unparseable header means depth 0', () => {
        expect(parseChainDepth(null)).toBe(0);
        expect(parseChainDepth(undefined)).toBe(0);
        expect(parseChainDepth('')).toBe(0);
        expect(parseChainDepth('deep')).toBe(0);
        expect(parseChainDepth('-3')).toBe(0);
    });

    test('parses a valid depth', () => {
        expect(parseChainDepth('1')).toBe(1);
        expect(parseChainDepth(' 4 ')).toBe(4);
        expect(parseChainDepth('4.7')).toBe(4);
    });

    test('a forged oversized depth is clamped to the cap, which stops the chain', () => {
        expect(parseChainDepth('9999')).toBe(MAX_CHAIN_DEPTH);
        expect(shouldRetrigger({ workRemaining: true, depth: parseChainDepth('9999') })).toBe(false);
    });
});

describe('shouldRetrigger', () => {
    test('never retriggers with no work remaining', () => {
        for (let depth = 0; depth <= MAX_CHAIN_DEPTH; depth += 1) {
            expect(shouldRetrigger({ workRemaining: false, depth })).toBe(false);
        }
    });

    test('retriggers while work remains and the chain is under the cap', () => {
        for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
            expect(shouldRetrigger({ workRemaining: true, depth })).toBe(true);
        }
    });

    test('stops exactly at the cap', () => {
        expect(shouldRetrigger({ workRemaining: true, depth: MAX_CHAIN_DEPTH })).toBe(false);
        expect(shouldRetrigger({ workRemaining: true, depth: MAX_CHAIN_DEPTH + 5 })).toBe(false);
    });

    test('the chain terminates: walking from depth 0 halts within maxDepth hops', () => {
        let depth = 0;
        let hops = 0;
        while (shouldRetrigger({ workRemaining: true, depth })) {
            depth += 1;
            hops += 1;
            expect(hops).toBeLessThanOrEqual(MAX_CHAIN_DEPTH);
        }
        expect(hops).toBe(MAX_CHAIN_DEPTH);
    });

    test('maxDepth is overridable', () => {
        expect(shouldRetrigger({ workRemaining: true, depth: 2, maxDepth: 2 })).toBe(false);
        expect(shouldRetrigger({ workRemaining: true, depth: 1, maxDepth: 2 })).toBe(true);
    });
});

describe('cronTickUrl', () => {
    test('appends the tick path', () => {
        expect(cronTickUrl('https://app.example.com')).toBe(`https://app.example.com${CRON_TICK_PATH}`);
    });

    test('normalizes trailing slashes and padding', () => {
        expect(cronTickUrl('https://app.example.com/')).toBe(`https://app.example.com${CRON_TICK_PATH}`);
        expect(cronTickUrl('  https://app.example.com///  ')).toBe(`https://app.example.com${CRON_TICK_PATH}`);
    });

    test('throws rather than building a relative URL fetch cannot use', () => {
        expect(() => cronTickUrl('')).toThrow();
        expect(() => cronTickUrl('   ')).toThrow();
    });

    test('the chain-depth header name is lowercase for fetch/Headers consistency', () => {
        expect(CHAIN_DEPTH_HEADER).toBe(CHAIN_DEPTH_HEADER.toLowerCase());
    });
});

// ---------------------------------------------------------------------------
// Bounded concurrency
// ---------------------------------------------------------------------------

describe('runWithConcurrency', () => {
    test('empty input resolves to an empty array', async () => {
        expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
    });

    test('preserves input order regardless of completion order', async () => {
        const items = [50, 5, 30, 1, 20];
        const results = await runWithConcurrency(items, 4, async (ms, index) => {
            await sleep(ms);
            return index;
        });
        expect(results.map((r) => (r.status === 'fulfilled' ? r.value : -1))).toEqual([0, 1, 2, 3, 4]);
    });

    test('never exceeds the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;
        await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await sleep(2);
            inFlight -= 1;
            return null;
        });
        expect(peak).toBe(4);
    });

    test('runs every item exactly once', async () => {
        const seen: number[] = [];
        await runWithConcurrency(Array.from({ length: 25 }, (_, i) => i), 4, async (item) => {
            seen.push(item);
            return item;
        });
        expect(seen.length).toBe(25);
        expect(new Set(seen).size).toBe(25);
    });

    test('one rejection does not stop the rest', async () => {
        const results = await runWithConcurrency([1, 2, 3], 2, async (n) => {
            if (n === 2) throw new Error('nope');
            return n;
        });
        expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
        expect(results[1].status).toBe('rejected');
        expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
    });

    test('degenerate limits fall back to serial execution', async () => {
        let peak = 0;
        let inFlight = 0;
        for (const limit of [0, -1, Number.NaN]) {
            await runWithConcurrency([1, 2, 3], limit, async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await sleep(1);
                inFlight -= 1;
                return null;
            });
        }
        expect(peak).toBe(1);
    });

    test('a limit larger than the input does not spawn idle lanes', async () => {
        const results = await runWithConcurrency([1, 2], 100, async (n) => n * 2);
        expect(results.map((r) => (r.status === 'fulfilled' ? r.value : -1))).toEqual([2, 4]);
    });
});

// ---------------------------------------------------------------------------
// Deadline enforcement
// ---------------------------------------------------------------------------

describe('withDeadline', () => {
    test('passes through a value that resolves in time', async () => {
        const deadline = new Date(Date.now() + 500);
        expect(await withDeadline(Promise.resolve('ok'), deadline, 'job_1')).toBe('ok');
    });

    test('propagates the handler’s own rejection unchanged', async () => {
        const deadline = new Date(Date.now() + 500);
        await expect(withDeadline(Promise.reject(new Error('handler blew up')), deadline, 'job_1')).rejects.toThrow(
            'handler blew up',
        );
    });

    test('rejects with JobDeadlineError when the handler overruns', async () => {
        const deadline = new Date(Date.now() + 20);
        const slow = sleep(200).then(() => 'too late');
        await expect(withDeadline(slow, deadline, 'job_slow')).rejects.toBeInstanceOf(JobDeadlineError);
    });

    test('rejects immediately on an already-passed deadline', async () => {
        const deadline = new Date(Date.now() - 1_000);
        await expect(withDeadline(sleep(50), deadline, 'job_late')).rejects.toBeInstanceOf(JobDeadlineError);
    });

    test('a late rejection from the loser does not become an unhandled rejection', async () => {
        const deadline = new Date(Date.now() + 10);
        const late = sleep(40).then(() => {
            throw new Error('late failure');
        });
        await expect(withDeadline(late, deadline, 'job_late')).rejects.toBeInstanceOf(JobDeadlineError);
        await sleep(80); // would surface as an unhandled rejection here if mishandled
    });

    test('a deadline failure feeds the normal retry path', () => {
        const now = new Date('2026-08-01T12:00:00.000Z');
        const outcome = decideFailureOutcome({
            attempts: 1,
            maxAttempts: 3,
            error: new JobDeadlineError('job_1', now),
            now,
        });
        expect(outcome.status).toBe(JobStatus.pending);
        expect(outcome.lastError).toContain('exceeded its deadline');
    });
});

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

describe('handler registry', () => {
    test('registers and resolves a handler', () => {
        const handler = async () => ({ ok: true });
        registerHandler('radar_snapshot', handler);
        expect(getHandler('radar_snapshot')).toBe(handler);
        expect(registeredKinds()).toContain('radar_snapshot');
    });

    test('re-registering the same kind replaces the handler rather than duplicating', () => {
        const second = async () => ({ ok: 2 });
        registerHandler('radar_snapshot', async () => ({ ok: 1 }));
        registerHandler('radar_snapshot', second);
        expect(getHandler('radar_snapshot')).toBe(second);
        expect(registeredKinds().filter((k) => k === 'radar_snapshot')).toHaveLength(1);
    });

    test('an unknown kind resolves to undefined so the runner can fail it explicitly', () => {
        expect(getHandler('kind_that_does_not_exist')).toBeUndefined();
    });
});

describe('JobKind', () => {
    test('every declared kind is recognised', () => {
        for (const kind of JOB_KINDS) expect(isJobKind(kind)).toBe(true);
    });

    test('rejects anything else', () => {
        expect(isJobKind('weekly_digests')).toBe(false);
        expect(isJobKind('')).toBe(false);
        expect(isJobKind(null)).toBe(false);
        expect(isJobKind(7)).toBe(false);
    });

    test('the list has no duplicates', () => {
        expect(new Set(JOB_KINDS).size).toBe(JOB_KINDS.length);
    });
});

// ---------------------------------------------------------------------------
// Integration tests live in `runner.integration.test.ts`.
//
// Every case sketched below is now implemented there and passing against the
// local Docker Postgres. Kept as `describe.skip` documentation of intent —
// delete this block once the integration file is uncontroversial.
// ---------------------------------------------------------------------------

describe.skip('runner integration (see runner.integration.test.ts)', () => {
    // TODO(db): enqueue the same dedupeKey twice -> exactly one Job row exists,
    // the first call returns {deduped:false} and the second {deduped:true} with
    // the *same* jobId, and neither call throws.
    test('duplicate dedupeKey returns deduped:true and creates one row', () => {});

    // TODO(db): run two claimJobs() calls concurrently against a single due job
    // and assert the union of returned ids has no duplicate — only one caller
    // may observe count===1 from the conditional updateMany.
    test('two concurrent claims never return the same job', () => {});

    // TODO(db): claim ordering — insert jobs with priorities 200/100/100 and
    // staggered runAt, assert claimJobs returns them ordered by (priority,runAt)
    // and that a job with runAt in the future is not claimed at all.
    test('claim respects priority then runAt and skips future runAt', () => {});

    // TODO(db): register a throwing handler, drain once, then assert the row is
    // status=pending, attempts=1, runAt ~= now+2min, lastError set, lockedAt null.
    test('a throwing handler increments attempts and reschedules with backoff', () => {});

    // TODO(db): drain a job with maxAttempts=1 that throws; assert status=dead,
    // finishedAt set, and that the row still exists (never silently dropped).
    test('maxAttempts exhausted transitions to dead', () => {});

    // TODO(db): insert a row with status=running and lockedAt = now-11min, call
    // recoverStuckJobs, assert it returns 1 and the row is pending with
    // attempts incremented; repeat with lockedAt = now-9min and assert 0.
    test('a job locked 11 minutes ago is reclaimed; 9 minutes is not', () => {});

    // TODO(db): seed more due jobs than fit in the budget with a slow handler;
    // assert drain returns before budgetMs + one job duration, that
    // budgetExhausted is true, and workRemaining is true.
    test('drain respects the time budget and returns before it', () => {});

    // TODO(db): drain a successful noop; assert status=succeeded, durationMs>0,
    // result JSON round-tripped, lockedAt/lockedBy cleared, lastError null.
    test('a successful job records duration and result', () => {});

    // TODO(db): drain a noop with fanOut=3; assert three child rows exist with
    // distinct dedupeKeys and that a second drain of the same parent is a no-op.
    test('fan-out creates child jobs idempotently', () => {});
});
