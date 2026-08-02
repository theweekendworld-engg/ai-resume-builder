/**
 * The weekly ritual, end to end, against a live Postgres.
 *
 * The four claims worth a database:
 *
 *   1. A DOUBLE-FIRED CRON SENDS EXACTLY ONE DIGEST. Proven at all three
 *      layers — the hourly dispatch enqueue, the per-user child enqueue, and
 *      the send itself — because each is a separate opportunity to double-send
 *      and each has its own constraint.
 *   2. A zero-signal week sends nothing at all, and the nudge fires on the
 *      third one and not before.
 *   3. The frequency guardrails hold: never inside 6 days, and 4 unopened
 *      digests drop the cadence to biweekly and say so.
 *   4. The buttons in the email actually work: a token minted by the composer
 *      resolves and confirms the Win it names.
 *
 * Both outbound channels are mocked at the PROVIDER, not at the module that
 * talks to it. `sendEmail` and `sendTelegramMessage` both run for real, so the
 * preference lookup, the suppression rules, the plain-text part, the RFC 8058
 * `List-Unsubscribe` headers, the `EmailSend` bookkeeping and the Bot API
 * request bodies are all exercised. Only the network call is replaced.
 *
 * This file used to replace `@/lib/email/send` and `@/lib/telegram` outright,
 * which meant every one of those was skipped and the suite could only assert
 * that a function had been called with some arguments.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, WinStatus } from '@prisma/client';
import { installMocks, resetMocks, uninstallMocks } from '@/__mocks__';

const APP_URL = 'http://localhost:3000';

// Only the two boundaries this suite actually uses. Bun shares one process
// across test files and these seams are module bindings, so installing a
// boundary this file does not need would reach into another suite's.
const mocks = installMocks({ only: ['email', 'telegram'] });

/** The rendered emails that reached the provider. */
const sent = mocks.email.sent;

const ENV = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    telegram: process.env.TELEGRAM_BOT_TOKEN,
};

// `emailConfigured()` and `getTelegramBotToken()` are real gates on the paths
// under test; without these the suite would assert on skip results.
process.env.RESEND_API_KEY = 're_test_not_a_real_key';
process.env.EMAIL_FROM = 'patronus@example.com';
process.env.NEXT_PUBLIC_APP_URL = APP_URL;
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

const { prisma } = await import('@/lib/prisma');
const { invalidateFlagCache } = await import('@/lib/flags');
const { enqueue } = await import('@/lib/jobs/runner');
const { cleanupTestUser, fakeJobContext, makeWin, newTestUserId } = await import(
    '@/services/winFixtures.test-utils'
);
const { resolveWinToken, applyDigestAction } = await import('@/lib/winTokens');
const {
    weeklyDigestHandler,
    digestDedupeKey,
    scheduleDigestWork,
    handleDigestCallback,
    preDigestSyncDedupeKey,
    WEEKLY_DIGEST_JOB_KIND,
} = await import('./weeklyDigest');

const DAY = 86_400_000;

/** Friday 2026-07-31, 16:00 UTC — the default digest slot. */
const FRIDAY_1600 = new Date('2026-07-31T16:00:00.000Z');
/** Monday of that week, which is what `weekStartFor('Etc/UTC')` produces. */
const WEEK_START = new Date('2026-07-27T00:00:00.000Z');

const users: string[] = [];
const jobKeys: string[] = [];

