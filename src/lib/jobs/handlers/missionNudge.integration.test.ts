/**
 * Mission nudges, and the global budget they compete under.
 *
 * The budget's arithmetic is covered purely in `notifications/budget.test.ts`.
 * What needs a database is the part that actually protects the user: that the
 * count comes from real `EmailSend` rows, that a transactional message does
 * not consume a slot, and that the nudge stays quiet in every situation where
 * it has nothing useful to say.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MissionStatus, MissionType, WinCategory, WinSource, WinStatus } from '@prisma/client';

import { installMocks, mocks, resetMocks, uninstallMocks } from '@/__mocks__';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';
import { countNotificationsThisWeek } from '@/lib/email/send';
import { weekStart } from '@/lib/notifications/budget';
import { missionNudgeHandler } from './missionNudge';
import { missionTemplate, stepKindOf } from '@/lib/missions/catalog';
import type { JobContext, JobResultObject } from '../types';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

const RUN = `itest-nudge-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function userFor(label: string): string {
    const id = `${RUN}-${label}`;
    users.push(id);
    return id;
}

/** A JobContext that records enqueues instead of writing them. */
function fakeContext(): { ctx: JobContext; enqueued: Array<{ kind: string; payload: object }> } {
    const enqueued: Array<{ kind: string; payload: object }> = [];
    const ctx = {
        jobId: 'test-job',
        attempt: 1,
        enqueue: async (kind: string, payload: object) => {
            enqueued.push({ kind, payload });
            return { jobId: `enq-${enqueued.length}`, deduped: false };
        },
    } as unknown as JobContext;
    return { ctx, enqueued };
}

async function startMissionRow(
    userId: string,
    type: MissionType,
    patch: { status?: MissionStatus; startedAt?: Date } = {},
) {
    const template = missionTemplate(type);
    if (!template) throw new Error(`no template for ${type}`);
    return prisma.mission.create({
        data: {
            userId,
            type,
            status: patch.status ?? MissionStatus.active,
            title: template.label,
            startedAt: patch.startedAt ?? new Date(),
            steps: {
                create: template.steps.map((step, index) => ({
                    key: step.key,
                    title: step.title,
                    order: index,
                    kind: stepKindOf(step.condition),
                    condition: step.condition as never,
                })),
            },
        },
        include: { steps: true },
    });
}

async function withProfile(userId: string): Promise<void> {
    await prisma.userProfile.create({
        data: { userId, email: `${userId}@example.test`, fullName: 'Test User' },
    });
}

async function recordSend(userId: string, template: string, createdAt = new Date()): Promise<void> {
    await prisma.emailSend.create({
        data: { userId, template, subject: 'test', status: 'sent', createdAt },
    });
}

async function run(userId: string): Promise<JobResultObject> {
    const { ctx } = fakeContext();
    return (await missionNudgeHandler({ userId }, ctx)) as JobResultObject;
}

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
    // Only the email boundary: these seams are module bindings shared across
    // the whole Bun process, so wiring one this file does not need would point
    // another suite's real client at an in-memory double.
    installMocks({ only: ['email'] });
    await prisma.featureFlag.upsert({
        where: { key: 'missions' },
        create: { key: 'missions', enabled: true, rolloutPercent: 100, description: 'test' },
        update: { enabled: true, rolloutPercent: 100 },
    });
    invalidateFlagCache();
});

afterAll(async () => {
    for (const userId of users) {
        await prisma.mission.deleteMany({ where: { userId } });
        await prisma.emailSend.deleteMany({ where: { userId } });
        await prisma.userProfile.deleteMany({ where: { userId } });
        await prisma.win.deleteMany({ where: { userId } });
    }
    await prisma.featureFlag.updateMany({ where: { key: 'missions' }, data: { enabled: false } });
    invalidateFlagCache();
    uninstallMocks();


    // LAST. Some of these files also delete or disable flags in their own
    // cleanup, and a restore placed first was simply undone by the lines
    // after it — `j1` restored the table and then deleted the same rows.
    await restoreFlags(__flagSnapshot);
});

