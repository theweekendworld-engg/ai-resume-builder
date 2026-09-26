/**
 * `weekly_digest` — the ritual (PRD 01 §5.2, design/02 §K1).
 *
 * Two modes in one handler, distinguished by the payload, exactly like
 * `capture_sync`:
 *
 *   `{}`                       dispatch: one child per user who is due right now
 *   `{ userId, weekStart }`    compose and send one digest
 *
 * ── Scheduling is DERIVED (ADR-3) ─────────────────────────────────────────
 * Nothing stores a next-run. The hourly tick asks `isDigestDue` whether this is
 * the user's configured local slot. Idempotency then comes from two independent
 * database constraints — `Job.dedupeKey` on the child enqueue and
 * `WeeklyDigest @@unique([userId, weekStart])` on the send — so a double-fired
 * cron produces exactly one digest without any bookkeeping to get wrong.
 *
 * ── Handlers must be idempotent ───────────────────────────────────────────
 * The runner's deadline is soft: a handler that overruns is abandoned and
 * retried, so a retry can overlap a run that is still in flight. Every write
 * below is therefore either conditional or keyed. The single non-idempotent
 * step is the provider call itself, which is why `sentAt` is checked before it
 * and set immediately after, and why `sendEmail` gets an `idempotencyKey`.
 *
 * ── Zero signals means no email ───────────────────────────────────────────
 * PRD 01 §5.2 is explicit that "nothing this week" is the fastest path to an
 * unsubscribe. An empty week writes a `skipped` row and sends nothing; the
 * three-empty-week nudge is a different template with a different job.
 */