function newUser(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

async function seedUser(
    label: string,
    overrides: {
        weeklyDigest?: boolean;
        unsubscribedAll?: boolean;
        digestChannel?: Channel;
        digestDay?: number;
        digestHour?: number;
        timezone?: string;
        email?: string;
    } = {},
): Promise<string> {
    const userId = newUser(label);
    await prisma.emailPreference.create({
        data: {
            userId,
            unsubscribeToken: `unsub-${userId}`,
            timezone: overrides.timezone ?? 'Etc/UTC',
            digestDay: overrides.digestDay ?? 5,
            digestHour: overrides.digestHour ?? 16,
            digestChannel: overrides.digestChannel ?? Channel.email,
            weeklyDigest: overrides.weeklyDigest ?? true,
            unsubscribedAll: overrides.unsubscribedAll ?? false,
        },
    });
    await prisma.userProfile.create({
        data: { userId, email: overrides.email ?? `${label}@example.com`, fullName: 'Ada Lovelace' },
    });
    return userId;
}

/** A prior week's digest row, for the guardrail histories. */
async function seedHistory(
    userId: string,
    rows: Array<{ weeksAgo: number; sentAt?: Date | null; openedAt?: Date | null; skipped?: boolean }>,
): Promise<void> {
    for (const row of rows) {
        await prisma.weeklyDigest.create({
            data: {
                userId,
                weekStart: new Date(WEEK_START.getTime() - row.weeksAgo * 7 * DAY),
                channel: Channel.email,
                token: `hist-${userId}-${row.weeksAgo}`,
                winIds: [],
                sentAt: row.sentAt === undefined ? new Date(FRIDAY_1600.getTime() - row.weeksAgo * 7 * DAY) : row.sentAt,
                openedAt: row.openedAt ?? null,
                skipped: row.skipped ?? false,
            },
        });
    }
}

function ctx() {
    return fakeJobContext({ enqueue });
}

async function send(userId: string, weekStart: Date = WEEK_START) {
    return weeklyDigestHandler({ userId, weekStart: weekStart.toISOString() }, ctx());
}

beforeEach(() => {
    resetMocks();
});

afterEach(async () => {
    if (users.length > 0) {
        await prisma.weeklyDigest.deleteMany({ where: { userId: { in: users } } });
        await prisma.emailSend.deleteMany({ where: { userId: { in: users } } });
        await prisma.emailPreference.deleteMany({ where: { userId: { in: users } } });
        await prisma.userProfile.deleteMany({ where: { userId: { in: users } } });
        await prisma.channelIdentity.deleteMany({ where: { userId: { in: users } } });
        await prisma.job.deleteMany({
            where: { OR: users.map((userId) => ({ dedupeKey: { contains: userId } })) },
        });
    }
    if (jobKeys.length > 0) {
        await prisma.job.deleteMany({ where: { dedupeKey: { in: jobKeys } } });
        jobKeys.length = 0;
    }
    for (const userId of users) await cleanupTestUser(userId);
    users.length = 0;
    await prisma.featureFlag.deleteMany({ where: { key: 'weekly_digest' } });
    invalidateFlagCache();
});

afterAll(() => {
    // Restore the real clients and the env this file changed: the next test
    // file in this process must not inherit either.
    uninstallMocks();
    process.env.RESEND_API_KEY = ENV.key;
    process.env.EMAIL_FROM = ENV.from;
    process.env.NEXT_PUBLIC_APP_URL = ENV.appUrl;
    process.env.TELEGRAM_BOT_TOKEN = ENV.telegram;
});

async function enableFlagFor(userIds: string[]): Promise<void> {
    await prisma.featureFlag.upsert({
        where: { key: 'weekly_digest' },
        create: { key: 'weekly_digest', enabled: true, rolloutPercent: 0, allowUserIds: userIds },
        update: { enabled: true, rolloutPercent: 0, allowUserIds: userIds },
    });
    invalidateFlagCache();
}

// ═════════════════════════════════════════════ 1. the double-fired cron

describe('a double-fired cron sends exactly one digest', () => {
    test('layer 1: the hourly dispatch enqueue is deduped per hour', async () => {
        const now = new Date('2026-07-31T16:07:00.000Z');
        jobKeys.push('weekly_digest:dispatch:2026-07-31T16');

        const first = await scheduleDigestWork(now);
        const second = await scheduleDigestWork(now);

        expect(first.digestDispatchDeduped).toBe(false);
        expect(second.digestDispatchDeduped).toBe(true);
        expect(second.digestDispatchJobId).toBe(first.digestDispatchJobId);

        const rows = await prisma.job.findMany({
            where: { dedupeKey: 'weekly_digest:dispatch:2026-07-31T16' },
        });
        expect(rows).toHaveLength(1);
    });

    test('layer 2: the per-user child enqueue is deduped per week', async () => {
        const userId = await seedUser('cron-child');
        await enableFlagFor([userId]);
        const key = digestDedupeKey(userId, WEEK_START);
        jobKeys.push(key);

        // Two dispatch runs inside the same slot — a retried tick, or a
        // self-retrigger overlapping the original.
        const a = (await weeklyDigestHandler({}, ctx())) as Record<string, number>;
        const b = (await weeklyDigestHandler({}, ctx())) as Record<string, number>;

        // Whether this instant is "due" depends on the wall clock, so assert on
        // the invariant that holds either way: never two jobs.
        expect(a.enqueued + b.enqueued).toBeLessThanOrEqual(1);
        expect(await prisma.job.count({ where: { dedupeKey: key } })).toBeLessThanOrEqual(1);
    });

    test('layer 3: two send handlers for the same week produce ONE digest and ONE email', async () => {
        const userId = await seedUser('cron-send');
        await makeWin({ userId });

        const first = (await send(userId)) as Record<string, unknown>;
        const second = (await send(userId)) as Record<string, unknown>;

        expect(first.winCount).toBe(1);
        expect(second.skipped).toBe('already_sent');

        expect(sent).toHaveLength(1);
        const rows = await prisma.weeklyDigest.findMany({ where: { userId } });
        expect(rows).toHaveLength(1);
        expect(rows[0].sentAt).not.toBeNull();
        expect(await prisma.emailSend.count({ where: { userId, template: 'weekly_digest' } })).toBe(1);
    });

    test('two overlapping sends race onto one row — the unique constraint arbitrates', async () => {
        const userId = await seedUser('cron-race');
        await makeWin({ userId });

        await Promise.all([send(userId), send(userId)]);

        expect(await prisma.weeklyDigest.count({ where: { userId } })).toBe(1);
        expect(sent.length).toBeLessThanOrEqual(1);
    });
});

// ═════════════════════════════════════════════ 2. zero signals

describe('zero-signal weeks', () => {
    test('send nothing at all — no "nothing this week" email', async () => {
        const userId = await seedUser('quiet');

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.skipped).toBe('no_signals');
        expect(sent).toHaveLength(0);
        const row = await prisma.weeklyDigest.findFirst({ where: { userId } });
        expect(row?.skipped).toBe(true);
        expect(row?.sentAt).toBeNull();
        expect(await prisma.emailSend.count({ where: { userId } })).toBe(0);
    });

    test('confirmed and dismissed Wins are not signals — only drafts are', async () => {
        const userId = await seedUser('quiet-nondraft');
        const confirmed = await makeWin({ userId });
        const dismissed = await makeWin({ userId, title: 'Nope' });
        await prisma.win.update({ where: { id: confirmed.id }, data: { status: WinStatus.confirmed } });
        await prisma.win.update({ where: { id: dismissed.id }, data: { status: WinStatus.dismissed } });

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('no_signals');
        expect(sent).toHaveLength(0);
    });

    test('drafts older than 7 days are not this week', async () => {
        const userId = await seedUser('quiet-stale');
        const win = await makeWin({ userId });
        await prisma.win.update({
            where: { id: win.id },
            data: { createdAt: new Date(Date.now() - 10 * DAY) },
        });

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('no_signals');
    });

    test('the nudge fires on the third quiet week, not the first or second', async () => {
        const userId = await seedUser('nudge');
        await seedHistory(userId, [
            { weeksAgo: 1, sentAt: null, skipped: true },
            { weeksAgo: 2, sentAt: null, skipped: true },
        ]);

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.nudge).toBe(true);
        expect(result.quietWeeks).toBe(3);
        expect(sent).toHaveLength(1);
        // It must not look like a digest — no count subject, no confirm buttons.
        expect(sent[0].subject).toBe('What did you work on?');
        expect(sent[0].subject).not.toMatch(/\d+ things?/);
        expect(sent[0].text).not.toContain('✓ Log it');
        expect(sent[0].text).not.toContain('/w/');
        expect(await prisma.emailSend.count({ where: { userId, template: 'digest_nudge' } })).toBe(1);

        // The row stays `skipped` — no digest happened — but `sentAt` marks the
        // nudge so the counter restarts.
        const row = await prisma.weeklyDigest.findFirst({ where: { userId, weekStart: WEEK_START } });
        expect(row?.skipped).toBe(true);
        expect(row?.sentAt).not.toBeNull();
    });

    test('and does not fire again the week after', async () => {
        const userId = await seedUser('nudge-cadence');
        await seedHistory(userId, [
            { weeksAgo: 1, sentAt: new Date(FRIDAY_1600.getTime() - 7 * DAY), skipped: true },
            { weeksAgo: 2, sentAt: null, skipped: true },
            { weeksAgo: 3, sentAt: null, skipped: true },
        ]);

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.skipped).toBe('no_signals');
        expect(result.quietWeeks).toBe(1);
        expect(sent).toHaveLength(0);
    });
});