describe('the budget counts real sends', () => {
    test('notification mail counts, transactional mail does not', async () => {
        const userId = userFor('budget-count');
        const now = new Date();

        await recordSend(userId, 'weekly_digest');
        await recordSend(userId, 'radar_digest');
        expect(await countNotificationsThisWeek(userId, now)).toBe(2);

        // A magic link is not a notification. Rate-limiting someone's login
        // email to protect them from marketing is an outage, not a courtesy.
        await recordSend(userId, 'magic_link');
        await recordSend(userId, 'welcome');
        await recordSend(userId, 'source_disconnected');
        expect(await countNotificationsThisWeek(userId, now)).toBe(2);
    });

    test('last week does not count against this week', async () => {
        const userId = userFor('budget-week');
        const now = new Date();
        const lastWeek = new Date(weekStart(now).getTime() - 86_400_000);

        await recordSend(userId, 'weekly_digest', lastWeek);
        expect(await countNotificationsThisWeek(userId, now)).toBe(0);

        await recordSend(userId, 'weekly_digest', now);
        expect(await countNotificationsThisWeek(userId, now)).toBe(1);
    });

    test('a failed send still consumes budget', async () => {
        // The row is written before the network call, deliberately. Otherwise a
        // provider outage silently converts into a burst of four or five
        // messages the moment it recovers.
        const userId = userFor('budget-failed');
        await prisma.emailSend.create({
            data: { userId, template: 'weekly_digest', subject: 'x', status: 'failed' },
        });
        expect(await countNotificationsThisWeek(userId, new Date())).toBe(1);
    });
});

describe('when the nudge stays quiet', () => {
    test('a paused mission is never nudged', async () => {
        // §2 rule 2 — pausing has to actually stop the pressure, or it is a
        // setting that does nothing.
        const userId = userFor('paused');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.get_promoted, { status: MissionStatus.paused });

        expect(await run(userId)).toMatchObject({ skipped: 'no_active_mission' });
    });

    test('the resting state is never nudged', async () => {
        // §3 M7: keep_warm's cadence IS the weekly digest and monthly Radar. A
        // third message about the resting state is interrupting someone to
        // tell them nothing is happening.
        const userId = userFor('keep-warm');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.keep_warm);

        expect(await run(userId)).toMatchObject({ skipped: 'no_active_mission' });
    });

    test('a step waiting on the user to have a conversation is not chased', async () => {
        const userId = userFor('attested');
        await withProfile(userId);
        const mission = await startMissionRow(userId, MissionType.get_promoted);

        // Settle everything except the final attested step.
        await prisma.missionStep.updateMany({
            where: { missionId: mission.id, key: { not: 'conversation' } },
            data: { status: 'skipped' },
        });

        // "Have you spoken to your manager yet?" every week is the single most
        // irritating message this product could send.
        expect(await run(userId)).toMatchObject({ skipped: 'awaiting_user_action' });
    });

    test('a finished mission is not chased for its outcome', async () => {
        const userId = userFor('settled');
        await withProfile(userId);
        const mission = await startMissionRow(userId, MissionType.get_promoted);
        await prisma.missionStep.updateMany({
            where: { missionId: mission.id },
            data: { status: 'skipped' },
        });

        // The completion prompt lives on Home. Emailing someone to click
        // "I got it" would spend the budget on our own bookkeeping.
        expect(await run(userId)).toMatchObject({ skipped: 'nothing_outstanding' });
    });

    test('the cadence is respected', async () => {
        const userId = userFor('cadence');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.get_promoted);
        await recordSend(userId, 'mission_nudge', new Date(Date.now() - 2 * 86_400_000));

        // get_promoted is weekly; two days is too soon.
        expect(await run(userId)).toMatchObject({ skipped: 'too_soon' });
    });

    test('a cadence that has elapsed sends', async () => {
        const userId = userFor('cadence-ok');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.get_promoted);
        await recordSend(userId, 'mission_nudge', new Date(Date.now() - 9 * 86_400_000));

        resetMocks();
        const result = await run(userId);
        expect(result).toMatchObject({ mode: 'send', status: 'sent' });
        expect(mocks().email.sent).toHaveLength(1);
    });

    test('a spent budget silently drops the nudge', async () => {
        // The end-to-end version of §7. Three notifications already this week,
        // so the fourth does not go — and nothing errors, which is the point:
        // "drop the lowest priority silently".
        const userId = userFor('budget-drop');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.get_promoted);
        for (const template of ['weekly_digest', 'radar_digest', 'month_in_review']) {
            await recordSend(userId, template);
        }

        resetMocks();
        const result = await run(userId);
        expect(result).toMatchObject({ mode: 'send', status: 'skipped', reason: 'budget_exhausted' });
        expect(mocks().email.sent).toHaveLength(0);
    });

    test('but transactional mail this week does not spend that budget', async () => {
        const userId = userFor('budget-transactional');
        await withProfile(userId);
        await startMissionRow(userId, MissionType.get_promoted);
        for (const template of ['magic_link', 'welcome', 'source_disconnected', 'packet_ready']) {
            await recordSend(userId, template);
        }

        resetMocks();
        const result = await run(userId);
        expect(result).toMatchObject({ status: 'sent' });
    });

    test('the flag being off stops everything', async () => {
        const userId = userFor('flag-off');
        await prisma.featureFlag.updateMany({ where: { key: 'missions' }, data: { enabled: false } });
        invalidateFlagCache();

        expect(await run(userId)).toMatchObject({ skipped: 'flag_off' });

        await prisma.featureFlag.updateMany({ where: { key: 'missions' }, data: { enabled: true } });
        invalidateFlagCache();
    });
});

