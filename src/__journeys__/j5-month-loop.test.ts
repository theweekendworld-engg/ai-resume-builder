/**
 * J5 — the month loop (impl/04 §4).
 *
 * Month rolls over -> eligibility -> compose -> guard -> persist to
 * `MonthlyReview` -> email -> web view.
 *
 * This is the only scheduled payoff before the review packet at roughly month
 * six, so it carries the opening quarter of the relationship on its own. That
 * makes three things load-bearing rather than nice-to-have, and they are what
 * this file exists to hold down:
 *
 *   1. **It fires for the right people and only once.** Three independent
 *      idempotency layers — the `Job.dedupeKey`, the `EmailSend` lookup, and the
 *      unique constraint on `MonthlyReview` — each defend against a different
 *      failure, and each is exercised here separately. A review sent twice is
 *      worse than one sent late.
 *   2. **The paragraph is dropped, never repaired.** A month with no paragraph
 *      reads as a thin month. A month with an invented one is a broken promise,
 *      and it is the promise the whole product rests on.
 *   3. **The tone is the feature.** No exclamation marks, no congratulating the
 *      user for having used the tool, and an observation that is specific or
 *      absent — never generic encouragement.
 *
 * Everything runs through the real queue (`drainJobs`), the real `sendEmail`
 * with `MockResend` underneath, and a real Postgres. Only the model and the
 * mail provider are doubled.
 */

import { describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { mocks } from '@/__mocks__';
import {
    assertNoDeadJobs,
    assertNoFabricatedNumbers,
    assertPurged,
    defineJourney,
    drainJobs,
    purge,
} from '@/__journeys__/harness';
import { enqueue } from '@/lib/jobs/runner';

// `defineJourney` registers the Clerk module mock at module scope. Anything
// that binds `auth()` has to be imported *after* that, hence the dynamic
// imports below — the same rule `src/__mocks__/index.ts` states.
const journey = defineJourney({
    name: 'month-loop',
    // `email` for the send, `openai` for the paragraph and the near-duplicate
    // embedding, `qdrant` because confirming a Win enqueues an `embed_win` job
    // that the drain will run for real.
    boundaries: ['email', 'openai', 'qdrant'],
});

const { confirmWin, createWinFromText } = await import('@/actions/wins');
const { getMonthInReview } = await import('@/actions/monthInReview');
const { MONTH_IN_REVIEW_JOB_KIND, dueUsers, eligibleUserIds, monthInReviewDedupeKey } =
    await import('@/lib/jobs/handlers/monthInReview');
const { MIN_WINS_FOR_REVIEW, formatPeriodKey, loadPersistedReview, monthName, previousPeriodFor } =
    await import('@/services/monthInReview');

// ─────────────────────────────────────────────────────────────── the calendar
//
// Derived from the real clock rather than pinned to a literal date. The
// handler's second idempotency layer reads `EmailSend` rows created *after the
// reviewed month ended*, which is only meaningful when the month under review
// is genuinely the one that just finished. A hard-coded 2026-07 would quietly
// stop exercising that window the moment the wall clock moved past it.

const NOW = new Date();
const PERIOD = previousPeriodFor('Etc/UTC', NOW);
const PERIOD_KEY = formatPeriodKey(PERIOD);
/** The 1st of this month at 09:00 UTC — the tick that makes the review due. */
const ROLLOVER = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1, 9, 0, 0));
const DIGEST_HOUR = 9;

const PRIMARY = journey.userId;
const THIN = `${journey.runId}:thin`;
const OFF_HOUR = `${journey.runId}:offhour`;
const UNSENT = `${journey.runId}:unsent`;
const DROPPED = `${journey.runId}:dropped`;

/** What `defaultRecipientResolver` falls through to when there is no `UserProfile`. */
function inbox(userId: string): string {
    return `${userId}@example.test`;
}

// ───────────────────────────────────────────────────────────────── the wins
//
// Shaped deliberately, because `selectObservation` is a priority-ordered rule
// set over real counts and the journey asserts which rule fires. See the
// comments on each set.

type Seed = {
    title: string;
    narrative: string;
    category: WinCategory;
    day: number;
    impact?: { metric: string; baseline?: string; result?: string };
};

