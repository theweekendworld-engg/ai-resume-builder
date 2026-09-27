/**
 * `month_in_review` handler — dispatch, eligibility, and idempotency.
 *
 * Runs against the real local Postgres, with real `Job` rows written through
 * the real `enqueue`, because the property under test IS the unique constraint
 * on `Job.dedupeKey`. Only the model and the mail PROVIDER are mocked.
 *
 * That distinction matters. This file used to replace `@/lib/email/send` — the
 * module that owns the preference lookup, the suppression rules, the
 * `EmailSend` bookkeeping and the `List-Unsubscribe` headers — which meant none
 * of it ran, and the second idempotency layer was being satisfied by a row the
 * stub wrote by hand. Now `MockResend` sits under the real `sendEmail`, so the
 * row `alreadySent` reads is the row the production path actually writes.
 *
 * The idempotency tests are the point of this file. The handler deadline is
 * soft: the runner abandons a slow attempt and retries the same row, so a
 * second attempt can overlap a first that already reached Resend. A review sent
 * twice is worse than one sent late.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { WinCategory, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { enqueue } from '@/lib/jobs/runner';
import { cleanupTestUser, fakeJobContext, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import { installMocks, resetMocks, uninstallMocks } from '@/__mocks__';

// ───────────────────────────────────────────────────── mail provider seam

// `only: ['email']` on purpose. Bun shares one process across test files and
// these seams are module bindings, so installing a boundary this suite does not
// use would reach into somebody else's suite.
const mocks = installMocks({ only: ['email'] });

/** What the system handed the provider. The rendered email, not the input. */
const sent = mocks.email.sent;

const ENV = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
};

// `emailConfigured()` is a real gate in `sendEmail`; without these the suite
// would assert on a `skipped: not_configured` result and prove nothing.
process.env.RESEND_API_KEY = 're_test_not_a_real_key';
process.env.EMAIL_FROM = 'patronus@example.com';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

const handlerModule = await import('@/lib/jobs/handlers/monthInReview');
const {
    __testing: handlerTesting,
    alreadySent,
    dueUsers,
    eligibleUserIds,
    monthInReviewDedupeKey,
    monthInReviewHandler,
} = handlerModule;

const { loadPersistedReview } = await import('@/services/monthInReview');

// ───────────────────────────────────────────────────────────── harness

const JULY = { year: 2026, month: 7 };
const AUGUST_FIRST_09_UTC = new Date('2026-08-01T09:00:00.000Z');

const users: string[] = [];

function user(label = 'job'): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

async function seedUser(input: {
    label: string;
    wins: number;
    monthlyReview?: boolean;
    unsubscribedAll?: boolean;
    digestHour?: number;
    timezone?: string;
    email?: string | null;
}): Promise<string> {
    const userId = user(input.label);

    await prisma.emailPreference.create({
        data: {
            userId,
            unsubscribeToken: `tok-${userId}`,
            monthlyReview: input.monthlyReview ?? true,
            unsubscribedAll: input.unsubscribedAll ?? false,
            timezone: input.timezone ?? 'Etc/UTC',
            digestHour: input.digestHour ?? 9,
        },
    });

    if (input.email !== null) {
        await prisma.userProfile.create({
            data: { userId, email: input.email ?? `${userId}@example.com` },
        });
    }

    for (let index = 0; index < input.wins; index += 1) {
        const win = await makeWin({
            userId,
            title: `Cut the ${index} ms path from 800ms to 180ms`,
            narrative: 'Rewrote the pricing lookup as a batched query.',
            category: index % 2 === 0 ? WinCategory.improved : WinCategory.shipped,
            occurredAt: new Date(Date.UTC(2026, 6, 5 + index)),
            source: WinSource.manual,
            employerId: null,
        });
        await prisma.win.update({
            where: { id: win.id },
            data: { status: WinStatus.confirmed, confirmedAt: new Date(Date.UTC(2026, 6, 5 + index)) },
        });
    }

    return userId;
}

