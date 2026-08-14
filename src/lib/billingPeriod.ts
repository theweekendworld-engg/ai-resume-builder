/**
 * The calendar month, in UTC.
 *
 * This lived in `usageTracker.ts`, which made `entitlements.ts` import the
 * usage tracker for a date calculation — and that one import is what stopped
 * the tracker from ever asking about a user's plan. A per-tier token budget
 * needs exactly that, so the date helper moves out rather than the budget
 * check working around it with a dynamic import.
 *
 * Re-exported from `usageTracker` so existing callers keep working.
 */
export function getCurrentBillingPeriod(now = new Date()): { start: Date; end: Date } {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return { start, end };
}