/**
 * Four wins, three carrying digits, one naming `users`, none `influenced` or
 * `led`. That combination walks past rules 1 and 2 of `selectObservation` and
 * lands on `no_influence`, which names a real count — so "specific, not
 * generic" is a checkable property of the output rather than a hope.
 */
const PRIMARY_WINS: Seed[] = [
    {
        title: 'Cut the checkout lookup from 800ms to 180ms',
        narrative: 'Rewrote the pricing lookup as a single batched query.',
        category: WinCategory.improved,
        day: 4,
        impact: { metric: 'p95 latency', baseline: '800ms', result: '180ms' },
    },
    {
        title: 'Shipped the batching layer, replacing 3 sequential queries with 1',
        narrative: 'The orders list now issues one query per page instead of one per row.',
        category: WinCategory.shipped,
        day: 9,
    },
    {
        title: 'Stopped duplicate charges for users on the retry path',
        narrative: 'Made the payment retry idempotent so users are never billed twice.',
        category: WinCategory.improved,
        day: 15,
    },
    {
        title: 'Backfilled the sessions table in 2 passes',
        narrative: 'Backfilled the missing rows with no downtime.',
        category: WinCategory.shipped,
        day: 22,
    },
];

/**
 * Two wins: below `MIN_WINS_FOR_REVIEW`, so this user is due but not eligible.
 */
const THIN_WINS: Seed[] = [
    {
        title: 'Tidied the settings form validation',
        narrative: 'Consolidated three copies of the same rule.',
        category: WinCategory.improved,
        day: 6,
    },
    {
        title: 'Documented the deploy runbook',
        narrative: 'Wrote down what the on-call actually does.',
        category: WinCategory.shipped,
        day: 11,
    },
];

/**
 * Four wins, quantified, business-facing, spread across four categories with
 * `influenced` and `grew` both present — every observation rule declines. The
 * spec is explicit that the block then renders nothing at all, so this set is
 * how "specific or absent, never encouragement" gets its second half proven.
 */
const SPREAD_WINS: Seed[] = [
    {
        title: 'Halved cold starts from 900ms to 250ms for users on mobile',
        narrative: 'Warmed the pool so users stop waiting on the first request.',
        category: WinCategory.improved,
        day: 3,
    },
    {
        title: 'Moved the team off the 2-week release train',
        narrative: 'Argued the case in the platform review and the team changed the cadence.',
        category: WinCategory.influenced,
        day: 8,
    },
    {
        title: 'Took a new engineer through their first 3 on-call rotations',
        narrative: 'Paired on every page until they ran the rotation alone.',
        category: WinCategory.grew,
        day: 14,
    },
    {
        title: 'Shipped the 1-click export for support',
        narrative: 'Support no longer files a ticket to get a customer report.',
        category: WinCategory.shipped,
        day: 20,
    },
];

/** Everything the composer is allowed to draw on, rebuilt independently here. */
function sourceTextFor(seeds: Seed[]): string {
    return seeds
        .map((seed) =>
            [
                seed.title,
                seed.narrative,
                seed.category,
                seed.impact?.metric ?? '',
                seed.impact?.baseline ?? '',
                seed.impact?.result ?? '',
            ]
                .filter(Boolean)
                .join(' '),
        )
        .join('\n');
}

// ─────────────────────────────────────────────────────────────── arrangement

/**
 * Notification preferences are the state of the world *before* the journey
 * starts, not a step in it. The product path (`updateNotificationSettings`)
 * needs a process-global `next/cache` module mock, which the harness warns
 * against for exactly the reason it gives, so the row is arranged directly.
 */
async function arrangePreferences(
    userId: string,
    patch: Partial<{ digestHour: number; monthlyReview: boolean; unsubscribedAll: boolean }> = {},
): Promise<void> {
    await prisma.emailPreference.create({
        data: {
            userId,
            unsubscribeToken: `unsub-${userId}`,
            timezone: 'Etc/UTC',
            digestHour: patch.digestHour ?? DIGEST_HOUR,
            monthlyReview: patch.monthlyReview ?? true,
            unsubscribedAll: patch.unsubscribedAll ?? false,
        },
    });
}

/** Every Win this journey created, so its `embed_win` jobs can be swept. */
const createdWinIds: string[] = [];