async function cleanupJobs(userId: string): Promise<void> {
    await prisma.job.deleteMany({ where: { dedupeKey: { contains: userId } } });
    await prisma.monthlyReview.deleteMany({ where: { userId } });
    await prisma.emailSend.deleteMany({ where: { userId } });
    await prisma.emailPreference.deleteMany({ where: { userId } });
    await prisma.userProfile.deleteMany({ where: { userId } });
}

/** A context whose `enqueue` is the real one, so dedupe is the database's job. */
function realEnqueueContext() {
    const enqueued: string[] = [];
    return {
        enqueued,
        ctx: fakeJobContext({
            enqueue: async (kind, payload, opts) => {
                const result = await enqueue(kind, payload, opts);
                if (!result.deduped) enqueued.push(opts?.dedupeKey ?? '');
                return result;
            },
        }),
    };
}

beforeEach(() => {
    resetMocks();
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setObjectRunner(async () => ({
        object: { paragraph: 'The pricing lookup work took the path from 800ms to 180ms.' },
        inputTokens: 100,
        outputTokens: 40,
    }));
    handlerTesting.reset();
});

afterEach(async () => {
    aiTesting.reset();
    while (users.length > 0) {
        const id = users.pop();
        if (!id) continue;
        await cleanupJobs(id);
        await cleanupTestUser(id);
    }
});

afterAll(() => {
    handlerTesting.reset();
    // Restore the real Resend client and the env this file changed: the next
    // test file in this process must not inherit either.
    uninstallMocks();
    process.env.RESEND_API_KEY = ENV.key;
    process.env.EMAIL_FROM = ENV.from;
    process.env.NEXT_PUBLIC_APP_URL = ENV.appUrl;
});

// ═════════════════════════════════════════════════════════════ eligibility

describe('who gets one', () => {
    // Day-level since 2026-09-27 (daily tick): due in the first week of the
    // month at any hour; the digest hour no longer gates it.
    test('in the first week of the month, at any hour, only if they still want it', async () => {
        const wanted = await seedUser({ label: 'due', wins: 3, digestHour: 9 });
        const otherHour = await seedUser({ label: 'hour', wins: 3, digestHour: 17 });
        const optedOut = await seedUser({ label: 'off', wins: 3, monthlyReview: false });
        const unsubscribed = await seedUser({ label: 'unsub', wins: 3, unsubscribedAll: true });

        const due = await dueUsers(AUGUST_FIRST_09_UTC, 5_000);
        const ids = due.map((entry) => entry.userId);

        expect(ids).toContain(wanted);
        expect(ids).toContain(otherHour);
        expect(ids).not.toContain(optedOut);
        expect(ids).not.toContain(unsubscribed);
        expect(due.find((entry) => entry.userId === wanted)?.periodKey).toBe('2026-07');

        // A missed tick on the 1st is recovered on the 2nd.
        const recovered = await dueUsers(new Date('2026-08-02T03:00:00.000Z'), 5_000);
        expect(recovered.map((entry) => entry.userId)).toContain(wanted);

        // Mid-month is not due.
        const notDue = await dueUsers(new Date('2026-08-15T03:00:00.000Z'), 5_000);
        expect(notDue.map((entry) => entry.userId)).not.toContain(wanted);
    });

    test('the threshold is three confirmed wins in the month, not three wins', async () => {
        const three = await seedUser({ label: 'three', wins: 3 });
        const two = await seedUser({ label: 'two', wins: 2 });
        const drafts = await seedUser({ label: 'drafts', wins: 3 });
        await prisma.win.updateMany({
            where: { userId: drafts },
            data: { status: WinStatus.draft },
        });

        const due = await dueUsers(AUGUST_FIRST_09_UTC, 5_000);
        const eligible = await eligibleUserIds(
            due.filter((entry) => [three, two, drafts].includes(entry.userId)),
        );

        expect(eligible.map((entry) => entry.userId)).toEqual([three]);
    });

    test('wins outside the month do not count toward the threshold', async () => {
        const userId = await seedUser({ label: 'june', wins: 2 });
        const june = await makeWin({
            userId,
            title: 'Shipped something in June',
            occurredAt: new Date(Date.UTC(2026, 5, 20)),
            employerId: null,
        });
        await prisma.win.update({ where: { id: june.id }, data: { status: WinStatus.confirmed } });

        const due = await dueUsers(AUGUST_FIRST_09_UTC, 5_000);
        const eligible = await eligibleUserIds(due.filter((entry) => entry.userId === userId));
        expect(eligible).toHaveLength(0);
    });
});