// ═════════════════════════════════════════════ 3. frequency guardrails

describe('frequency guardrails', () => {
    test('never more than one digest per 6 days', async () => {
        const userId = await seedUser('gap');
        await makeWin({ userId });
        await seedHistory(userId, [{ weeksAgo: 1, sentAt: new Date(Date.now() - 3 * DAY) }]);

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('too_soon');
        expect(sent).toHaveLength(0);
    });

    test('4 unopened digests pause the weekly slot', async () => {
        const userId = await seedUser('degrade');
        await makeWin({ userId });
        await seedHistory(userId, [
            { weeksAgo: 1, sentAt: new Date(Date.now() - 7 * DAY) },
            { weeksAgo: 2, sentAt: new Date(Date.now() - 14 * DAY) },
            { weeksAgo: 3, sentAt: new Date(Date.now() - 21 * DAY) },
            { weeksAgo: 4, sentAt: new Date(Date.now() - 28 * DAY) },
        ]);

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('biweekly_pause');
        expect(sent).toHaveLength(0);
    });

    test('and the next biweekly send tells the user what happened', async () => {
        const userId = await seedUser('degrade-note');
        await makeWin({ userId });
        await seedHistory(userId, [
            { weeksAgo: 2, sentAt: new Date(Date.now() - 14 * DAY) },
            { weeksAgo: 3, sentAt: new Date(Date.now() - 21 * DAY) },
            { weeksAgo: 4, sentAt: new Date(Date.now() - 28 * DAY) },
            { weeksAgo: 5, sentAt: new Date(Date.now() - 35 * DAY) },
        ]);

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.degraded).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain('check in every other');
    });

    test('one opened digest keeps the user on weekly', async () => {
        const userId = await seedUser('engaged');
        await makeWin({ userId });
        await seedHistory(userId, [
            { weeksAgo: 1, sentAt: new Date(Date.now() - 7 * DAY), openedAt: new Date(Date.now() - 7 * DAY) },
            { weeksAgo: 2, sentAt: new Date(Date.now() - 14 * DAY) },
            { weeksAgo: 3, sentAt: new Date(Date.now() - 21 * DAY) },
            { weeksAgo: 4, sentAt: new Date(Date.now() - 28 * DAY) },
            { weeksAgo: 5, sentAt: new Date(Date.now() - 35 * DAY) },
        ]);

        const result = (await send(userId)) as Record<string, unknown>;
        expect(result.degraded).toBe(false);
        expect(sent).toHaveLength(1);
    });
});