/** Through the real Work Log actions: draft, then confirm. */
async function logConfirmedWins(userId: string, seeds: Seed[]): Promise<string[]> {
    journey.clerk.signIn(userId);
    const ids: string[] = [];

    for (const seed of seeds) {
        const created = await createWinFromText({
            draft: {
                title: seed.title,
                narrative: seed.narrative,
                category: seed.category,
                quantified: Boolean(seed.impact),
                impact: seed.impact ?? null,
            },
            occurredAt: new Date(Date.UTC(PERIOD.year, PERIOD.month - 1, seed.day)),
            sensitivity: WinSensitivity.shareable,
        });
        if (!created.success) throw new Error(`createWinFromText: ${created.error}`);

        const confirmed = await confirmWin(created.data.id);
        if (!confirmed.success) throw new Error(`confirmWin: ${confirmed.error}`);
        ids.push(created.data.id);
        createdWinIds.push(created.data.id);
    }

    journey.clerk.signIn(PRIMARY);
    return ids;
}

/** Script the one thing the model writes. Matched on the compose system prompt. */
function scriptParagraph(text: string): void {
    mocks().openai.onObject('You write one paragraph describing a month', {
        object: { paragraph: text },
    });
}

async function jobResultFor(dedupeKey: string): Promise<Record<string, unknown>> {
    const row = await prisma.job.findUnique({
        where: { dedupeKey },
        select: { status: true, result: true, lastError: true },
    });
    if (!row) throw new Error(`no job with dedupeKey ${dedupeKey}`);
    expect(row.lastError).toBeNull();
    expect(row.status).toBe('succeeded');
    return (row.result ?? {}) as Record<string, unknown>;
}

/**
 * Tone, as an assertion.
 *
 * The exclamation check runs over the subject and the plain-text part rather
 * than the HTML: the HTML carries `<!doctype>` and a stylesheet full of
 * `!important`, neither of which a reader ever sees. The text part is the body.
 */