// ═════════════════════════════════════════════════════════════ dispatch

describe('dispatch (impl/00 §P-2)', () => {
    test('fans out one child per eligible user and sends nothing itself', async () => {
        const userId = await seedUser({ label: 'fanout', wins: 4 });
        const { ctx, enqueued } = realEnqueueContext();

        const result = (await monthInReviewHandler(
            { force: true, period: '2026-07' },
            ctx,
        )) as Record<string, number>;

        expect(result.enqueued).toBeGreaterThanOrEqual(1);
        expect(enqueued).toContain(monthInReviewDedupeKey(userId, '2026-07'));
        expect(sent).toHaveLength(0);

        const child = await prisma.job.findUnique({
            where: { dedupeKey: monthInReviewDedupeKey(userId, '2026-07') },
            select: { kind: true, payload: true },
        });
        expect(child?.kind).toBe('month_in_review');
        expect(child?.payload).toMatchObject({ userId, period: '2026-07' });
    });

    test('a double-fired cron enqueues nothing the second time', async () => {
        const userId = await seedUser({ label: 'double', wins: 4 });
        const first = realEnqueueContext();
        const second = realEnqueueContext();

        const dispatchPayload = { force: true, period: '2026-07' };
        await monthInReviewHandler(dispatchPayload, first.ctx);
        const result = (await monthInReviewHandler(dispatchPayload, second.ctx)) as Record<string, number>;

        expect(second.enqueued).not.toContain(monthInReviewDedupeKey(userId, '2026-07'));
        expect(result.deduped).toBeGreaterThanOrEqual(1);

        const rows = await prisma.job.count({
            where: { kind: 'month_in_review', dedupeKey: { contains: userId } },
        });
        expect(rows).toBe(1);
    });

    test('an invalid payload fails loudly rather than dispatching to everyone', async () => {
        const { ctx } = realEnqueueContext();
        await expect(monthInReviewHandler({ limit: -4 }, ctx)).rejects.toThrow('invalid payload');
    });
});

// ═════════════════════════════════════════════════════════════ the send