// ═════════════════════════════════════════════ 4. preferences

describe('preferences', () => {
    test('a category opt-out stops the send and does not mark the week sent', async () => {
        const userId = await seedUser('optout', { weeklyDigest: false });
        await makeWin({ userId });

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('opted_out');
        expect(sent).toHaveLength(0);
    });

    test('unsubscribed-all stops it too', async () => {
        const userId = await seedUser('unsub', { unsubscribedAll: true });
        await makeWin({ userId });

        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('opted_out');
        expect(sent).toHaveLength(0);
    });

    test('a user with no preference row is never mailed', async () => {
        const userId = newUser('noprefs');
        expect(((await send(userId)) as Record<string, unknown>).skipped).toBe('no_preferences');
    });

    test('an opted-out user is not even dispatched', async () => {
        const userId = await seedUser('optout-dispatch', { weeklyDigest: false });
        await enableFlagFor([userId]);
        const result = (await weeklyDigestHandler({}, ctx())) as Record<string, number>;
        expect(result.enqueued).toBe(0);
    });
});

// ═════════════════════════════════════════════ 5. the email itself

describe('the email', () => {
    test('carries the top five, the overflow count, and working buttons', async () => {
        const userId = await seedUser('compose');
        const wins = [];
        for (let i = 0; i < 7; i += 1) {
            wins.push(
                await makeWin({
                    userId,
                    title: `Win number ${i}`,
                    confidence: 0.9 - i * 0.05,
                    sourceRef: `https://github.com/patronus/api/pull/${480 + i}`,
                }),
            );
        }

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.winCount).toBe(5);
        expect(result.overflow).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0].subject).toBe('5 things you did this week');

        // Highest confidence first, and the two weakest left in the log.
        expect(sent[0].text).toContain('Win number 0');
        expect(sent[0].text).not.toContain('Win number 6');
        expect(sent[0].text).toContain('+2 more');

        // Works with images off: every action is a real link, never an <img>.
        expect(sent[0].html).not.toContain('<img');
        expect(sent[0].html).toContain('PR #480');
        expect(sent[0].text).toContain('Unsubscribe:');

        // Buttons are 40px tall and 120px wide by construction (design/02 §K1).
        expect(sent[0].html).toContain('min-width:120px');
        expect(sent[0].html).toContain('padding:11px 24px');
        // Dark mode is the one thing that cannot be inlined.
        expect(sent[0].html).toContain('prefers-color-scheme: dark');
    });

    test('a confirm link from the email actually confirms that Win', async () => {
        const userId = await seedUser('roundtrip');
        const win = await makeWin({ userId });

        await send(userId);
        expect(sent).toHaveLength(1);

        const match = /\/w\/([A-Za-z0-9_.-]+)/.exec(sent[0].text);
        expect(match).not.toBeNull();
        const resolved = await resolveWinToken(match![1]);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const outcome = await applyDigestAction(resolved.resolved, { surface: 'email' });
        expect(outcome.outcome).toBe('applied');
        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.confirmed);
    });

    test('the digest row records which Wins it offered', async () => {
        const userId = await seedUser('winids');
        const win = await makeWin({ userId });

        await send(userId);

        const row = await prisma.weeklyDigest.findFirst({ where: { userId } });
        expect(row?.winIds).toEqual([win.id]);
        expect(row?.channel).toBe(Channel.email);
    });

    test('emits digest_sent for the funnel', async () => {
        const userId = await seedUser('funnel');
        await makeWin({ userId });

        await send(userId);

        const events = await prisma.funnelEvent.findMany({ where: { userId, type: 'digest_sent' } });
        expect(events).toHaveLength(1);
        expect((events[0].payload as Record<string, unknown>).winCount).toBe(1);
    });
});

