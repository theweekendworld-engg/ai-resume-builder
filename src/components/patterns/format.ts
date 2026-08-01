const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `MMM D` within the current year, `MMM D, YYYY` otherwise — the date format
 * for Wins, quota resets, and anything else dated in the app.
 *
 * Formatted in UTC deliberately: a locale-dependent format would produce
 * different server and client output and trip hydration.
 */
export function formatWinDate(input: Date | string, now: Date = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return year === now.getUTCFullYear() ? `${month} ${day}` : `${month} ${day}, ${year}`;
}