describe('sending one review', () => {
    test('composes, sends, records the event, and stores what it sent', async () => {
        const userId = await seedUser({ label: 'send', wins: 4 });
        const { ctx } = realEnqueueContext();

        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.status).toBe('sent');
        expect(sent).toHaveLength(1);
        // These are now assertions about the RENDERED email that would have
        // left the building, not about the argument object handed to a stub.
        expect(sent[0].tags).toContainEqual({ name: 'template', value: 'month_in_review' });
        expect(sent[0].to).toEqual([`${userId}@example.com`]);
        expect(sent[0].from).toBe('patronus@example.com');
        // Resend-side dedupe, keyed the same way as the job row.
        expect(sent[0].idempotencyKey).toBe(monthInReviewDedupeKey(userId, '2026-07'));
        expect(sent[0].subject).toBe('July: 4 wins, 4 with numbers');
        expect(sent[0].text).toContain('This review drew on 4 wins from July');
        expect(sent[0].text).toContain('https://app.example.com/log/review/2026-07');

        // The part the old module-level stub skipped entirely: RFC 8058
        // one-click unsubscribe, built from this user's real token.
        expect(sent[0].headers['List-Unsubscribe']).toContain('/api/email/unsubscribe?token=tok-');
        expect(sent[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

        const stored = await loadPersistedReview(userId, '2026-07');
        expect(stored?.headline).toBe('4 wins, 4 with hard numbers');
        expect(stored?.paragraph).toContain('800ms to 180ms');
        expect(stored?.receipt).toContain('This review drew on 4 wins from July');
        expect(stored?.winIds).toHaveLength(4);
        expect(stored?.winCount).toBe(4);
        expect(stored?.degraded).toBe(false);
        expect(stored?.sentAt).toBeInstanceOf(Date);

        const events = await prisma.funnelEvent.findMany({
            where: { userId, type: 'month_in_review_sent' },
            select: { payload: true },
        });
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({
            period: '2026-07',
            winCount: 4,
            hasParagraph: true,
            paragraphDropped: null,
        });
    });

    test('a retry that overlaps an abandoned attempt does not send twice', async () => {
        const userId = await seedUser({ label: 'retry', wins: 4 });
        const { ctx } = realEnqueueContext();

        await monthInReviewHandler({ userId, period: '2026-07' }, ctx);
        expect(sent).toHaveLength(1);

        // Attempt 2 of the SAME job row: the dedupe key cannot help here.
        const second = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(second.skipped).toBe('already_sent');
        expect(sent).toHaveLength(1);
    });

    test('alreadySent only looks at sends made after the month ended', async () => {
        const userId = await seedUser({ label: 'window', wins: 3 });
        expect(await alreadySent(userId, JULY)).toBe(false);

        // A send logged during July is last month's review, not this one.
        await prisma.emailSend.create({
            data: {
                userId,
                template: 'month_in_review',
                subject: 'June: 3 wins, 1 with numbers',
                status: 'sent',
                providerId: `prov_old_${userId}`,
                createdAt: new Date('2026-07-01T09:00:00.000Z'),
            },
        });
        expect(await alreadySent(userId, JULY)).toBe(false);

        await prisma.emailSend.create({
            data: {
                userId,
                template: 'month_in_review',
                subject: 'July: 3 wins, 3 with numbers',
                status: 'sent',
                providerId: `prov_new_${userId}`,
                createdAt: new Date('2026-08-01T09:00:00.000Z'),
            },
        });
        expect(await alreadySent(userId, JULY)).toBe(true);
    });

    test('an opted-out user costs nothing: no model call, no send', async () => {
        const userId = await seedUser({ label: 'optout', wins: 4, monthlyReview: false });
        let modelCalls = 0;
        aiTesting.setObjectRunner(async () => {
            modelCalls += 1;
            return { object: { paragraph: 'x' }, inputTokens: 0, outputTokens: 0 };
        });

        const { ctx } = realEnqueueContext();
        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.skipped).toBe('opted_out');
        expect(modelCalls).toBe(0);
        expect(sent).toHaveLength(0);
    });

    test('no recipient is a skip, not a crash', async () => {
        const userId = await seedUser({ label: 'noemail', wins: 4, email: null });
        handlerTesting.setRecipientResolver(async () => null);

        const { ctx } = realEnqueueContext();
        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.skipped).toBe('no_recipient');
        expect(sent).toHaveLength(0);
    });

    test('a month below the threshold is skipped even when the child was enqueued', async () => {
        const userId = await seedUser({ label: 'thin', wins: 2 });
        const { ctx } = realEnqueueContext();

        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.skipped).toBe('below_threshold');
        expect(sent).toHaveLength(0);
    });

    test('a provider failure throws so the runner retries with backoff', async () => {
        const userId = await seedUser({ label: 'fail', wins: 4 });
        // The provider answers with an error body. `sendEmail` must convert
        // that into a `failed` result without throwing; the handler is what
        // throws, so the runner retries.
        mocks.email.setOutcome({ kind: 'error', message: 'provider down' });

        const { ctx } = realEnqueueContext();
        await expect(monthInReviewHandler({ userId, period: '2026-07' }, ctx)).rejects.toThrow(
            'send failed',
        );
    });
});

// ═══════════════════════════════════════════════ the durable MonthlyReview row