/** The plain-text part is hard-wrapped for mail clients; compare on one line. */
function flatten(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

const CONGRATULATION = [
    'congrat',
    'great month',
    'great work',
    'great job',
    'well done',
    'nice work',
    'good job',
    'impressive',
    'amazing',
    'awesome',
    'keep it up',
    'proud of you',
    'way to go',
    'you crushed',
    'thanks for using',
    'love using',
];

function assertNoCelebration(subject: string, body: string): void {
    expect(subject).not.toContain('!');
    expect(body).not.toContain('!');
    const haystack = `${subject}\n${body}`.toLowerCase();
    for (const phrase of CONGRATULATION) {
        expect(haystack).not.toContain(phrase);
    }
}

// ═══════════════════════════════════════════════════════════ 1. the rollover

describe('J5 — the month loop', () => {
    test('hop 1 — the month rolls over, and only ≥3 confirmed wins in it makes a user eligible', async () => {
        await arrangePreferences(PRIMARY);
        await arrangePreferences(THIN);
        await arrangePreferences(OFF_HOUR, { digestHour: 17 });

        await logConfirmedWins(PRIMARY, PRIMARY_WINS);
        await logConfirmedWins(THIN, THIN_WINS);
        // OFF_HOUR logs nothing: the operator `force` flag used by the dispatch
        // hop below bypasses the clock, so a user kept out only by their digest
        // hour would still be swept in and would blur the fan-out count.

        // Due: the 1st of the month, at the user's own digest hour.
        const due = await dueUsers(ROLLOVER, 5_000);
        const dueIds = due.map((entry) => entry.userId);
        expect(dueIds).toContain(PRIMARY);
        expect(dueIds).toContain(THIN);
        expect(dueIds).not.toContain(OFF_HOUR);
        expect(due.find((entry) => entry.userId === PRIMARY)?.periodKey).toBe(PERIOD_KEY);

        // The 2nd is not the 1st. A cron that ticks hourly must not fire again.
        const notDue = await dueUsers(new Date(ROLLOVER.getTime() + 86_400_000), 5_000);
        expect(notDue.map((entry) => entry.userId)).not.toContain(PRIMARY);

        // Eligible: ≥3 confirmed wins that occurred inside the reviewed month.
        expect(MIN_WINS_FOR_REVIEW).toBe(3);
        const eligible = await eligibleUserIds(
            due.filter((entry) => [PRIMARY, THIN].includes(entry.userId)),
        );
        expect(eligible.map((entry) => entry.userId)).toEqual([PRIMARY]);
    });

    // ═════════════════════════════════════════ 2. dispatch → send → web view

    test('hop 2 — dispatch fans out, the child composes, guards, persists, emails, and the web view says the same thing', async () => {
        // Grounded in the supplied wins and nothing else: every figure and every
        // referring expression below appears verbatim in PRIMARY_WINS.
        const paragraph =
            'The month went into the checkout path: the lookup went from 800ms to 180ms and ' +
            'the batching layer replaced the repeated queries on the orders list. The retry ' +
            'path stopped billing users twice.';
        scriptParagraph(paragraph);

        // The dispatch job. `force` because the handler reads the wall clock for
        // "is it the 1st"; that gate is the hop above, driven at a fixed clock.
        // The period is deliberately NOT supplied — the handler must derive it.
        const dispatchKey = `${journey.runId}:dispatch-1`;
        await enqueue(MONTH_IN_REVIEW_JOB_KIND, { force: true }, { dedupeKey: dispatchKey });

        await drainJobs();

        // ── the fan-out: one child for the eligible user, none for the thin one
        const childKey = monthInReviewDedupeKey(PRIMARY, PERIOD_KEY);
        const child = await prisma.job.findUnique({
            where: { dedupeKey: childKey },
            select: { kind: true, payload: true },
        });
        expect(child?.kind).toBe(MONTH_IN_REVIEW_JOB_KIND);
        expect(child?.payload).toMatchObject({ userId: PRIMARY, period: PERIOD_KEY });
        expect(
            await prisma.job.count({
                where: { dedupeKey: monthInReviewDedupeKey(THIN, PERIOD_KEY) },
            }),
        ).toBe(0);

        const dispatched = await jobResultFor(dispatchKey);
        expect(dispatched.enqueued).toBe(1);

        // ── the send, asserted on what the provider was actually handed
        const sent = mocks().email.to(inbox(PRIMARY));
        expect(sent).toHaveLength(1);
        const mail = sent[0];

        expect(mail.subject).toBe(`${monthName(PERIOD)}: 4 wins, 3 with numbers`);
        expect(mail.tags).toContainEqual({ name: 'template', value: 'month_in_review' });
        expect(mail.idempotencyKey).toBe(childKey);
        expect(mail.headers['List-Unsubscribe']).toContain(`/api/email/unsubscribe?token=unsub-`);
        expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(flatten(mail.text)).toContain(paragraph);
        expect(mail.text).toContain(`/log/review/${PERIOD_KEY}`);
        expect(flatten(mail.text)).toContain(
            `This review drew on 4 wins from ${monthName(PERIOD)}`,
        );

        // The observation is specific: it names a count about THIS month.
        expect(flatten(mail.text)).toContain('All 4 wins this month are work you did yourself.');

        // Tone. The product's own copy, top to bottom.
        assertNoCelebration(mail.subject, mail.text);

        // ── the guard: the paragraph invented nothing
        assertNoFabricatedNumbers(paragraph, sourceTextFor(PRIMARY_WINS));

        // ── the durable row
        const stored = await loadPersistedReview(PRIMARY, PERIOD_KEY);
        expect(stored).not.toBeNull();
        expect(stored?.paragraph).toBe(paragraph);
        expect(stored?.headline).toBe('4 wins, 3 with hard numbers');
        expect(stored?.winCount).toBe(4);
        expect(stored?.quantifiedCount).toBe(3);
        expect(stored?.winIds).toHaveLength(4);
        expect(stored?.degraded).toBe(false);
        expect(stored?.sentAt).toBeInstanceOf(Date);
        expect(stored?.mixSentence).toBe('Two of four wins were `improved`. None were `grew`.');

        // ── the web view: the same document, same words, from the same row
        journey.clerk.signIn(PRIMARY);
        const view = await getMonthInReview(PERIOD_KEY);
        expect(view.success).toBe(true);
        if (!view.success) return;
        expect(view.data.source).toBe('sent');
        expect(view.data.paragraph).toBe(paragraph);
        expect(view.data.headline).toBe(stored?.headline ?? '');
        expect(view.data.observation).toBe(stored?.observation ?? null);
        expect(view.data.receipt).toBe(stored?.receipt ?? '');
        expect(view.data.sentAt).toBeInstanceOf(Date);

        // A month that has not finished has no review at all.
        const thisMonth = formatPeriodKey({
            year: NOW.getUTCFullYear(),
            month: NOW.getUTCMonth() + 1,
        });
        const unfinished = await getMonthInReview(thisMonth);
        expect(unfinished.success).toBe(false);

        await assertNoDeadJobs(journey.runId);
    });

    // ══════════════════════════════════════════════════════ 3. idempotency

    test('hop 3 — idempotent at every layer: a double-fired dispatch and a retried child both send nothing', async () => {
        scriptParagraph('A second paragraph that must never be composed.');

        // Layer 1: `Job.dedupeKey`. A genuinely double-fired cron is a *second*
        // dispatch row, so it gets its own key; the child key it computes is the
        // one that must collide.
        const dispatchKey = `${journey.runId}:dispatch-2`;
        await enqueue(MONTH_IN_REVIEW_JOB_KIND, { force: true }, { dedupeKey: dispatchKey });
        await drainJobs();

        const dispatched = await jobResultFor(dispatchKey);
        expect(dispatched.enqueued).toBe(0);
        expect(dispatched.deduped).toBe(1);
        expect(
            await prisma.job.count({
                where: { kind: MONTH_IN_REVIEW_JOB_KIND, dedupeKey: monthInReviewDedupeKey(PRIMARY, PERIOD_KEY) },
            }),
        ).toBe(1);
        expect(mocks().email.to(inbox(PRIMARY))).toHaveLength(0);

        // Layer 2: the `EmailSend` lookup. The runner abandons a slow attempt and
        // retries the SAME logical work, which the dedupe key cannot see — so
        // this second child carries a distinct key on purpose.
        const retryKey = `${monthInReviewDedupeKey(PRIMARY, PERIOD_KEY)}:attempt-2`;
        await enqueue(
            MONTH_IN_REVIEW_JOB_KIND,
            { userId: PRIMARY, period: PERIOD_KEY },
            { dedupeKey: retryKey },
        );
        await drainJobs();

        const retried = await jobResultFor(retryKey);
        expect(retried.skipped).toBe('already_sent');
        expect(mocks().email.to(inbox(PRIMARY))).toHaveLength(0);

        // Layer 3: `@@unique([userId, period])`. One month, one row, one send.
        expect(await prisma.monthlyReview.count({ where: { userId: PRIMARY } })).toBe(1);
        expect(
            await prisma.emailSend.count({
                where: { userId: PRIMARY, template: 'month_in_review' },
            }),
        ).toBe(1);

        // And exactly one `month_in_review_sent` event, which is the denominator
        // of the drop-rate ratio.
        expect(
            await prisma.funnelEvent.count({
                where: { userId: PRIMARY, type: 'month_in_review_sent' },
            }),
        ).toBe(1);

        await assertNoDeadJobs(journey.runId);
    });

    // ═══════════════════════════════════ 4. composed but never sent + silence

    test('hop 4 — a composed-but-unsent month still renders its paragraph, and says nothing when it has nothing specific to say', async () => {
        await arrangePreferences(UNSENT);
        await logConfirmedWins(UNSENT, SPREAD_WINS);

        const paragraph =
            'Cold starts fell from 900ms to 250ms and the team left the release train behind. ' +
            'A new engineer now runs the rotation alone.';
        scriptParagraph(paragraph);

        // The real condition this table exists for: the review composes, and the
        // send never happens. Reproduced through the real gate — `sendEmail`
        // checks `emailConfigured()` before it touches the database.
        const from = process.env.EMAIL_FROM;
        delete process.env.EMAIL_FROM;

        const childKey = monthInReviewDedupeKey(UNSENT, PERIOD_KEY);
        try {
            await enqueue(
                MONTH_IN_REVIEW_JOB_KIND,
                { userId: UNSENT, period: PERIOD_KEY },
                { dedupeKey: childKey },
            );
            await drainJobs();
        } finally {
            process.env.EMAIL_FROM = from;
        }

        expect(mocks().email.sent).toHaveLength(0);

        const stored = await loadPersistedReview(UNSENT, PERIOD_KEY);
        expect(stored).not.toBeNull();
        // The whole reason the table exists: `sentAt` null, `paragraph` present.
        expect(stored?.sentAt).toBeNull();
        expect(stored?.paragraph).toBe(paragraph);
        expect(stored?.headline).toBe('4 wins, 4 with hard numbers');
        expect(stored?.receipt).toContain(`This review drew on 4 wins from ${monthName(PERIOD)}`);
        expect(stored?.degraded).toBe(false);

        // Nothing generic in the gap: no rule fired, so the block is absent.
        expect(stored?.observation).toBeNull();

        journey.clerk.signIn(UNSENT);
        const view = await getMonthInReview(PERIOD_KEY);
        expect(view.success).toBe(true);
        if (!view.success) return;
        expect(view.data.source).toBe('composed');
        expect(view.data.sentAt).toBeNull();
        expect(view.data.paragraph).toBe(paragraph);
        expect(view.data.observation).toBeNull();
        expect(view.data.winCount).toBe(4);
        journey.clerk.signIn(PRIMARY);

        await assertNoDeadJobs(journey.runId);
    });

    // ══════════════════════════════════════════ 5. dropped, never repaired

    test('hop 5 — a paragraph naming something outside the wins is dropped, not repaired, and the drop is persisted', async () => {
        await arrangePreferences(DROPPED);
        await logConfirmedWins(DROPPED, PRIMARY_WINS);

        // The model reaches for context it "knows" rather than context it was
        // given. Neither name appears in a single supplied Win.
        scriptParagraph('You migrated the checkout path to Kubernetes for Acme.');

        const childKey = monthInReviewDedupeKey(DROPPED, PERIOD_KEY);
        await enqueue(
            MONTH_IN_REVIEW_JOB_KIND,
            { userId: DROPPED, period: PERIOD_KEY },
            { dedupeKey: childKey },
        );
        await drainJobs();

        const result = await jobResultFor(childKey);
        expect(result.status).toBe('sent');
        expect(result.hasParagraph).toBe(false);
        expect(result.paragraphDropped).toBe('entity');
        expect(result.degraded).toBe(true);

        const stored = await loadPersistedReview(DROPPED, PERIOD_KEY);
        // Dropped, not repaired: no salvaged sentence, no placeholder.
        expect(stored?.paragraph).toBeNull();
        expect(stored?.degraded).toBe(true);
        // Everything computed still renders. A dropped paragraph is not a
        // dropped review — that is the whole point of composing in code.
        expect(stored?.headline).toBe('4 wins, 3 with hard numbers');
        expect(stored?.receipt).toContain(`This review drew on 4 wins from ${monthName(PERIOD)}`);
        expect(stored?.observation).toContain('All 4 wins this month are work you did yourself.');

        const mail = mocks().email.to(inbox(DROPPED));
        expect(mail).toHaveLength(1);
        expect(mail[0].text).not.toContain('Kubernetes');
        expect(mail[0].text).not.toContain('Acme');
        expect(mail[0].html).not.toContain('Kubernetes');
        assertNoCelebration(mail[0].subject, mail[0].text);

        // Countable from day one rather than inferred later.
        const violations = await prisma.funnelEvent.findMany({
            where: { userId: DROPPED, type: 'ai_guard_violation' },
            select: { payload: true },
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].payload).toMatchObject({
            feature: 'month_in_review',
            surface: 'paragraph',
            period: PERIOD_KEY,
            reason: 'entity',
        });
        expect(
            (violations[0].payload as { unsupportedEntities: string[] }).unsupportedEntities,
        ).toContain('Kubernetes');

        await assertNoDeadJobs(journey.runId);
    });

    // ══════════════════════════════════════════════════════════ teardown

    test('hop 6 — the journey leaves nothing behind', async () => {
        await assertNoDeadJobs(journey.runId);

        // `purge` matches `Job` rows on the run id, and an `embed_win` key is
        // `embed_win:<winId>:<updatedAt>` — no run id in it. So these are swept
        // here, by the ids this journey created, rather than left to pile up.
        const byWin = { OR: createdWinIds.map((id) => ({ dedupeKey: { contains: id } })) };
        expect(await prisma.job.count({ where: { ...byWin, status: 'dead' } })).toBe(0);
        await prisma.job.deleteMany({ where: byWin });

        await purge(journey.runId);
        expect(await assertPurged(journey.runId)).toEqual({});
    });
});