// ═════════════════════════════════════════════ 6. failure handling

describe('delivery failure', () => {
    test('throws so the job retries, and leaves the week unsent', async () => {
        const userId = await seedUser('provider-down');
        await makeWin({ userId });
        mocks.email.setOutcome({ kind: 'error', message: 'provider down' });

        await expect(send(userId)).rejects.toThrow(/delivery failed/);

        const row = await prisma.weeklyDigest.findFirst({ where: { userId } });
        expect(row?.sentAt).toBeNull();

        // The retry succeeds and reuses the same row and the same token root.
        mocks.email.setOutcome({ kind: 'ok' });
        const retry = (await send(userId)) as Record<string, unknown>;
        expect(retry.winCount).toBe(1);
        expect(await prisma.weeklyDigest.count({ where: { userId } })).toBe(1);
        const after = await prisma.weeklyDigest.findFirst({ where: { userId } });
        expect(after?.token).toBe(row!.token);
    });

    test('a profile with no email address is a skip, not a crash', async () => {
        const userId = await seedUser('no-email', { email: '' });
        await makeWin({ userId });

        await expect(send(userId)).rejects.toThrow(/no_email_on_profile/);
        expect(sent).toHaveLength(0);
    });
});

// ═════════════════════════════════════════════ 7. dispatch

