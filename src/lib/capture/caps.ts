/**
 * Volume, budget and threshold caps — PRD 02 §3.3, §4.3, §6.5.
 *
 * Every number the pipeline is allowed to be opinionated about lives here, in
 * one screen, because "why did I only get 5 wins?" must be answerable by
 * reading a file rather than grepping for a magic number.
 */

// ───────────────────────────────────────────────────── volume caps (§6.5)

/** Drafts surfaced per weekly digest. The rest land in "Needs review". */
export const WEEKLY_DRAFT_CAP = 5;

/** Drafts produced by the initial 90-day backfill. The wow moment, not a flood. */
export const BACKFILL_DRAFT_CAP = 40;

/** Hard stop on model calls in a single run. Exceeding it marks the run degraded. */
export const MODEL_CALLS_PER_RUN = 60;

/** Provider requests per sync (§3.3). Authenticated GitHub allows 5,000/hr. */
export const MAX_REQUESTS_PER_SYNC = 60;

// ───────────────────────────────────────────────────── windows (§3.3, §9)

/** Initial backfill window, by entitlement. Free is 30 days (§9). */
export const BACKFILL_DAYS_FREE = 30;
export const BACKFILL_DAYS_PAID = 90;

/** Manual refresh is rate-limited to one per hour (§3.3). */
export const MANUAL_SYNC_COOLDOWN_MS = 60 * 60_000;

/**
 * A PR open longer than this gets the "started in April, landed in July" date
 * prompt (§11) rather than silently claiming the merge date.
 */
export const LONG_LIVED_PR_DAYS = 60;

// ───────────────────────────────────────────────────── confidence (§4.3)

/** Below this we do not draft at all. */
export const MIN_DRAFT_CONFIDENCE = 0.2;

/** Below this we draft but keep it out of the digest ("Needs review" only). */
export const DIGEST_SURFACE_CONFIDENCE = 0.35;

// ───────────────────────────────────────────────────── health (§7.3)

/** Consecutive failures before the source auto-pauses and we stop retrying. */
export const AUTO_PAUSE_AFTER_FAILURES = 5;

/** Consecutive failures before we email. Not the first — transients are common. */
export const NOTIFY_AFTER_FAILURES = 2;

/** Cached raw signal rows are deleted this long after a disconnect (§7.2). */
export const SIGNAL_RETENTION_AFTER_DISCONNECT_HOURS = 24;
