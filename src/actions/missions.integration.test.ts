/**
 * Missions — integration tests against the live Postgres.
 *
 * The evaluator's own rules are covered purely in `lib/missions/evaluate.test.ts`.
 * What can only be tested here is everything that depends on real rows: that
 * the threshold queries count the right things from the right moment, that the
 * one-active-mission rule actually holds, and that the entitlement gate is on
 * the action rather than the component.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    ApplicationStatus,
    MissionStatus,
    MissionStepStatus,
    MissionType,
    Tier,
    WinCategory,
    WinSource,
    WinStatus,
} from '@prisma/client';

import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';

const clerk = installClerkMock();

const missions = await import('@/actions/missions');
const service = await import('@/services/missions');

const RUN = `itest-mission-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function signIn(label: string): string {
    const id = `${RUN}-${label}`;
    users.push(id);
    clerk.signIn(id);
    return id;
}

/** Career tier, so the rubric-gated missions are available. */
async function givePlan(userId: string, tier: Tier): Promise<void> {
    await prisma.subscription.create({
        data: {
            userId,
            // Required column; no Stripe call is made in these tests.
            stripeCustomerId: `cus_test_${userId}`,
            tier,
            status: 'active',
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        },
    });
}

const giveCareer = (userId: string) => givePlan(userId, Tier.always_on);

async function addWin(
    userId: string,
    patch: { category?: WinCategory; occurredAt?: Date; status?: WinStatus } = {},
): Promise<void> {
    await prisma.win.create({
        data: {
            userId,
            title: `Win ${Math.random().toString(36).slice(2, 8)}`,
            narrative: 'Something real happened.',
            category: patch.category ?? WinCategory.shipped,
            status: patch.status ?? WinStatus.confirmed,
            source: WinSource.manual,
            occurredAt: patch.occurredAt ?? new Date(),
        },
    });
}

beforeAll(async () => {
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
        await prisma.win.deleteMany({ where: { userId } });
        await prisma.applicationWorkspace.deleteMany({ where: { userId } });
        await prisma.subscription.deleteMany({ where: { userId } });
        await prisma.funnelEvent.deleteMany({ where: { userId } });
    }
    await prisma.featureFlag.updateMany({ where: { key: 'missions' }, data: { enabled: false } });
    invalidateFlagCache();
    clerk.signOut();
});

describe('§2 rule 1 — at most one active mission', () => {
    test('starting a second is refused, and names the one in the way', async () => {
        const userId = signIn('one-active');
        await giveCareer(userId);

        const first = await missions.startMission({ type: MissionType.get_promoted, title: 'Staff by March' });
        expect(first.success).toBe(true);

        const second = await missions.startMission({ type: MissionType.switch_domain });
        expect(second.success).toBe(false);
        if (second.success) throw new Error('unreachable');
        // Refused by name, never silently swapped: ending a three-month
        // program is not a decision to make on someone's behalf.
        expect(second.error).toContain('Staff by March');
        expect(second.code).toBe('conflict');
    });

    test('pausing frees the slot; resuming while another runs does not', async () => {
        const userId = signIn('pause-slot');
        await giveCareer(userId);

        const first = await missions.startMission({ type: MissionType.get_promoted });
        if (!first.success) throw new Error(first.error);

        expect((await missions.pauseMission(first.data.id)).success).toBe(true);

        const second = await missions.startMission({ type: MissionType.switch_domain });
        expect(second.success).toBe(true);

        // The paused one cannot come back while the new one holds the slot.
        const resumed = await missions.resumeMission(first.data.id);
        expect(resumed.success).toBe(false);
    });

    test('pausing loses nothing — §2 rule 2', async () => {
        const userId = signIn('pause-keeps');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        await missions.pauseMission(started.data.id);
        const row = await prisma.mission.findUniqueOrThrow({
            where: { id: started.data.id },
            include: { steps: true },
        });
        expect(row.status).toBe(MissionStatus.paused);
        expect(row.startedAt).not.toBeNull();
        expect(row.steps.length).toBeGreaterThan(0);
        // pausedAt exists to say "paused since March", not to compute a penalty.
        expect(row.pausedAt).not.toBeNull();
    });
});