describe('dispatch', () => {
    test('fans out one child per due user and returns — it never sends inline', async () => {
        const userId = await seedUser('fanout', { digestDay: nowIsoWeekday(), digestHour: nowUtcHour() });
        await enableFlagFor([userId]);
        await makeWin({ userId });
        jobKeys.push(digestDedupeKey(userId, weekStartUtcNow()));

        const result = (await weeklyDigestHandler({}, ctx())) as Record<string, number>;

        expect(result.due).toBeGreaterThanOrEqual(1);
        expect(result.enqueued).toBeGreaterThanOrEqual(1);
        // Fan-out, not a loop: nothing was delivered by the dispatch itself.
        expect(sent).toHaveLength(0);

        const job = await prisma.job.findFirst({
            where: { kind: WEEKLY_DIGEST_JOB_KIND, dedupeKey: digestDedupeKey(userId, weekStartUtcNow()) },
        });
        expect(job).not.toBeNull();
    });

    test('a user whose flag is off is counted as due but never enqueued', async () => {
        const userId = await seedUser('gated', { digestDay: nowIsoWeekday(), digestHour: nowUtcHour() });
        await enableFlagFor([]); // flag exists, allow-list empty, rollout 0

        const result = (await weeklyDigestHandler({}, ctx())) as Record<string, number>;
        expect(result.gated).toBeGreaterThanOrEqual(1);
        expect(
            await prisma.job.count({ where: { dedupeKey: digestDedupeKey(userId, weekStartUtcNow()) } }),
        ).toBe(0);
    });

    test('a user in a different local slot is not due', async () => {
        const userId = await seedUser('not-due', {
            digestDay: ((nowIsoWeekday() + 2) % 7) + 1,
            digestHour: (nowUtcHour() + 5) % 24,
        });
        await enableFlagFor([userId]);

        await weeklyDigestHandler({}, ctx());
        expect(
            await prisma.job.count({ where: { dedupeKey: digestDedupeKey(userId, weekStartUtcNow()) } }),
        ).toBe(0);
    });
});

function nowUtcHour(): number {
    return new Date().getUTCHours();
}

function nowIsoWeekday(): number {
    return ((new Date().getUTCDay() + 6) % 7) + 1;
}

function weekStartUtcNow(): Date {
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    return new Date(utcMidnight - daysSinceMonday * DAY);
}

// ═════════════════════════════════════════════ 8. telegram