describe('dispatch fans out', () => {
    test('one child per user with a nudgeable mission, and none for keep_warm', async () => {
        const active = userFor('fan-active');
        const resting = userFor('fan-resting');
        const paused = userFor('fan-paused');

        await startMissionRow(active, MissionType.get_promoted);
        await startMissionRow(resting, MissionType.keep_warm);
        await startMissionRow(paused, MissionType.switch_domain, { status: MissionStatus.paused });

        const { ctx, enqueued } = fakeContext();
        await missionNudgeHandler({}, ctx);

        const targeted = enqueued.map((job) => (job.payload as { userId: string }).userId);
        expect(targeted).toContain(active);
        expect(targeted).not.toContain(resting);
        expect(targeted).not.toContain(paused);
        // §P-2: the dispatcher enqueues and returns. It must never compose.
        expect(enqueued.every((job) => job.kind === 'mission_nudge')).toBe(true);
    });
});

describe('what the nudge says', () => {
    test('it names the current step and its real distance', async () => {
        const userId = userFor('content');
        await withProfile(userId);
        const mission = await startMissionRow(userId, MissionType.ic_to_manager);

        // Settle the earlier steps so the threshold step is current.
        await prisma.missionStep.updateMany({
            where: { missionId: mission.id, key: { in: ['management_rubric', 'readiness'] } },
            data: { status: 'skipped' },
        });
        await prisma.win.create({
            data: {
                userId,
                title: 'Grew the on-call rotation',
                narrative: 'Brought two engineers up to primary.',
                category: WinCategory.grew,
                status: WinStatus.confirmed,
                source: WinSource.manual,
                occurredAt: new Date(),
            },
        });

        resetMocks();
        const result = (await run(userId)) as { stepKey?: string; mode?: string };
        expect(result.mode).toBe('send');
        expect(result.stepKey).toBe('leadership_evidence');

        const [sent] = mocks().email.sent;
        expect(sent).toBeDefined();
        // The subject IS the step and its distance. A generic subject would be
        // filtered inside three weeks and the mechanic would be dead.
        expect(sent.subject).toContain('1 of 4');
        // Stated flatly — no "only", no "still just".
        expect(sent.text).not.toMatch(/\bonly\b|still just/i);
        // The escape hatch travels with the nudge (§2 rule 2).
        expect(sent.text.toLowerCase()).toContain('pause');
    });
});
