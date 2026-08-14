/**
 * Timezone-aware scheduling helpers (impl/00 ADR-3).
 *
 * The weekly digest fires at each user's local time. Rather than storing a
 * "next run at" that drifts and double-fires on retry, the hourly tick DERIVES
 * who is due: for each user, is it their configured day and hour right now, in
 * their timezone. Idempotency then comes from the unique constraints, not from
 * bookkeeping.
 *
 * `Intl` only — no date library. Every function takes an explicit `now` so
 * tests are deterministic.
 */

/** ISO weekday, 1 = Monday … 7 = Sunday. Matches EmailPreference.digestDay. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ISO_DAY_BY_NAME: Record<string, IsoWeekday> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export const UTC = 'Etc/UTC';

/** Falls back to UTC rather than throwing — a bad tz must not stop a send. */
export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export function safeTimeZone(tz: string | null | undefined): string {
    const candidate = (tz ?? '').trim();
    if (!candidate || !isValidTimeZone(candidate)) return UTC;
    return candidate;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: IsoWeekday };

/**
 * Wall-clock parts in a given zone. This is the primitive everything else uses;
 * it is the only place that touches Intl.
 */
export function zonedParts(now: Date, tz: string): Parts {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: safeTimeZone(tz),
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
        hour12: false,
    });

    const out: Record<string, string> = {};
    for (const part of fmt.formatToParts(now)) {
        if (part.type !== 'literal') out[part.type] = part.value;
    }

    return {
        year: Number(out.year),
        month: Number(out.month),
        day: Number(out.day),
        // Intl emits "24" for midnight under hour12:false in some engines.
        hour: Number(out.hour) % 24,
        minute: Number(out.minute),
        weekday: ISO_DAY_BY_NAME[out.weekday] ?? 1,
    };
}

export function localHourFor(tz: string, now: Date = new Date()): number {
    return zonedParts(now, tz).hour;
}

export function localDayFor(tz: string, now: Date = new Date()): IsoWeekday {
    return zonedParts(now, tz).weekday;
}

/** Offset of `tz` from UTC, in minutes, at `now`. Handles DST because it is sampled. */
export function offsetMinutes(now: Date, tz: string): number {
    const p = zonedParts(now, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    // Zero the seconds on the reference so the difference is whole minutes.
    const actual = Math.floor(now.getTime() / 60_000) * 60_000;
    return Math.round((asUtc - actual) / 60_000);
}

/**
 * Monday 00:00 local, returned as the equivalent UTC instant — the value stored
 * in `WeeklyDigest.weekStart`, whose unique constraint makes a double-fired
 * cron a no-op.
 *
 * Computed by subtracting the local offset rather than by naive date maths, so
 * a +05:30 zone and a DST transition both land correctly.
 */
export function weekStartFor(tz: string, now: Date = new Date()): Date {
    const zone = safeTimeZone(tz);
    const p = zonedParts(now, zone);
    const daysSinceMonday = p.weekday - 1;

    // Midnight on the local Monday, expressed as if those wall-clock parts were UTC.
    const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day) - daysSinceMonday * 86_400_000;

    // Convert that wall-clock instant to a real one using the offset in effect then.
    const provisional = new Date(localMidnightAsUtc);
    const offset = offsetMinutes(provisional, zone);
    return new Date(localMidnightAsUtc - offset * 60_000);
}

/** True when `now` falls in the user's configured digest slot. */
export function isDigestDue(
    prefs: { timezone: string; digestDay: number; digestHour: number },
    now: Date = new Date(),
): boolean {
    const p = zonedParts(now, prefs.timezone);
    return p.weekday === prefs.digestDay && p.hour === prefs.digestHour;
}

/** Human-readable next slot, for the settings preview line. */
export function describeNextDigest(
    prefs: { timezone: string; digestDay: number; digestHour: number },
    now: Date = new Date(),
): string {
    const zone = safeTimeZone(prefs.timezone);
    const p = zonedParts(now, zone);

    let daysAhead = (prefs.digestDay - p.weekday + 7) % 7;
    if (daysAhead === 0 && p.hour >= prefs.digestHour) daysAhead = 7;

    const target = new Date(now.getTime() + daysAhead * 86_400_000);
    const label = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, weekday: 'long', month: 'short', day: 'numeric',
    }).format(target);

    const hour12 = prefs.digestHour % 12 === 0 ? 12 : prefs.digestHour % 12;
    const meridiem = prefs.digestHour < 12 ? 'AM' : 'PM';
    return `${label} at ${hour12}:00 ${meridiem}`;
}