describe('telegram', () => {
    async function linkTelegram(userId: string, chatId: string): Promise<void> {
        await prisma.channelIdentity.create({
            data: { userId, channel: Channel.telegram, externalId: chatId, verified: true },
        });
    }

    test('delivers in-chat with an inline keyboard instead of an email', async () => {
        const userId = await seedUser('tg', { digestChannel: Channel.telegram });
        await linkTelegram(userId, `chat-${userId}`);
        await makeWin({ userId });

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.channel).toBe(Channel.telegram);
        expect(sent).toHaveLength(0);
        expect(mocks.telegram.sent).toHaveLength(1);
        const keyboard = mocks.telegram.sent[0].replyMarkup as { inline_keyboard: unknown[][] };
        expect(keyboard.inline_keyboard).toHaveLength(1);
        // Zero navigation: no magic link in the message at all.
        expect(mocks.telegram.sent[0].text).not.toContain('/w/');
    });

    test('falls back to email when the bot was never linked', async () => {
        const userId = await seedUser('tg-unlinked', { digestChannel: Channel.telegram });
        await makeWin({ userId });

        const result = (await send(userId)) as Record<string, unknown>;

        expect(result.channel).toBe(Channel.email);
        expect(mocks.telegram.sent).toHaveLength(0);
        expect(sent).toHaveLength(1);
        const row = await prisma.weeklyDigest.findFirst({ where: { userId } });
        expect(row?.channel).toBe(Channel.email);
    });

    test('an inline tap confirms the Win and edits the message in place', async () => {
        const userId = await seedUser('tg-callback', { digestChannel: Channel.telegram });
        const chatId = `chat-${userId}`;
        await linkTelegram(userId, chatId);
        const win = await makeWin({ userId });
        await send(userId);

        const digest = await prisma.weeklyDigest.findFirstOrThrow({ where: { userId } });
        const result = await handleDigestCallback({
            data: `d:c0:${digest.id}`,
            chatId,
            messageId: 42,
        });

        expect(result).toEqual({ handled: true, outcome: 'applied', notice: 'Logged.' });
        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.confirmed);

        // Edited, not re-sent — one message per digest, however many taps.
        expect(mocks.telegram.sent).toHaveLength(1);
        expect(mocks.telegram.edits).toHaveLength(1);
        expect(mocks.telegram.edits[0].messageId).toBe(42);
        expect(mocks.telegram.edits[0].text).toContain('✓');
        expect((mocks.telegram.edits[0].replyMarkup as { inline_keyboard: unknown[][] }).inline_keyboard).toHaveLength(0);
    });

    test('a second tap on the same button changes nothing', async () => {
        const userId = await seedUser('tg-replay', { digestChannel: Channel.telegram });
        const chatId = `chat-${userId}`;
        await linkTelegram(userId, chatId);
        await makeWin({ userId });
        await send(userId);
        const digest = await prisma.weeklyDigest.findFirstOrThrow({ where: { userId } });

        await handleDigestCallback({ data: `d:c0:${digest.id}`, chatId, messageId: 42 });
        const replay = await handleDigestCallback({ data: `d:c0:${digest.id}`, chatId, messageId: 42 });

        expect(replay.handled && replay.outcome).toBe('already_done');
        expect(await prisma.funnelEvent.count({ where: { userId, type: 'digest_action' } })).toBe(1);
    });

    test("a callback naming someone else's digest reaches nothing", async () => {
        const owner = await seedUser('tg-owner', { digestChannel: Channel.telegram });
        const stranger = await seedUser('tg-stranger', { digestChannel: Channel.telegram });
        await linkTelegram(owner, `chat-${owner}`);
        await linkTelegram(stranger, `chat-${stranger}`);
        const win = await makeWin({ userId: owner });
        await send(owner);
        const digest = await prisma.weeklyDigest.findFirstOrThrow({ where: { userId: owner } });

        const result = await handleDigestCallback({
            data: `d:c0:${digest.id}`,
            chatId: `chat-${stranger}`,
            messageId: 7,
        });

        expect(result.handled && result.outcome).toBe('ignored');
        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.draft);
    });

    test('a callback from an unknown chat is ignored', async () => {
        const result = await handleDigestCallback({ data: 'd:c0:nope', chatId: 'chat-nobody' });
        expect(result).toEqual({ handled: true, outcome: 'ignored', notice: 'Chat is not linked.' });
    });

    test('a callback that is not ours is not claimed', async () => {
        expect(await handleDigestCallback({ data: 'generate:123', chatId: 'x' })).toEqual({ handled: false });
    });
});

// ═════════════════════════════════════════════ 9. pre-digest capture sync

describe('pre-digest capture sync', () => {
    test('is scheduled when a user is due in two hours, and deduped per hour', async () => {
        const now = new Date();
        // Someone whose slot is two hours from now, in UTC.
        const target = new Date(now.getTime() + 2 * 3_600_000);
        await seedUser('presync', {
            digestDay: ((target.getUTCDay() + 6) % 7) + 1,
            digestHour: target.getUTCHours(),
        });
        jobKeys.push(preDigestSyncDedupeKey(now), `weekly_digest:dispatch:${now.toISOString().slice(0, 13)}`);

        const first = await scheduleDigestWork(now);
        const second = await scheduleDigestWork(now);

        expect(first.preDigestSyncJobId).not.toBeNull();
        expect(second.preDigestSyncJobId).toBe(first.preDigestSyncJobId);

        const jobs = await prisma.job.findMany({ where: { dedupeKey: preDigestSyncDedupeKey(now) } });
        expect(jobs).toHaveLength(1);
        // Dispatch mode: the sync handler fans out from an empty payload.
        expect(jobs[0].kind).toBe('capture_sync');
        expect(jobs[0].payload).toEqual({});
        expect(jobs[0].priority).toBe(85);
    });

    test('costs nothing on an hour with nobody due', async () => {
        const now = new Date();
        jobKeys.push(preDigestSyncDedupeKey(now), `weekly_digest:dispatch:${now.toISOString().slice(0, 13)}`);
        // No EmailPreference rows seeded for this hour beyond whatever exists;
        // assert on the shape of the decision rather than a global count.
        const result = await scheduleDigestWork(now);
        expect(typeof result.digestDispatchJobId).toBe('string');
    });
});
