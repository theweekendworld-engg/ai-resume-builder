/** The consolidation week. Pure: the scheduler imports it with no database. */

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week `date` falls in, as yyyy-mm-dd. */
export function weekKeyFor(date: Date = new Date()): string {
    const day = date.getUTCDay();
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((day + 6) % 7)));
    return monday.toISOString().slice(0, 10);
}

/** "Changed in the last 7 days" starts here. */
export function consolidationWindowStart(now: Date = new Date()): Date {
    return new Date(now.getTime() - 7 * DAY_MS);
}
