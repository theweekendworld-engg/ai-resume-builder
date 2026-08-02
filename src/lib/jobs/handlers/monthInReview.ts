/**
 * `month_in_review` — the only scheduled payoff before month six (PRD 09 §3).
 *
 * Two modes in one handler, distinguished by the payload, exactly as
 * `captureSync` does it (impl/00 §P-2 — handlers fan out, never loop):
 *
 *   `{}`                   dispatch: one child per eligible user, then return
 *   `{ userId, period }`   compose and send one review
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 * Two independent layers, because they defend against different failures:
 *
 *   1. `Job.dedupeKey` = `month_in_review:<userId>:<yyyy-mm>` — a double-fired
 *      cron enqueues nothing the second time (impl/00 §P-1).
 *   2. An `EmailSend` lookup at the top of the child, plus Resend's own
 *      `idempotencyKey`. The handler deadline is soft: the runner abandons a
 *      slow attempt and retries the SAME row, so attempt 2 can overlap an
 *      attempt 1 that already reached the provider. The dedupe key cannot see
 *      that; the send log can.
 *
 * Registration lives in `src/lib/jobs/registry.ts`, which this file does not touch.
 */

import { z } from 'zod';
import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { getAppUrl, sendEmail } from '@/lib/email/send';
import { MONTH_IN_REVIEW_TEMPLATE_KEY, type MonthInReviewEmailData } from '@/lib/email/templates/monthInReview';
import { track } from '@/lib/track';
import {
    MIN_WINS_FOR_REVIEW,
    buildMonthInReview,
    formatPeriodKey,
    isMonthInReviewDue,
    markMonthInReviewSent,
    parsePeriodKey,
    periodRange,
    persistMonthInReview,
    previousPeriodFor,
    visibleMixRows,
    type Period,
} from '@/services/monthInReview';

export const MONTH_IN_REVIEW_JOB_KIND = 'month_in_review' as const;

/** Ceiling on one dispatch pass. Keeps a single tick from enqueueing 50k children. */
const DEFAULT_DISPATCH_LIMIT = 2_000;

const PayloadSchema = z.object({
    userId: z.string().min(1).max(191).optional(),
    /** `yyyy-mm`. Defaults to the month that just ended in the user's timezone. */
    period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
    /** Dispatch on a day other than the 1st. Operator escape hatch, never the cron. */
    force: z.boolean().optional(),
});

export type MonthInReviewPayload = z.infer<typeof PayloadSchema>;

/** `(userId, period)` — the unit of "one review", per the ticket. */
export function monthInReviewDedupeKey(userId: string, periodKey: string): string {
    return buildDedupeKey(MONTH_IN_REVIEW_JOB_KIND, [userId, periodKey]);
}

// ───────────────────────────────────────────────────────────── recipient

type RecipientResolver = (userId: string) => Promise<string | null>;

/**
 * A job has no request context, so Clerk's `currentUser()` is unavailable here.
 * `UserProfile.email` is the address the user typed into their own resume, which
 * is the one they read; Clerk's is the fallback for anyone who never filled it in.
 */
