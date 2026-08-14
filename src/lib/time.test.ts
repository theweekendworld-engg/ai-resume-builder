import { describe, expect, test } from 'bun:test';
import {
    describeNextDigest,
    isDigestDue,
    isValidTimeZone,
    localDayFor,
    localHourFor,
    offsetMinutes,
    safeTimeZone,
    weekStartFor,
    zonedParts,
} from './time';

const KOLKATA = 'Asia/Kolkata'; // +05:30, no DST — catches integer-hour assumptions
const NEW_YORK = 'America/New_York'; // DST transitions
const UTC = 'Etc/UTC';

describe('timezone validation', () => {
    test('accepts real zones and rejects nonsense', () => {
        expect(isValidTimeZone(KOLKATA)).toBe(true);
        expect(isValidTimeZone('Not/AZone')).toBe(false);
    });

    test('falls back to UTC rather than throwing — a bad tz must not stop a send', () => {
        expect(safeTimeZone('Not/AZone')).toBe(UTC);
        expect(safeTimeZone('')).toBe(UTC);
        expect(safeTimeZone(null)).toBe(UTC);
        expect(safeTimeZone(KOLKATA)).toBe(KOLKATA);
    });
});

describe('zonedParts', () => {
    test('reads wall-clock parts in the target zone', () => {
        // 2026-08-01T10:15Z is a Saturday.
        const now = new Date('2026-08-01T10:15:00Z');
        expect(zonedParts(now, UTC)).toMatchObject({ hour: 10, minute: 15, weekday: 6 });
        // +05:30 → 15:45 local, still Saturday.
        expect(zonedParts(now, KOLKATA)).toMatchObject({ hour: 15, minute: 45, weekday: 6 });
    });

    test('midnight reports hour 0, not 24', () => {
        expect(zonedParts(new Date('2026-08-01T00:00:00Z'), UTC).hour).toBe(0);
    });

    test('crossing midnight also rolls the weekday', () => {
        // 22:00Z Saturday is 03:30 Sunday in Kolkata.
        const p = zonedParts(new Date('2026-08-01T22:00:00Z'), KOLKATA);
        expect(p.hour).toBe(3);
        expect(p.minute).toBe(30);
        expect(p.weekday).toBe(7);
    });
});

describe('offsetMinutes', () => {
    test('handles a half-hour offset', () => {
        expect(offsetMinutes(new Date('2026-08-01T10:00:00Z'), KOLKATA)).toBe(330);
    });

    test('tracks DST rather than assuming a fixed offset', () => {
        // EDT in August, EST in January.
        expect(offsetMinutes(new Date('2026-08-01T12:00:00Z'), NEW_YORK)).toBe(-240);
        expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), NEW_YORK)).toBe(-300);
    });

    test('UTC is zero', () => {
        expect(offsetMinutes(new Date('2026-08-01T12:00:00Z'), UTC)).toBe(0);
    });
});

describe('weekStartFor', () => {
    test('resolves to Monday 00:00 local in every zone tested', () => {
        const now = new Date('2026-08-01T10:15:00Z'); // Saturday
        for (const tz of [UTC, KOLKATA, NEW_YORK]) {
            const start = weekStartFor(tz, now);
            const p = zonedParts(start, tz);
            expect(p.weekday).toBe(1);
            expect(p.hour).toBe(0);
            expect(p.minute).toBe(0);
        }
    });

    test('a +05:30 zone does not land on a whole UTC hour', () => {
        // Monday 00:00 IST is the previous Sunday 18:30 UTC. Naive date maths
        // produces a whole hour here and is wrong.
        const start = weekStartFor(KOLKATA, new Date('2026-08-01T10:15:00Z'));
        expect(start.toISOString()).toBe('2026-07-26T18:30:00.000Z');
    });

    test('is stable for every instant within the same local week', () => {
        const monday = weekStartFor(KOLKATA, new Date('2026-07-27T00:00:00Z'));
        const midweek = weekStartFor(KOLKATA, new Date('2026-07-29T13:00:00Z'));
        const sunday = weekStartFor(KOLKATA, new Date('2026-08-01T18:00:00Z'));
        expect(midweek.getTime()).toBe(monday.getTime());
        expect(sunday.getTime()).toBe(monday.getTime());
    });

    test('advances by exactly one week across a boundary', () => {
        const a = weekStartFor(UTC, new Date('2026-07-26T23:59:00Z')); // Sunday
        const b = weekStartFor(UTC, new Date('2026-07-27T00:01:00Z')); // Monday
        expect(b.getTime() - a.getTime()).toBe(7 * 86_400_000);
    });

    test('still lands on local Monday midnight across a DST transition', () => {
        // US DST starts Sunday 2026-03-08; this week contains the shift.
        const start = weekStartFor(NEW_YORK, new Date('2026-03-10T12:00:00Z'));
        const p = zonedParts(start, NEW_YORK);
        expect(p.weekday).toBe(1);
        expect(p.hour).toBe(0);
    });

    test('an invalid zone degrades to UTC instead of throwing', () => {
        const start = weekStartFor('Not/AZone', new Date('2026-08-01T10:15:00Z'));
        expect(start.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    });
});

describe('localHourFor / localDayFor', () => {
    test('agree with zonedParts', () => {
        const now = new Date('2026-08-01T10:15:00Z');
        expect(localHourFor(KOLKATA, now)).toBe(15);
        expect(localDayFor(KOLKATA, now)).toBe(6);
    });
});

describe('isDigestDue', () => {
    const prefs = { timezone: KOLKATA, digestDay: 5, digestHour: 16 }; // Friday 16:00 IST

    test('fires in the configured local slot', () => {
        // Friday 16:30 IST = 11:00Z.
        expect(isDigestDue(prefs, new Date('2026-07-31T11:00:00Z'))).toBe(true);
    });

    test('does not fire an hour early or late', () => {
        expect(isDigestDue(prefs, new Date('2026-07-31T10:00:00Z'))).toBe(false);
        expect(isDigestDue(prefs, new Date('2026-07-31T12:00:00Z'))).toBe(false);
    });

    test('does not fire on the wrong day', () => {
        expect(isDigestDue(prefs, new Date('2026-07-30T11:00:00Z'))).toBe(false);
    });

    test('the same UTC instant is due for one zone and not another', () => {
        // This is the whole point of deriving rather than storing a timestamp.
        const instant = new Date('2026-07-31T11:00:00Z');
        expect(isDigestDue({ timezone: KOLKATA, digestDay: 5, digestHour: 16 }, instant)).toBe(true);
        expect(isDigestDue({ timezone: UTC, digestDay: 5, digestHour: 16 }, instant)).toBe(false);
    });
});

describe('describeNextDigest', () => {
    test('names the upcoming slot', () => {
        const out = describeNextDigest(
            { timezone: UTC, digestDay: 5, digestHour: 16 },
            new Date('2026-07-29T09:00:00Z'), // Wednesday
        );
        expect(out).toContain('Friday');
        expect(out).toContain('4:00 PM');
    });

    test('rolls to next week once the slot has passed today', () => {
        const out = describeNextDigest(
            { timezone: UTC, digestDay: 5, digestHour: 16 },
            new Date('2026-07-31T17:00:00Z'), // Friday, after the hour
        );
        expect(out).toContain('Aug 7');
    });

    test('renders midnight as 12:00 AM, not 0:00', () => {
        const out = describeNextDigest(
            { timezone: UTC, digestDay: 1, digestHour: 0 },
            new Date('2026-07-29T09:00:00Z'),
        );
        expect(out).toContain('12:00 AM');
    });
});