describe('threshold steps count real rows', () => {
    test('only wins logged AFTER the mission started', async () => {
        const userId = signIn('since-start');
        await giveCareer(userId);

        // Two wins from well before the user committed to anything.
        const old = new Date(Date.now() - 400 * 86_400_000);
        await addWin(userId, { category: WinCategory.led, occurredAt: old });
        await addWin(userId, { category: WinCategory.led, occurredAt: old });

        const started = await missions.startMission({ type: MissionType.ic_to_manager });
        if (!started.success) throw new Error(started.error);

        const before = started.data.steps.find((s) => s.key === 'leadership_evidence');
        // A mission is a program you start. Counting history would show
        // someone 60% complete on day one, which is not progress.
        expect(before?.progress).toEqual({ current: 0, target: 4 });

        await addWin(userId, { category: WinCategory.grew });
        const home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(
            home.data.mission.steps.find((s) => s.key === 'leadership_evidence')?.progress,
        ).toEqual({ current: 1, target: 4 });
    });

    test('leadership counts led/influenced/grew, not shipped', async () => {
        const userId = signIn('leadership');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.ic_to_manager });
        if (!started.success) throw new Error(started.error);

        // Shipping more is the IC case. Counting it here would tell someone
        // they are ready to manage because they wrote more code.
        await addWin(userId, { category: WinCategory.shipped });
        await addWin(userId, { category: WinCategory.shipped });

        let home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(
            home.data.mission.steps.find((s) => s.key === 'leadership_evidence')?.progress?.current,
        ).toBe(0);

        await addWin(userId, { category: WinCategory.influenced });
        home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(
            home.data.mission.steps.find((s) => s.key === 'leadership_evidence')?.progress?.current,
        ).toBe(1);
    });

    test('a draft win does not count — only confirmed evidence does', async () => {
        const userId = signIn('drafts');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.ic_to_manager });
        if (!started.success) throw new Error(started.error);

        await addWin(userId, { category: WinCategory.led, status: WinStatus.draft });
        const home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(
            home.data.mission.steps.find((s) => s.key === 'leadership_evidence')?.progress?.current,
        ).toBe(0);
    });

    test('an opened tab is not an application', async () => {
        const userId = signIn('applications');
        // land_new_role needs Search.
        await givePlan(userId, Tier.pro);
        const started = await missions.startMission({ type: MissionType.land_new_role });
        if (!started.success) throw new Error(started.error);

        for (const status of [ApplicationStatus.discovered, ApplicationStatus.drafting]) {
            await prisma.applicationWorkspace.create({
                data: { userId, sourceUrl: `https://jobs.test/${status}`, applicationStatus: status },
            });
        }
        let home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        // Counting these would flatter the user against their own pace target.
        expect(home.data.mission.steps.find((s) => s.key === 'apply_loop')?.progress?.current).toBe(0);

        await prisma.applicationWorkspace.create({
            data: {
                userId,
                sourceUrl: 'https://jobs.test/sent',
                applicationStatus: ApplicationStatus.applied,
            },
        });
        home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(home.data.mission.steps.find((s) => s.key === 'apply_loop')?.progress?.current).toBe(1);
    });
});

describe('automatic steps complete from product events', () => {
    test('a recorded event marks its step done', async () => {
        const userId = signIn('auto-event');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);
        expect(started.data.steps.find((s) => s.key === 'readiness')?.status).toBe(
            MissionStepStatus.pending,
        );

        await prisma.funnelEvent.create({
            data: { sessionId: `${userId}-s`, userId, type: 'readiness_viewed' },
        });

        const home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        expect(home.data.mission.steps.find((s) => s.key === 'readiness')?.status).toBe(
            MissionStepStatus.done,
        );
    });

    test('an event from before the mission started does not count', async () => {
        const userId = signIn('auto-before');
        await giveCareer(userId);
        await prisma.funnelEvent.create({
            data: {
                sessionId: `${userId}-old`,
                userId,
                type: 'readiness_viewed',
                occurredAt: new Date(Date.now() - 90 * 86_400_000),
            },
        });

        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);
        expect(started.data.steps.find((s) => s.key === 'readiness')?.status).toBe(
            MissionStepStatus.pending,
        );
    });
});

describe('what a user may and may not tick', () => {
    test('an attested step can be ticked and un-ticked', async () => {
        const userId = signIn('attest');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        const done = await missions.setStepStatus({
            missionId: started.data.id,
            stepKey: 'conversation',
            status: 'done',
        });
        expect(done.success).toBe(true);
        if (!done.success) throw new Error('unreachable');
        expect(done.data.steps.find((s) => s.key === 'conversation')?.status).toBe(
            MissionStepStatus.done,
        );

        const undone = await missions.setStepStatus({
            missionId: started.data.id,
            stepKey: 'conversation',
            status: 'pending',
        });
        if (!undone.success) throw new Error(undone.error);
        expect(undone.data.steps.find((s) => s.key === 'conversation')?.status).toBe(
            MissionStepStatus.pending,
        );
    });

    test('an automatic step cannot be hand-completed', async () => {
        const userId = signIn('no-handwave');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        // The whole claim of a mission is that its evidence is real. A step
        // someone can tick without doing the thing is worth nothing.
        const result = await missions.setStepStatus({
            missionId: started.data.id,
            stepKey: 'packet',
            status: 'done',
        });
        expect(result.success).toBe(false);
    });

    test('any step may be skipped, and skipping does not block completion', async () => {
        const userId = signIn('skip');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        for (const step of started.data.steps) {
            const result = await missions.setStepStatus({
                missionId: started.data.id,
                stepKey: step.key,
                status: 'skipped',
            });
            expect(result.success).toBe(true);
        }

        const home = await missions.getHome();
        if (!home.success || !home.data.mission) throw new Error('no mission');
        // §4: pacing beats compliance.
        expect(home.data.mission.percent).toBe(100);
        expect(home.data.mission.readyToComplete).toBe(true);
    });
});