const defaultRecipientResolver: RecipientResolver = async (userId) => {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { email: true },
    });
    const stored = profile?.email?.trim();
    if (stored) return stored;

    try {
        const { clerkClient } = await import('@clerk/nextjs/server');
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        return user.emailAddresses?.[0]?.emailAddress?.trim() || null;
    } catch (error: unknown) {
        console.warn('[month_in_review] could not resolve a recipient', {
            userId,
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return null;
    }
};

let recipientResolver: RecipientResolver = defaultRecipientResolver;

export const __testing = {
    setRecipientResolver(resolver: RecipientResolver) {
        recipientResolver = resolver;
    },
    reset() {
        recipientResolver = defaultRecipientResolver;
    },
};

// ───────────────────────────────────────────────────────────── eligibility

export type DueUser = { userId: string; timezone: string; digestHour: number; periodKey: string };

/**
 * Users whose local clock says "the 1st, at your usual hour", who have not
 * turned monthly review off.
 *
 * The timezone comparison cannot be pushed into SQL (ADR-3 makes the same
 * trade for the weekly digest): the set is read, then filtered in process.
 */
export async function dueUsers(now: Date, limit: number, force = false): Promise<DueUser[]> {
    const rows = await prisma.emailPreference.findMany({
        where: { monthlyReview: true, unsubscribedAll: false },
        select: { userId: true, timezone: true, digestHour: true },
        orderBy: { userId: 'asc' },
        take: limit,
    });

    return rows
        .filter((row) => force || isMonthInReviewDue(row, now))
        .map((row) => ({
            userId: row.userId,
            timezone: row.timezone,
            digestHour: row.digestHour,
            periodKey: formatPeriodKey(previousPeriodFor(row.timezone, now)),
        }));
}

/**
 * PRD 01 §6.4 — "≥3 confirmed Wins in the prior month". One grouped query per
 * distinct period rather than one count per user, so a dispatch over 2,000
 * users is two queries and not two thousand.
 */
export async function eligibleUserIds(
    candidates: DueUser[],
    minWins = MIN_WINS_FOR_REVIEW,
): Promise<DueUser[]> {
    if (candidates.length === 0) return [];

    const byPeriod = new Map<string, DueUser[]>();
    for (const candidate of candidates) {
        byPeriod.set(candidate.periodKey, [...(byPeriod.get(candidate.periodKey) ?? []), candidate]);
    }

    const eligible: DueUser[] = [];
    for (const [periodKey, group] of byPeriod) {
        const period = parsePeriodKey(periodKey);
        if (!period) continue;
        const { start, end } = periodRange(period);

        const counts = await prisma.win.groupBy({
            by: ['userId'],
            where: {
                userId: { in: group.map((entry) => entry.userId) },
                status: WinStatus.confirmed,
                occurredAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        });

        const qualifying = new Set(
            counts.filter((row) => row._count._all >= minWins).map((row) => row.userId),
        );
        eligible.push(...group.filter((entry) => qualifying.has(entry.userId)));
    }

    return eligible;
}

/**
 * The second idempotency layer. A review for July is sent in August; anything
 * logged against this template on or after the 1st of the sending month is that
 * send, whether this attempt made it or the abandoned one did.
 */
export async function alreadySent(userId: string, period: Period): Promise<boolean> {
    const sendWindowStart = periodRange(period).end;
    const existing = await prisma.emailSend.findFirst({
        where: {
            userId,
            template: MONTH_IN_REVIEW_TEMPLATE_KEY,
            createdAt: { gte: sendWindowStart },
            status: { in: ['queued', 'sent', 'delivered'] },
        },
        select: { id: true },
    });
    return existing !== null;
}

// ───────────────────────────────────────────────────────────── the handler

export const monthInReviewHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) {
        throw new Error(
            `month_in_review: invalid payload — ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        );
    }

    if (!parsed.data.userId) return dispatch(parsed.data, ctx);
    return sendOne(parsed.data.userId, parsed.data.period ?? null, ctx);
};

async function dispatch(payload: MonthInReviewPayload, ctx: JobContext): Promise<JobResultObject> {
    const now = new Date();
    const found = await dueUsers(now, payload.limit ?? DEFAULT_DISPATCH_LIMIT, payload.force ?? false);
    // An explicit period overrides each user's derived one. Only an operator
    // re-running a month ever sets it; the cron never does.
    const candidates = payload.period
        ? found.map((entry) => ({ ...entry, periodKey: payload.period as string }))
        : found;
    const eligible = await eligibleUserIds(candidates);

    let enqueued = 0;
    let deduped = 0;
    for (const user of eligible) {
        const result = await ctx.enqueue(
            MONTH_IN_REVIEW_JOB_KIND,
            { userId: user.userId, period: user.periodKey },
            { dedupeKey: monthInReviewDedupeKey(user.userId, user.periodKey), priority: 110 },
        );
        if (result.deduped) deduped += 1;
        else enqueued += 1;
    }

    ctx.log('month in review dispatched', {
        candidates: candidates.length,
        eligible: eligible.length,
        enqueued,
        deduped,
    });
    return { dispatched: eligible.length, candidates: candidates.length, enqueued, deduped };
}

async function sendOne(
    userId: string,
    periodKeyInput: string | null,
    ctx: JobContext,
): Promise<JobResultObject> {
    const prefs = await prisma.emailPreference.findUnique({
        where: { userId },
        select: { timezone: true, monthlyReview: true, unsubscribedAll: true },
    });

    const period = periodKeyInput
        ? parsePeriodKey(periodKeyInput)
        : previousPeriodFor(prefs?.timezone ?? 'Etc/UTC');
    if (!period) throw new Error(`month_in_review: unparseable period "${periodKeyInput}"`);
    const periodKey = formatPeriodKey(period);

    // Checked here as well as inside sendEmail: the model call is the expensive
    // part of this job, and there is no reason to pay for it for someone who has
    // told us not to send it.
    if (prefs && (prefs.unsubscribedAll || !prefs.monthlyReview)) {
        return { userId, periodKey, skipped: 'opted_out' };
    }

    if (await alreadySent(userId, period)) {
        ctx.log('month in review already sent', { userId, periodKey });
        return { userId, periodKey, skipped: 'already_sent' };
    }

    const to = await recipientResolver(userId);
    if (!to) return { userId, periodKey, skipped: 'no_recipient' };

    const review = await buildMonthInReview({ userId, period });
    if (!review) return { userId, periodKey, skipped: 'no_wins' };
    if (review.winCount < MIN_WINS_FOR_REVIEW) {
        return { userId, periodKey, skipped: 'below_threshold', winCount: review.winCount };
    }

    // Persisted BEFORE the send, and unconditionally. A month that is composed
    // but never emailed — opted out mid-run, no address, a provider outage —
    // still has a document at `/log/review/<period>`, paragraph included.
    await persistMonthInReview(userId, review);

    // Re-checked after the compose: it takes seconds, and the overlapping
    // attempt this guards against is precisely one that was slow. The unique
    // constraint on `MonthlyReview` cannot stand in for this check — a row
    // exists as soon as the review is composed, which says nothing about
    // whether it was sent.
    if (await alreadySent(userId, period)) {
        ctx.log('month in review sent while composing', { userId, periodKey });
        return { userId, periodKey, skipped: 'already_sent', costUsd: review.costUsd };
    }

    const appUrl = getAppUrl();
    const data: MonthInReviewEmailData = {
        label: review.label,
        headline: review.headline,
        subject: review.subject,
        paragraph: review.paragraph,
        mix: visibleMixRows(
            review.mix.map((entry) => ({ category: String(entry.category), count: entry.count })),
        ),
        mixSentence: review.mixSentence,
        observation: review.observation?.text ?? null,
        receipt: review.receipt,
        winCount: review.winCount,
        reviewUrl: `${appUrl}/log/review/${review.periodKey}`,
        packetUrl: `${appUrl}/packets/new`,
        logUrl: `${appUrl}/log`,
    };

    const send = await sendEmail({
        userId,
        to,
        template: MONTH_IN_REVIEW_TEMPLATE_KEY,
        data,
        idempotencyKey: monthInReviewDedupeKey(userId, periodKey),
    });

    if (send.status === 'sent') {
        await markMonthInReviewSent(userId, periodKey);
        await track(userId, 'month_in_review_sent', {
            feature: 'month_in_review',
            period: periodKey,
            winCount: review.winCount,
            quantifiedCount: review.quantifiedCount,
            withEvidence: review.withEvidence,
            hasParagraph: review.paragraph !== null,
            // The drop-rate numerator. `month_in_review_sent` is the
            // denominator, so the ratio is one query over one event stream.
            paragraphDropped: review.dropped,
            observation: review.observation?.kind ?? null,
            degraded: review.degraded,
        });
    }

    ctx.log('month in review processed', { userId, periodKey, status: send.status });

    // A provider failure is transient far more often than not, and the two
    // `alreadySent` guards make a retry safe. Let the runner back off and try.
    if (send.status === 'failed') {
        throw new Error(`month_in_review: send failed for ${userId} ${periodKey} — ${send.error}`);
    }

    // The document itself lives in `MonthlyReview`; what lands on the job row is
    // only what an operator needs to read a drain log.
    return {
        userId,
        periodKey,
        status: send.status,
        costUsd: review.costUsd,
        winCount: review.winCount,
        hasParagraph: review.paragraph !== null,
        paragraphDropped: review.dropped,
        degraded: review.degraded,
    };
}