describe('the MonthlyReview row', () => {
    test('a review composed but never emailed still has its paragraph', async () => {
        // The gap the table was added to close: this user opted out of nothing
        // and is eligible, but there is no address to send to. The document must
        // still exist in full at /log/review/2026-07.
        const userId = await seedUser({ label: 'unsent', wins: 4, email: null });
        handlerTesting.setRecipientResolver(async () => null);

        const { ctx } = realEnqueueContext();
        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.skipped).toBe('no_recipient');
        expect(sent).toHaveLength(0);

        // `no_recipient` short-circuits before the compose, so nothing is stored.
        expect(await loadPersistedReview(userId, '2026-07')).toBeNull();

        // Now the same month with an address but a provider that refuses to
        // deliver: composed, persisted, never sent.
        handlerTesting.reset();
        await prisma.userProfile.create({ data: { userId, email: `${userId}@example.com` } });
        // Unconfigured mail is the real condition being reproduced, so take the
        // real path to it: `emailConfigured()` returns false without a sender.
        const from = process.env.EMAIL_FROM;
        delete process.env.EMAIL_FROM;

        await monthInReviewHandler({ userId, period: '2026-07' }, ctx);

        process.env.EMAIL_FROM = from;
        expect(sent).toHaveLength(0);

        const stored = await loadPersistedReview(userId, '2026-07');
        expect(stored).not.toBeNull();
        expect(stored?.sentAt).toBeNull();
        expect(stored?.paragraph).toContain('800ms to 180ms');
        expect(stored?.headline).toBe('4 wins, 4 with hard numbers');
        expect(stored?.receipt).toContain('This review drew on 4 wins from July');
    });

    test('the unique constraint makes the write idempotent, and a recompose cannot un-send', async () => {
        const userId = await seedUser({ label: 'upsert', wins: 4 });
        const { ctx } = realEnqueueContext();

        await monthInReviewHandler({ userId, period: '2026-07' }, ctx);
        const first = await loadPersistedReview(userId, '2026-07');
        expect(first?.sentAt).toBeInstanceOf(Date);

        // Force a second compose past the send guard by clearing the send log,
        // which is what a manual operator re-run looks like.
        await prisma.emailSend.deleteMany({ where: { userId } });
        await monthInReviewHandler({ userId, period: '2026-07' }, ctx);

        const rows = await prisma.monthlyReview.count({ where: { userId } });
        expect(rows).toBe(1);

        const second = await loadPersistedReview(userId, '2026-07');
        // markMonthInReviewSent is conditional on sentAt being null, so the
        // timestamp of the send that actually reached the user is preserved.
        expect(second?.sentAt?.toISOString()).toBe(first?.sentAt?.toISOString());
    });

    test('a dropped paragraph is persisted as degraded and is countable', async () => {
        const userId = await seedUser({ label: 'dropped', wins: 4 });
        aiTesting.setObjectRunner(async () => ({
            object: { paragraph: 'You migrated the platform to Kubernetes for Acme.' },
            inputTokens: 10,
            outputTokens: 10,
        }));

        const { ctx } = realEnqueueContext();
        const result = (await monthInReviewHandler(
            { userId, period: '2026-07' },
            ctx,
        )) as Record<string, unknown>;

        expect(result.hasParagraph).toBe(false);
        expect(result.paragraphDropped).toBe('entity');
        expect(result.degraded).toBe(true);

        const stored = await loadPersistedReview(userId, '2026-07');
        expect(stored?.paragraph).toBeNull();
        expect(stored?.degraded).toBe(true);
        // Every other block survived: a dropped paragraph is not a dropped review.
        expect(stored?.headline).toBe('4 wins, 4 with hard numbers');
        expect(stored?.receipt).toContain('This review drew on 4 wins from July');

        // RISK 1 instrumentation: visible in the first month of sends, not inferred.
        const violations = await prisma.funnelEvent.findMany({
            where: { userId, type: 'ai_guard_violation' },
            select: { payload: true },
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].payload).toMatchObject({
            feature: 'month_in_review',
            surface: 'paragraph',
            period: '2026-07',
            reason: 'entity',
        });
        expect((violations[0].payload as { unsupportedEntities: string[] }).unsupportedEntities)
            .toContain('Kubernetes');

        // The drop rate is one query: this event over month_in_review_sent.
        const sends = await prisma.funnelEvent.findMany({
            where: { userId, type: 'month_in_review_sent' },
            select: { payload: true },
        });
        expect(sends[0].payload).toMatchObject({ hasParagraph: false, paragraphDropped: 'entity' });
    });
});