describe('§2 rule 4 — completion asks for the outcome', () => {
    test('the outcome is stored, and the mission closes', async () => {
        const userId = signIn('outcome');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        const result = await missions.completeMission({
            missionId: started.data.id,
            result: 'not_yet',
            note: 'Cycle slipped a quarter.',
        });
        expect(result.success).toBe(true);

        const row = await prisma.mission.findUniqueOrThrow({ where: { id: started.data.id } });
        expect(row.status).toBe(MissionStatus.completed);
        // This column IS the outcome dataset. "not_yet" is a first-class
        // answer and must be recorded as faithfully as a win.
        expect(row.outcome).toMatchObject({ result: 'not_yet', note: 'Cycle slipped a quarter.' });
    });

    test('an unrecognised outcome is refused rather than coerced', async () => {
        const userId = signIn('bad-outcome');
        await giveCareer(userId);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        const result = await missions.completeMission({
            missionId: started.data.id,
            // @ts-expect-error — deliberately invalid
            result: 'probably',
        });
        expect(result.success).toBe(false);
    });

    test('completing frees the slot for the next mission', async () => {
        const userId = signIn('next-mission');
        await giveCareer(userId);
        const first = await missions.startMission({ type: MissionType.get_promoted });
        if (!first.success) throw new Error(first.error);
        await missions.completeMission({ missionId: first.data.id, result: 'achieved' });

        expect((await missions.startMission({ type: MissionType.switch_domain })).success).toBe(true);
    });
});

describe('entitlements — §8', () => {
    test('a free user cannot start a Career mission, and is told which plan', async () => {
        const userId = signIn('free-user');

        const result = await missions.startMission({ type: MissionType.get_promoted });
        expect(result.success).toBe(false);
        if (result.success) throw new Error('unreachable');
        expect(result.code).toBe('upgrade_required');
        // Plan name, never the raw Tier enum (CLAUDE.md rule 4).
        expect(result.error).not.toContain('always_on');
    });

    test('the option list marks it unavailable rather than hiding it', async () => {
        const userId = signIn('free-options');
        const home = await missions.getHome();
        if (!home.success) throw new Error(home.error);

        const promoted = home.data.options.find((o) => o.type === MissionType.get_promoted);
        // Seeing what you would get is the honest paywall (§8 "preview").
        expect(promoted?.available).toBe(false);
        expect(promoted?.requiredPlan).toBeTruthy();
        expect(promoted?.requiredPlan).not.toBe('always_on');
        expect(userId).toBeTruthy();
    });

    test('Career does not unlock the Search-only mission', async () => {
        const userId = signIn('career-not-search');
        await giveCareer(userId);
        const result = await missions.startMission({ type: MissionType.land_new_role });
        expect(result.success).toBe(false);
    });
});

describe('the resting state', () => {
    test('keep_warm is created for everyone and is never the "current" mission', async () => {
        const userId = signIn('keep-warm');
        const home = await missions.getHome();
        if (!home.success) throw new Error(home.error);

        // §3 M7: it exists from day one…
        const warm = await prisma.mission.findFirst({
            where: { userId, type: MissionType.keep_warm },
        });
        expect(warm).not.toBeNull();
        // …but Home must not render a progress bar for the absence of a goal.
        expect(home.data.mission).toBeNull();
    });

    test('ensureKeepWarm is idempotent', async () => {
        const userId = signIn('warm-once');
        await service.ensureKeepWarm(userId);
        await service.ensureKeepWarm(userId);
        expect(await prisma.mission.count({ where: { userId, type: MissionType.keep_warm } })).toBe(1);
    });

    test('it is not offered as a choice', async () => {
        const userId = signIn('warm-not-offered');
        const home = await missions.getHome();
        if (!home.success) throw new Error(home.error);
        expect(home.data.options.some((o) => o.type === MissionType.keep_warm)).toBe(false);
        expect(userId).toBeTruthy();
    });
});

describe('ownership', () => {
    test('you cannot touch someone else’s mission', async () => {
        const owner = signIn('owner');
        await giveCareer(owner);
        const started = await missions.startMission({ type: MissionType.get_promoted });
        if (!started.success) throw new Error(started.error);

        signIn('intruder');
        expect((await missions.pauseMission(started.data.id)).success).toBe(false);
        expect((await missions.abandonMission(started.data.id)).success).toBe(false);
        expect(
            (
                await missions.setStepStatus({
                    missionId: started.data.id,
                    stepKey: 'conversation',
                    status: 'done',
                })
            ).success,
        ).toBe(false);
    });
});