import { z } from 'zod';
import { Channel, Prisma, WinStatus, type Win } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isEnabled } from '@/lib/flags';
import { track } from '@/lib/track';
import { buildDedupeKey, enqueue } from '@/lib/jobs/runner';
import type { EnqueueFn, JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { isDigestDue, safeTimeZone, weekStartFor, type IsoWeekday } from '@/lib/time';
import { selectDigestDrafts } from '@/lib/capture/draftRun';
import { sendEmail, getAppUrl } from '@/lib/email/send';
import { inboxCounts, topFits } from '@/services/careerInbox';
import type { JobBoardItem } from '@/lib/inbox/types';
import type { FitVerdict } from '@/lib/scout/types';
import {
    MAX_DIGEST_BEST_FITS,
    type DigestBestFits,
    digestFooterSummary,
    digestInlineKeyboard,
    digestSubject,
    parseDigestCallbackData,
    renderTelegramDigest,
    toTelegramView,
    type DigestWinItem,
    type TelegramDigestItem,
    type WeeklyDigestData,
} from '@/lib/email/templates/weeklyDigest';
import {
    applyDigestAction,
    buildActionUrl,
    createDigestRoot,
    mintWinToken,
    resolveDigestTarget,
    tokensConfigured,
} from '@/lib/winTokens';
import { editTelegramMessageText, sendTelegramMessage } from '@/lib/telegram';
import { describeEvidence, EVIDENCE_KIND_BY_SOURCE } from '@/services/winGraph';
import * as winGraph from '@/services/winGraph';

export const WEEKLY_DIGEST_JOB_KIND = 'weekly_digest' as const;
export const CAPTURE_SYNC_JOB_KIND = 'capture_sync' as const;

// ---------------------------------------------------------------------------
// Guardrails — PRD 01 §5.2
// ---------------------------------------------------------------------------

/** "Never more than one digest per 6 days." */
export const MIN_DIGEST_GAP_DAYS = 6;

/** Consecutive unopened, un-actioned digests before the cadence drops. */
export const UNOPENED_BEFORE_DEGRADE = 4;

/**
 * Biweekly gap. 13 rather than 14 so the send fires at the same local hour a
 * fortnight later instead of slipping an hour past it and waiting another week.
 */
export const BIWEEKLY_GAP_DAYS = 13;

/** Empty weeks before the nudge, then the counter restarts. */
export const EMPTY_WEEKS_BEFORE_NUDGE = 3;

/** "up to 5 drafted Wins from the past 7 days". */
export const DIGEST_WINDOW_DAYS = 7;

/** How many prior digests the guardrails need to see. */
const HISTORY_DEPTH = 8;

/** Fan-out ceiling for one dispatch. */
const DEFAULT_DISPATCH_LIMIT = 2_000;

/** Drafts pulled before `selectDigestDrafts` makes the top-5 cut. */
const DRAFT_SCAN_LIMIT = 60;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const PayloadSchema = z.object({
    userId: z.string().min(1).max(64).optional(),
    weekStart: z.coerce.date().optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
});

export type WeeklyDigestPayload = z.infer<typeof PayloadSchema>;

/** `weekly_digest:<userId>:<weekStart>` — the first of the two idempotency layers. */
export function digestDedupeKey(userId: string, weekStart: Date): string {
    return buildDedupeKey(WEEKLY_DIGEST_JOB_KIND, [userId, weekStart.toISOString()]);
}

// ---------------------------------------------------------------------------
// Pure — who might be due
// ---------------------------------------------------------------------------

/**
 * ISO weekdays worth loading for this instant. Timezone offsets span roughly
 * −12h to +14h, so the local day at any moment is yesterday, today or tomorrow
 * in UTC — never anything else. Narrowing to three of seven days lets the query
 * use the `[weeklyDigest, digestDay, digestHour]` index instead of scanning.
 */
export function candidateDigestDays(now: Date): IsoWeekday[] {
    const utcIso = ((now.getUTCDay() + 6) % 7) + 1; // 1 = Mon … 7 = Sun
    const shift = (delta: number): IsoWeekday => (((utcIso - 1 + delta + 7) % 7) + 1) as IsoWeekday;
    return [shift(-1), shift(0), shift(1)];
}

// ---------------------------------------------------------------------------
// Cron wiring — what the hourly tick enqueues before it drains
// ---------------------------------------------------------------------------

/**
 * How far ahead of a digest we pull fresh signals. Two hours is enough for a
 * `capture_sync` fan-out plus its `draft_wins` children to finish and be slow
 * about it, so the drafts exist by the time the digest is composed.
 */
export const PRE_DIGEST_SYNC_LEAD_MS = 2 * 3_600_000;

/** `2026-08-01T14` — hour-granular, which is the tick's own cadence. */
export function hourKey(now: Date): string {
    return now.toISOString().slice(0, 13);
}

export function digestDispatchDedupeKey(now: Date): string {
    return buildDedupeKey(WEEKLY_DIGEST_JOB_KIND, ['dispatch', hourKey(now)]);
}

export function preDigestSyncDedupeKey(now: Date): string {
    return buildDedupeKey(CAPTURE_SYNC_JOB_KIND, ['predigest', hourKey(now)]);
}

/** True when at least one user's digest slot lands on `at`. One indexed query. */
export async function anyDigestDueAt(at: Date, limit = DEFAULT_DISPATCH_LIMIT): Promise<boolean> {
    const candidates = await prisma.emailPreference.findMany({
        where: {
            weeklyDigest: true,
            unsubscribedAll: false,
            digestDay: { in: candidateDigestDays(at) },
        },
        take: limit,
        select: { timezone: true, digestDay: true, digestHour: true },
    });
    return candidates.some((prefs) => isDigestDue(prefs, at));
}

export type ScheduleDigestWorkResult = {
    digestDispatchJobId: string;
    digestDispatchDeduped: boolean;
    preDigestSyncJobId: string | null;
};

/**
 * Called by `/api/cron/tick` at the top of every tick, before the drain, so the
 * jobs it enqueues are drained by the same invocation.
 *
 * Both enqueues carry an hour-granular `dedupeKey`: a cron that fires twice in
 * the same hour — Vercel retrying, an external pinger overlapping, a
 * self-retrigger chain — inserts one job, not two. This is the first of the two
 * layers that make a double-fired cron send exactly one digest.
 */
export async function scheduleDigestWork(
    now: Date = new Date(),
    enqueueFn: EnqueueFn = enqueue,
): Promise<ScheduleDigestWorkResult> {
    const dispatch = await enqueueFn(
        WEEKLY_DIGEST_JOB_KIND,
        {},
        { dedupeKey: digestDispatchDedupeKey(now), priority: 70 },
    );

    // Pre-digest sync (PRD 02 wiring): only when someone is actually due in two
    // hours, so a quiet hour costs one indexed read and nothing else.
    let preDigestSyncJobId: string | null = null;
    try {
        if (await anyDigestDueAt(new Date(now.getTime() + PRE_DIGEST_SYNC_LEAD_MS))) {
            const sync = await enqueueFn(
                CAPTURE_SYNC_JOB_KIND,
                {},
                { dedupeKey: preDigestSyncDedupeKey(now), priority: 85 },
            );
            preDigestSyncJobId = sync.jobId;
        }
    } catch (error: unknown) {
        // A missed pre-sync degrades the digest to yesterday's drafts. It must
        // never take the tick — and with it the whole queue — down.
        console.error('[weekly_digest] pre-digest sync scheduling failed', error);
    }

    return {
        digestDispatchJobId: dispatch.jobId,
        digestDispatchDeduped: dispatch.deduped,
        preDigestSyncJobId,
    };
}

// ---------------------------------------------------------------------------
// Pure — guardrails over digest history
// ---------------------------------------------------------------------------

export type DigestHistoryRow = {
    weekStart: Date;
    sentAt: Date | null;
    openedAt: Date | null;
    firstActionAt: Date | null;
    skipped: boolean;
};

/** An email that was neither opened nor acted on. Either one counts as engagement. */
export function isUnopened(row: DigestHistoryRow): boolean {
    return row.sentAt !== null && row.openedAt === null && row.firstActionAt === null;
}

/**
 * Consecutive unopened digests, newest first. Skipped weeks are transparent:
 * they sent nothing, so they can neither prove nor break engagement.
 */
export function unopenedStreak(history: readonly DigestHistoryRow[]): number {
    let streak = 0;
    for (const row of history) {
        if (row.sentAt === null) continue;
        if (!isUnopened(row)) break;
        streak += 1;
    }
    return streak;
}

/**
 * PRD 01 §5.2 — "if a user hasn't opened 4 consecutive digests, drop to
 * biweekly automatically and tell them. Auto-degrade beats unsubscribe."
 *
 * Derived, not stored, for the same reason the schedule is (ADR-3): the moment
 * the user opens one, the streak breaks and they are back to weekly with no
 * state to reset.
 */
export function shouldDegradeToBiweekly(history: readonly DigestHistoryRow[]): boolean {
    return unopenedStreak(history) >= UNOPENED_BEFORE_DEGRADE;
}

/**
 * Consecutive empty weeks including this one, counting back only as far as the
 * last nudge we sent — a nudge resets the counter, which is what turns "every
 * 3 empty weeks" into a cadence rather than a weekly nag.
 *
 * A `skipped` row with `sentAt` set is a nudge; `skipped` with no `sentAt` is a
 * silent empty week.
 */
export function quietWeekCount(history: readonly DigestHistoryRow[]): number {
    let count = 1; // the week being processed right now
    for (const row of history) {
        if (!row.skipped) break;
        if (row.sentAt !== null) break; // that week's nudge already covered the run
        count += 1;
    }
    return count;
}

export function nudgeIsDue(history: readonly DigestHistoryRow[]): boolean {
    return quietWeekCount(history) >= EMPTY_WEEKS_BEFORE_NUDGE;
}

export type FrequencyDecision =
    | { send: true; cadenceNote?: string }
    | { send: false; reason: 'too_soon' | 'biweekly_pause' };

/**
 * The frequency guardrails, as one pure function so both the hard floor and the
 * auto-degrade are visible in one place and testable without a database.
 */
export function decideFrequency(
    history: readonly DigestHistoryRow[],
    now: Date,
): FrequencyDecision {
    const lastSent = history.find((row) => row.sentAt !== null)?.sentAt ?? null;
    const degraded = shouldDegradeToBiweekly(history);

    if (lastSent) {
        const elapsedDays = (now.getTime() - lastSent.getTime()) / DAY_MS;
        if (elapsedDays < MIN_DIGEST_GAP_DAYS) return { send: false, reason: 'too_soon' };
        if (degraded && elapsedDays < BIWEEKLY_GAP_DAYS) return { send: false, reason: 'biweekly_pause' };
    }

    return degraded
        ? {
              send: true,
              cadenceNote:
                  "You haven't opened the last few of these, so we'll check in every other week instead. Change it any time in settings.",
          }
        : { send: true };
}

// ---------------------------------------------------------------------------
// Pure — copy helpers
// ---------------------------------------------------------------------------

/** "Jul 25 – 31", collapsing the month when both ends share it. */
export function formatDateRange(weekStart: Date, weekEnd: Date, timeZone: string): string {
    const tz = safeTimeZone(timeZone);
    const month = (d: Date): string => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(d);
    const day = (d: Date): string => new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(d);
    return month(weekStart) === month(weekEnd)
        ? `${month(weekStart)} ${day(weekStart)} – ${day(weekEnd)}`
        : `${month(weekStart)} ${day(weekStart)} – ${month(weekEnd)} ${day(weekEnd)}`;
}

/** "Friday, Jul 31" — the preheader's second half. */
export function formatSendDate(now: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: safeTimeZone(timeZone),
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    }).format(now);
}

/**
 * "PR #482 · patronus/api". Reuses `describeEvidence` rather than re-parsing
 * source URLs, so the email and the log's `SourceChip` always say the same
 * thing about the same Win.
 */
export function describeWinProvenance(win: Pick<Win, 'source' | 'sourceRef'>): string | null {
    if (!win.sourceRef?.trim()) return null;
    const presented = describeEvidence({
        kind: EVIDENCE_KIND_BY_SOURCE[win.source],
        sourceRef: win.sourceRef,
    });
    if (presented.url === null && presented.detail === null) return null;
    return presented.detail ? `${presented.label} · ${presented.detail}` : presented.label;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const weeklyDigestHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(
            `weekly_digest: invalid payload — ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        );
    }

    const { userId, weekStart } = parsed.data;
    if (!userId) return dispatch(parsed.data.limit ?? DEFAULT_DISPATCH_LIMIT, ctx);
    if (!weekStart) throw new Error('weekly_digest: weekStart is required alongside userId');

    return sendOne({ userId, weekStart }, ctx);
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Fan-out, never a loop over the work itself (impl/00 §P-2). This function only
 * ever enqueues; one user's slow mailbox cannot take the invocation — and with
 * it everyone else's digest — down with it.
 */
async function dispatch(limit: number, ctx: JobContext): Promise<JobResultObject> {
    const now = new Date();

    const candidates = await prisma.emailPreference.findMany({
        where: {
            weeklyDigest: true,
            unsubscribedAll: false,
            digestDay: { in: candidateDigestDays(now) },
        },
        orderBy: { userId: 'asc' },
        take: limit,
        select: { userId: true, timezone: true, digestDay: true, digestHour: true },
    });

    let due = 0;
    let enqueued = 0;
    let gated = 0;

    for (const prefs of candidates) {
        if (!isDigestDue(prefs, now)) continue;
        due += 1;

        // ADR-7: the ritual stays invisible until the flag is on for this user.
        if (!(await isEnabled(prefs.userId, 'weekly_digest'))) {
            gated += 1;
            continue;
        }

        const weekStart = weekStartFor(prefs.timezone, now);
        const result = await ctx.enqueue(
            WEEKLY_DIGEST_JOB_KIND,
            { userId: prefs.userId, weekStart: weekStart.toISOString() },
            {
                dedupeKey: digestDedupeKey(prefs.userId, weekStart),
                // Ahead of default work: a digest that slips an hour is a digest
                // that arrives on Friday evening instead of Friday afternoon.
                priority: 80,
            },
        );
        if (!result.deduped) enqueued += 1;
    }

    ctx.log('weekly digest dispatched', { candidates: candidates.length, due, enqueued, gated });
    return { mode: 'dispatch', candidates: candidates.length, due, enqueued, gated };
}

// ---------------------------------------------------------------------------
// Send one
// ---------------------------------------------------------------------------

type DigestRow = {
    id: string;
    token: string;
    sentAt: Date | null;
    channel: Channel;
};

async function sendOne(
    input: { userId: string; weekStart: Date },
    ctx: JobContext,
): Promise<JobResultObject> {
    const { userId, weekStart } = input;
    const now = new Date();

    const prefs = await prisma.emailPreference.findUnique({
        where: { userId },
        select: { timezone: true, weeklyDigest: true, unsubscribedAll: true, digestChannel: true },
    });
    if (!prefs) return { skipped: 'no_preferences' };
    if (!prefs.weeklyDigest || prefs.unsubscribedAll) return { skipped: 'opted_out' };

    // Idempotency layer 2. A retry that overlaps an abandoned run stops here.
    const existing = await prisma.weeklyDigest.findUnique({
        where: { userId_weekStart: { userId, weekStart } },
        select: { id: true, token: true, sentAt: true, channel: true },
    });
    if (existing?.sentAt) return { skipped: 'already_sent', digestId: existing.id };

    const history: DigestHistoryRow[] = await prisma.weeklyDigest.findMany({
        where: { userId, weekStart: { lt: weekStart } },
        orderBy: { weekStart: 'desc' },
        take: HISTORY_DEPTH,
        select: { weekStart: true, sentAt: true, openedAt: true, firstActionAt: true, skipped: true },
    });

    const frequency = decideFrequency(history, now);
    if (!frequency.send) return { skipped: frequency.reason };

    if (!tokensConfigured()) {
        // Every button in this email is a signed link. Sending it without the
        // secret would deliver a page of dead ends, which is worse than a miss.
        console.error('[weekly_digest] WIN_MAGIC_LINK_SECRET is not set; refusing to send');
        return { skipped: 'tokens_not_configured' };
    }

    const drafts = await prisma.win.findMany({
        where: {
            userId,
            status: WinStatus.draft,
            createdAt: { gte: new Date(now.getTime() - DIGEST_WINDOW_DAYS * DAY_MS) },
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        take: DRAFT_SCAN_LIMIT,
        select: {
            id: true,
            title: true,
            narrative: true,
            confidence: true,
            source: true,
            sourceRef: true,
        },
    });

    // C1 owns the top-5 cut. Calling it keeps "+N more in your log" honest.
    const { surfaced, overflow } = selectDigestDrafts(drafts);

    const channel = prefs.digestChannel === Channel.telegram ? Channel.telegram : Channel.email;
    const digest = existing ?? (await createDigestRow(userId, weekStart, channel));

    // ── Zero signals: no email, ever. PRD 01 §5.2.
    if (surfaced.length === 0) {
        await prisma.weeklyDigest.update({
            where: { id: digest.id },
            data: { skipped: true, winIds: [] },
        });

        if (!nudgeIsDue(history)) {
            ctx.log('digest skipped: no signals', { userId, quietWeeks: quietWeekCount(history) });
            return { skipped: 'no_signals', quietWeeks: quietWeekCount(history), digestId: digest.id };
        }
        return sendNudge({ userId, digest, quietWeeks: quietWeekCount(history), now }, ctx);
    }

    const data = await composeDigestData({
        userId,
        digest,
        wins: surfaced,
        overflow,
        weekStart,
        timezone: prefs.timezone,
        now,
        cadenceNote: frequency.cadenceNote,
    });

    // Claim the send BEFORE the provider call, with the conditional-update
    // idiom (`src/lib/entitlements.ts:226`). This is the third and last layer
    // that makes a double-fired cron send exactly one digest: `Job.dedupeKey`
    // stops two jobs, `@@unique([userId, weekStart])` stops two rows, and this
    // stops two provider calls when a retry overlaps an abandoned run.
    //
    // `winIds` is written here too, because the tokens in the email are only
    // in scope once the row lists them.
    const claim = await prisma.weeklyDigest.updateMany({
        where: { id: digest.id, sentAt: null },
        data: {
            sentAt: now,
            skipped: false,
            channel,
            winIds: data.wins.map((win) => win.winId),
        },
    });
    if (claim.count === 0) return { skipped: 'already_sent', digestId: digest.id };

    const delivered =
        channel === Channel.telegram
            ? await deliverTelegram({ userId, digest, data, ctx })
            : await deliverEmail({ userId, digest, data, ctx });

    if (!delivered.ok) {
        // Release the claim so the retry re-composes rather than recording a
        // week as sent that never arrived.
        await prisma.weeklyDigest.updateMany({
            where: { id: digest.id },
            data: { sentAt: null },
        });
        throw new Error(`weekly_digest: delivery failed (${delivered.reason})`);
    }

    if (delivered.channel !== channel) {
        // Telegram fell back to email.
        await prisma.weeklyDigest.update({
            where: { id: digest.id },
            data: { channel: delivered.channel },
        });
    }

    await track(userId, 'digest_sent', {
        feature: 'work_log',
        digestId: digest.id,
        channel: delivered.channel,
        winCount: data.wins.length,
        degraded: Boolean(frequency.cadenceNote),
    });

    ctx.log('digest sent', { userId, digestId: digest.id, channel: delivered.channel, wins: data.wins.length });
    return {
        digestId: digest.id,
        channel: delivered.channel,
        winCount: data.wins.length,
        overflow,
        degraded: Boolean(frequency.cadenceNote),
    };
}

/**
 * Create the row, or adopt the one a racing attempt just created. The unique
 * constraint is the arbiter; `P2002` here is a normal outcome, not an error.
 */
async function createDigestRow(userId: string, weekStart: Date, channel: Channel): Promise<DigestRow> {
    try {
        return await prisma.weeklyDigest.create({
            data: { userId, weekStart, channel, token: createDigestRoot(), winIds: [] },
            select: { id: true, token: true, sentAt: true, channel: true },
        });
    } catch (error: unknown) {
        const duplicate =
            error instanceof Prisma.PrismaClientKnownRequestError
                ? error.code === 'P2002'
                : typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
        if (!duplicate) throw error;

        const row = await prisma.weeklyDigest.findUnique({
            where: { userId_weekStart: { userId, weekStart } },
            select: { id: true, token: true, sentAt: true, channel: true },
        });
        if (!row) throw error;
        return row;
    }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

// ── Best fits this week (career inbox) ──────────────────────────────────────
//
// ENRICH-ONLY. This block is composed inside `composeDigestData`, which runs
// only after the zero-signal check has already decided a digest is going out.
// A week with no Win drafts but three great jobs still sends NOTHING: the
// digest is the Work Log ritual, the notification budget is three messages a
// week (`src/lib/notifications/budget.ts`), and a jobs-only email would spend
// one of them on something the user can already see in Telegram and the
// inbox. The block rides along; it never buys a send of its own.
//
// No model call: every word is a stored field, so the numeric guard has
// nothing to check and nothing to trip.

export type InboxReader = {
    topFits: (userId: string, opts: { sinceDays: number; limit: number }) => Promise<JobBoardItem[]>;
    toReview: (userId: string) => Promise<number>;
};

const defaultInboxReader: InboxReader = {
    topFits: (userId, opts) => topFits(userId, opts),
    toReview: async (userId) => (await inboxCounts(userId)).toReview,
};

let inboxReader: InboxReader = defaultInboxReader;

export const __testing = {
    setInboxReader(next: InboxReader | null) {
        inboxReader = next ?? defaultInboxReader;
    },
};

const VERDICT_LABEL: Record<FitVerdict, string | null> = {
    strong: 'Strong fit',
    possible: 'Possible fit',
    stretch: 'Stretch',
    not_a_fit: 'Not a fit',
    unknown: null,
};

function cityOf(location: string | null): string | null {
    const city = location?.split(',')[0]?.trim();
    return city ? city : null;
}

/**
 * The block, or undefined. Never throws: a failure here must cost the user a
 * paragraph, not their digest.
 */
export async function composeBestFits(userId: string, appUrl: string): Promise<DigestBestFits | undefined> {
    try {
        if (!(await isEnabled(userId, 'scout'))) return undefined;
        const items = await inboxReader.topFits(userId, { sinceDays: DIGEST_WINDOW_DAYS, limit: MAX_DIGEST_BEST_FITS });
        if (items.length === 0) return undefined;
        const waiting = await inboxReader.toReview(userId).catch(() => items.length);
        return {
            items: items.slice(0, MAX_DIGEST_BEST_FITS).map((item) => ({
                role: item.role?.trim() || 'Role',
                company: item.company?.trim() || null,
                verdictLabel: item.verdict ? VERDICT_LABEL[item.verdict] : null,
                score: item.fitScore,
                city: cityOf(item.location),
                url: item.runId ? `${appUrl}/scout/${item.runId}` : `${appUrl}/scout`,
            })),
            waiting,
            inboxUrl: `${appUrl}/scout`,
        };
    } catch (error: unknown) {
        console.warn('[weekly_digest] best fits skipped', { userId, error: error instanceof Error ? error.message : String(error) });
        return undefined;
    }
}

type DraftRow = Pick<Win, 'id' | 'title' | 'narrative' | 'source' | 'sourceRef'> & { confidence: number };

async function composeDigestData(input: {
    userId: string;
    digest: DigestRow;
    wins: DraftRow[];
    overflow: number;
    weekStart: Date;
    timezone: string;
    now: Date;
    cadenceNote?: string;
}): Promise<WeeklyDigestData> {
    const appUrl = getAppUrl();
    const weekEnd = new Date(input.weekStart.getTime() + 6 * DAY_MS);

    const summary = await winGraph.getLogSummary({ userId: input.userId, now: input.now });

    const items: DigestWinItem[] = [];
    for (const win of input.wins) {
        const confirm = mintWinToken({ root: input.digest.token, winId: win.id, action: 'confirm' });
        const edit = mintWinToken({ root: input.digest.token, winId: win.id, action: 'edit' });
        const dismiss = mintWinToken({ root: input.digest.token, winId: win.id, action: 'dismiss' });
        // `tokensConfigured()` was checked before we got here, so a null mint
        // means a malformed id — drop the item rather than ship a dead button.
        if (!confirm || !edit || !dismiss) continue;

        items.push({
            winId: win.id,
            title: win.title,
            narrative: win.narrative,
            provenance: describeWinProvenance(win),
            confirmUrl: buildActionUrl(confirm, appUrl),
            editUrl: buildActionUrl(edit, appUrl),
            dismissUrl: buildActionUrl(dismiss, appUrl),
        });
    }

    const bestFits = await composeBestFits(input.userId, appUrl);

    return {
        dateRange: formatDateRange(input.weekStart, weekEnd, input.timezone),
        sendDateLabel: formatSendDate(input.now, input.timezone),
        wins: items,
        overflow: input.overflow,
        addWinUrl: `${appUrl}/log?compose=1&src=digest`,
        logUrl: `${appUrl}/log`,
        totalConfirmed: summary.success ? summary.data.totalConfirmed : 0,
        streakWeeks: summary.success ? summary.data.streakWeeks : 0,
        cadenceNote: input.cadenceNote,
        ...(bestFits ? { bestFits } : {}),
    };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

type DeliveryResult = { ok: true; channel: Channel } | { ok: false; reason: string };

async function deliverEmail(input: {
    userId: string;
    digest: DigestRow;
    data: WeeklyDigestData;
    ctx: JobContext;
}): Promise<DeliveryResult> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId: input.userId },
        select: { email: true },
    });
    const to = profile?.email?.trim();
    if (!to) return { ok: false, reason: 'no_email_on_profile' };

    const result = await sendEmail({
        userId: input.userId,
        to,
        template: 'weekly_digest',
        data: input.data,
        // Keyed to the digest row, so a retried job cannot double-send.
        idempotencyKey: `weekly_digest:${input.digest.id}`,
    });

    if (result.status === 'sent') return { ok: true, channel: Channel.email };
    if (result.status === 'skipped') {
        // A preference change between dispatch and send. Not a failure; do not
        // retry it, and do not mark the week as sent.
        input.ctx.log('digest suppressed by preferences', { reason: result.reason });
        return { ok: false, reason: `suppressed:${result.reason}` };
    }
    return { ok: false, reason: result.error };
}

/**
 * PRD 01 §5.2: the Telegram variant confirms in-chat with zero navigation, and
 * is the better UX. The buttons carry `d:<action><index>:<digestId>` rather than
 * a signed token — Telegram caps `callback_data` at 64 bytes, and a credential
 * in a chat payload is worse than a lookup anyway.
 */
async function deliverTelegram(input: {
    userId: string;
    digest: DigestRow;
    data: WeeklyDigestData;
    ctx: JobContext;
}): Promise<DeliveryResult> {
    const identity = await prisma.channelIdentity.findFirst({
        where: { userId: input.userId, channel: Channel.telegram, verified: true },
        select: { externalId: true },
    });

    if (!identity) {
        input.ctx.log('telegram not linked; falling back to email');
        return deliverEmail(input);
    }

    const view = toTelegramView(input.data);
    try {
        await sendTelegramMessage({
            chatId: identity.externalId,
            text: renderTelegramDigest(view),
            replyMarkup: digestInlineKeyboard(view, input.digest.id),
        });
        return { ok: true, channel: Channel.telegram };
    } catch (error: unknown) {
        return { ok: false, reason: error instanceof Error ? error.message : 'telegram send failed' };
    }
}

// ---------------------------------------------------------------------------
// Telegram callbacks — the other half of `deliverTelegram`
// ---------------------------------------------------------------------------

export type DigestCallbackResult =
    | { handled: false }
    | { handled: true; outcome: 'applied' | 'already_done' | 'undone' | 'ignored' | 'failed'; notice: string };

/**
 * Handle one `d:<action><index>:<digestId>` inline-keyboard tap and edit the
 * message in place (PRD 01 §5.2 — "confirm happens in-chat with zero
 * navigation. This is the better UX").
 *
 * Authorisation is the verified `ChannelIdentity` for this chat, checked here
 * and re-checked against the digest's owner inside `resolveDigestTarget`. A
 * callback naming someone else's digest resolves to nothing.
 */
export async function handleDigestCallback(input: {
    data: string | undefined;
    chatId: string;
    messageId?: number;
}): Promise<DigestCallbackResult> {
    const parsed = parseDigestCallbackData(input.data);
    if (!parsed) return { handled: false };

    const identity = await prisma.channelIdentity.findUnique({
        where: { channel_externalId: { channel: Channel.telegram, externalId: String(input.chatId) } },
        select: { userId: true, verified: true },
    });
    if (!identity?.verified) return { handled: true, outcome: 'ignored', notice: 'Chat is not linked.' };

    const resolved = await resolveDigestTarget({
        digestId: parsed.digestId,
        winIndex: parsed.index,
        userId: identity.userId,
        action: parsed.action,
    });
    if (!resolved.ok) return { handled: true, outcome: 'ignored', notice: `Could not act (${resolved.reason}).` };

    const applied = await applyDigestAction(resolved.resolved, { surface: 'telegram' });
    if (applied.outcome === 'failed') {
        return { handled: true, outcome: 'failed', notice: applied.error };
    }

    if (input.messageId !== undefined) {
        await refreshDigestMessage({
            digestId: resolved.resolved.digest.id,
            userId: identity.userId,
            chatId: input.chatId,
            messageId: input.messageId,
        });
    }

    return {
        handled: true,
        outcome: applied.outcome === 'navigate' ? 'ignored' : applied.outcome,
        notice: applied.outcome === 'applied' ? 'Logged.' : 'Already done.',
    };
}

/** Re-render the whole message from current state rather than patching a line. */
async function refreshDigestMessage(input: {
    digestId: string;
    userId: string;
    chatId: string;
    messageId: number;
}): Promise<void> {
    const digest = await prisma.weeklyDigest.findFirst({
        where: { id: input.digestId, userId: input.userId },
        select: { winIds: true },
    });
    if (!digest) return;

    const winIds = Array.isArray(digest.winIds)
        ? digest.winIds.filter((id): id is string => typeof id === 'string')
        : [];
    if (winIds.length === 0) return;

    const wins = await prisma.win.findMany({
        where: { id: { in: winIds }, userId: input.userId },
        select: { id: true, title: true, narrative: true, status: true, source: true, sourceRef: true },
    });
    const byId = new Map(wins.map((win) => [win.id, win]));

    const items: TelegramDigestItem[] = winIds.flatMap((winId) => {
        const win = byId.get(winId);
        if (!win) return [];
        return [
            {
                winId,
                title: win.title,
                narrative: win.narrative,
                provenance: describeWinProvenance(win),
                state:
                    win.status === WinStatus.confirmed
                        ? ('confirmed' as const)
                        : win.status === WinStatus.dismissed
                          ? ('dismissed' as const)
                          : ('draft' as const),
            },
        ];
    });

    const summary = await winGraph.getLogSummary({ userId: input.userId });
    const remaining = items.filter((item) => item.state === 'draft').length;

    // Recomputed rather than stored: the row has no column for it, and an
    // edit that silently dropped the block would make one tap look like it
    // deleted the user's job list.
    const bestFits = await composeBestFits(input.userId, getAppUrl());
    const view = {
        headline: remaining === 0 ? 'That is the week, done.' : digestSubject(items.length),
        items,
        overflow: 0,
        footer: summary.success
            ? digestFooterSummary(summary.data.totalConfirmed, summary.data.streakWeeks)
            : '',
        ...(bestFits ? { bestFits } : {}),
    };

    await editTelegramMessageText({
        chatId: input.chatId,
        messageId: input.messageId,
        text: renderTelegramDigest(view),
        replyMarkup: digestInlineKeyboard(view, input.digestId),
    });
}

// ---------------------------------------------------------------------------
// The empty-week nudge
// ---------------------------------------------------------------------------

async function sendNudge(
    input: { userId: string; digest: DigestRow; quietWeeks: number; now: Date },
    ctx: JobContext,
): Promise<JobResultObject> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId: input.userId },
        select: { email: true },
    });
    const to = profile?.email?.trim();
    if (!to) return { skipped: 'no_signals', quietWeeks: input.quietWeeks, nudge: 'no_email' };

    // Same claim-before-send as the digest. `skipped` stays true — this week
    // produced no digest — and `sentAt` is what marks the nudge and restarts
    // the three-week counter.
    const claim = await prisma.weeklyDigest.updateMany({
        where: { id: input.digest.id, sentAt: null },
        data: { sentAt: input.now, skipped: true, winIds: [] },
    });
    if (claim.count === 0) return { skipped: 'no_signals', quietWeeks: input.quietWeeks, nudge: 'already_sent' };

    const appUrl = getAppUrl();
    // Only offer the connector to someone who can actually reach it — the page
    // 404s when the flag is off, and a dead button in an email reads as a
    // broken product rather than an unreleased feature.
    const canConnectSources = await isEnabled(input.userId, 'github_capture');
    const result = await sendEmail({
        userId: input.userId,
        to,
        template: 'digest_nudge',
        data: {
            quietWeeks: input.quietWeeks,
            replyUrl: `${appUrl}/log?compose=1&src=nudge`,
            ...(canConnectSources ? { sourcesUrl: `${appUrl}/settings/sources` } : {}),
        },
        idempotencyKey: `digest_nudge:${input.digest.id}`,
    });

    if (result.status !== 'sent') {
        await prisma.weeklyDigest.updateMany({
            where: { id: input.digest.id },
            data: { sentAt: null },
        });
        return { skipped: 'no_signals', quietWeeks: input.quietWeeks, nudge: result.status };
    }

    await track(input.userId, 'digest_sent', {
        feature: 'work_log',
        digestId: input.digest.id,
        channel: 'email',
        winCount: 0,
        nudge: true,
        quietWeeks: input.quietWeeks,
    });

    ctx.log('empty-week nudge sent', { userId: input.userId, quietWeeks: input.quietWeeks });
    return { digestId: input.digest.id, nudge: true, quietWeeks: input.quietWeeks, winCount: 0 };
}
