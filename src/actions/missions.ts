'use server';

/**
 * Missions (PRD 05).
 *
 * A Mission is a goal the user commits to, decomposed into steps that complete
 * themselves from real product activity. Every decision about *whether* a step
 * is done lives in `src/lib/missions/evaluate.ts` and is pure; every query that
 * feeds it lives in `src/services/missions.ts`. This file is the door: auth,
 * validation, entitlement, the state machine, and telemetry.
 *
 * Three rules from the PRD are enforced here rather than in the UI, because a
 * rule enforced in a component is a rule one new caller away from being gone:
 *
 *   At most one active mission (§2 rule 1). Two active missions means neither
 *   is real, so starting one while another runs is refused with the name of
 *   the one in the way — not silently swapped.
 *
 *   Missions never block anything (§2 rule 3). Nothing in here gates any other
 *   surface. A Mission is a recommended path, never a wizard cage.
 *
 *   Completion always asks for the outcome (§2 rule 4). `completeMission`
 *   requires a result and will not infer one, because that single honest
 *   question at the end of every mission is the outcome dataset nobody else
 *   has.
 */

import { auth } from '@clerk/nextjs/server';
import { MissionStatus, MissionStepStatus, MissionType, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { isEnabled } from '@/lib/flags';
import { getUserTier, hasFeature } from '@/lib/entitlements';
import { planName, tierRequiredFor } from '@/lib/plans';
import { track } from '@/lib/track';
import {
    MISSION_FEATURE,
    MISSION_RESULTS,
    SELECTABLE_MISSIONS,
    isBuiltMissionType,
    missionTemplate,
    type MissionResult,
    type MissionTemplate,
} from '@/lib/missions/catalog';
import type { MissionEvaluation } from '@/lib/missions/evaluate';
import { isReadyToComplete } from '@/lib/missions/evaluate';
import {
    activeMission,
    currentMission,
    ensureKeepWarm,
    refreshMission,
    stepsFromTemplate,
    type MissionWithSteps,
} from '@/services/missions';

const FEATURE = { feature: 'missions' } as const;

const IdSchema = z.string().min(1).max(64);

export type MissionStepView = {
    key: string;
    title: string;
    hint: string | null;
    status: MissionStepStatus;
    /** Only ever set on threshold steps. */
    progress: { current: number; target: number } | null;
    /** Attested steps are the only ones a user may tick by hand. */
    userActionable: boolean;
};

export type MissionView = {
    id: string;
    type: MissionType;
    title: string;
    status: MissionStatus;
    targetDate: Date | null;
    percent: number;
    activeStepKey: string | null;
    overdue: boolean;
    readyToComplete: boolean;
    steps: MissionStepView[];
};

export type MissionOption = {
    type: MissionType;
    label: string;
    blurb: string;
    durationLabel: string;
    /** False when the plan does not include the capability this mission runs on. */
    available: boolean;
    /** Set when `available` is false — the plan that would unlock it. */
    requiredPlan: string | null;
};

export type HomeView = {
    mission: MissionView | null;
    /** Offered when there is no current mission. Never a nag — see §5.3. */
    options: MissionOption[];
};

// ───────────────────────────────────────────────────────────── helpers

async function requireUser(): Promise<Result<string>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await isEnabled(userId, 'missions'))) return err('Not available yet', 'not_found');
    return ok(userId);
}

function hintFor(template: MissionTemplate | null, key: string): string | null {
    return template?.steps.find((step) => step.key === key)?.hint ?? null;
}

function toView(
    mission: MissionWithSteps,
    evaluation: MissionEvaluation,
): MissionView {
    const template = missionTemplate(mission.type);
    const byKey = new Map(mission.steps.map((step) => [step.key, step]));

    return {
        id: mission.id,
        type: mission.type,
        title: mission.title,
        status: mission.status,
        targetDate: mission.targetDate,
        percent: evaluation.percent,
        activeStepKey: evaluation.activeStepKey,
        overdue: evaluation.overdue,
        readyToComplete: isReadyToComplete(evaluation, mission.status),
        steps: evaluation.steps.map((evaluated) => {
            const row = byKey.get(evaluated.key);
            const progress =
                typeof evaluated.progress.current === 'number' &&
                typeof evaluated.progress.target === 'number'
                    ? { current: evaluated.progress.current, target: evaluated.progress.target }
                    : null;
            return {
                key: evaluated.key,
                title: row?.title ?? evaluated.key,
                hint: hintFor(template, evaluated.key),
                status: evaluated.status,
                progress,
                // Only attested steps. Letting someone tick an automatic step
                // by hand would let the mission disagree with the log, which
                // is the one thing it must never do.
                userActionable: row?.kind === 'attested',
            };
        }),
    };
}

// ───────────────────────────────────────────────────────────── reads

/**
 * The Home surface (§5.2).
 *
 * Evaluates on view, which is one of the three triggers §6.1 names. That is
 * deliberate and cheap: it means the card is never stale, and it means a step
 * that completed through an event we did not hook still shows as done the next
 * time the user looks.
 */
export async function getHome(): Promise<Result<HomeView>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);
    const userId = auth.data;

    // Everyone has the resting state from day one, whether or not they ever
    // pick a goal.
    await ensureKeepWarm(userId);

    const [mission, tier] = await Promise.all([currentMission(userId), getUserTier(userId)]);

    const options: MissionOption[] = SELECTABLE_MISSIONS.flatMap((type) => {
        const template = missionTemplate(type);
        if (!template) return [];
        const feature = isBuiltMissionType(type) ? MISSION_FEATURE[type] : null;
        const available = feature === null || hasFeature(tier, feature);
        return [
            {
                type,
                label: template.label,
                blurb: template.blurb,
                durationLabel: template.durationLabel,
                available,
                // Plan NAME, never the raw Tier enum (CLAUDE.md rule 4).
                requiredPlan: available || feature === null ? null : planName(tierRequiredFor(feature)),
            },
        ];
    });

    if (!mission) return ok({ mission: null, options });

    const evaluation = await refreshMission(mission);
    await track(userId, 'mission_step_completed', {
        ...FEATURE,
        // Viewing is not completing; this records the evaluated shape so we can
        // see where missions stall. `newlyCompleted` is what a nudge keys off.
        missionType: mission.type,
        percent: evaluation.percent,
        newlyCompleted: evaluation.steps.filter((step) => step.newlyCompleted).map((step) => step.key),
    });

    return ok({ mission: toView(mission, evaluation), options });
}

// ───────────────────────────────────────────────────────────── writes

export async function startMission(input: {
    type: MissionType;
    title?: string;
    targetDate?: Date | null;
}): Promise<Result<MissionView>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);
    const userId = auth.data;

    const parsed = z
        .object({
            type: z.nativeEnum(MissionType),
            title: z.string().trim().min(1).max(120).optional(),
            targetDate: z.date().nullable().optional(),
        })
        .safeParse(input);
    if (!parsed.success) return err('That mission is not one we run', 'invalid_input');

    const { type } = parsed.data;
    if (!SELECTABLE_MISSIONS.includes(type)) {
        return err('That mission is not one you can start', 'invalid_input');
    }

    const template = missionTemplate(type);
    if (!template) return err('That mission is not available yet', 'not_found');

    const feature = isBuiltMissionType(type) ? MISSION_FEATURE[type] : null;
    if (feature !== null) {
        const tier = await getUserTier(userId);
        if (!hasFeature(tier, feature)) {
            await track(userId, 'paywall_shown', { ...FEATURE, missionType: type });
            return err(`${template.label} needs ${planName(tierRequiredFor(feature))}`, 'upgrade_required');
        }
    }

    // §2 rule 1, and only rule 1: an ACTIVE mission blocks, a paused one does
    // not. Refused by name rather than swapped, because silently ending a
    // three-month program to start another is not a decision to make on
    // someone's behalf.
    const existing = await activeMission(userId);
    if (existing) {
        return err(
            `You are already working on “${existing.title}”. Finish or pause it first.`,
            'conflict',
        );
    }

    const mission = await prisma.mission.create({
        data: {
            userId,
            type,
            status: MissionStatus.active,
            title: parsed.data.title?.trim() || template.label,
            targetDate: parsed.data.targetDate ?? null,
            startedAt: new Date(),
            steps: { create: stepsFromTemplate(template) },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
    });

    await track(userId, 'mission_started', { ...FEATURE, missionType: type });

    const evaluation = await refreshMission(mission);
    return ok(toView(mission, evaluation));
}

async function ownedMission(userId: string, missionId: string): Promise<MissionWithSteps | null> {
    return prisma.mission.findFirst({
        where: { id: missionId, userId },
        include: { steps: { orderBy: { order: 'asc' } } },
    });
}

async function setStatus(
    missionId: string,
    status: MissionStatus,
    extra: Prisma.MissionUpdateInput = {},
): Promise<void> {
    await prisma.mission.update({ where: { id: missionId }, data: { status, ...extra } });
}

export async function pauseMission(missionId: string): Promise<Result<null>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);
    if (!IdSchema.safeParse(missionId).success) return err('Unknown mission', 'invalid_input');

    const mission = await ownedMission(auth.data, missionId);
    if (!mission) return err('Unknown mission', 'not_found');
    if (mission.status !== MissionStatus.active) return err('That mission is not running', 'conflict');

    // §2 rule 2: pausing is not a failure state. Nothing is reset, no progress
    // is lost, and `pausedAt` exists only so we can say "paused since March"
    // rather than to compute a penalty.
    await setStatus(missionId, MissionStatus.paused, { pausedAt: new Date() });
    await track(auth.data, 'mission_paused', { ...FEATURE, missionType: mission.type });
    return ok(null);
}

export async function resumeMission(missionId: string): Promise<Result<null>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);
    if (!IdSchema.safeParse(missionId).success) return err('Unknown mission', 'invalid_input');

    const mission = await ownedMission(auth.data, missionId);
    if (!mission) return err('Unknown mission', 'not_found');
    if (mission.status !== MissionStatus.paused) return err('That mission is not paused', 'conflict');

    const other = await activeMission(auth.data);
    if (other && other.id !== missionId) {
        return err(`You are already working on “${other.title}”.`, 'conflict');
    }

    await setStatus(missionId, MissionStatus.active, { pausedAt: null });
    await track(auth.data, 'mission_resumed', { ...FEATURE, missionType: mission.type });
    return ok(null);
}

/**
 * Tick, untick or skip a step.
 *
 * Only attested steps. An automatic or threshold step is derived from the log,
 * and letting someone hand-complete one would let the mission claim evidence
 * the log does not contain — the same failure the evaluator's reopen rule
 * exists to prevent, arriving through the front door instead.
 */
export async function setStepStatus(input: {
    missionId: string;
    stepKey: string;
    status: 'done' | 'pending' | 'skipped';
}): Promise<Result<MissionView>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);

    const parsed = z
        .object({
            missionId: IdSchema,
            stepKey: z.string().min(1).max(64),
            status: z.enum(['done', 'pending', 'skipped']),
        })
        .safeParse(input);
    if (!parsed.success) return err('Unknown step', 'invalid_input');

    const mission = await ownedMission(auth.data, parsed.data.missionId);
    if (!mission) return err('Unknown mission', 'not_found');

    const step = mission.steps.find((row) => row.key === parsed.data.stepKey);
    if (!step) return err('Unknown step', 'not_found');

    const skipping = parsed.data.status === 'skipped';
    if (!skipping && step.kind !== 'attested') {
        return err('That step completes itself from your log', 'invalid_input');
    }

    const next = MissionStepStatus[parsed.data.status];
    await prisma.missionStep.update({
        where: { id: step.id },
        data: {
            status: next,
            completedAt: next === MissionStepStatus.done ? (step.completedAt ?? new Date()) : null,
        },
    });

    if (next === MissionStepStatus.done) {
        await track(auth.data, 'mission_step_completed', {
            ...FEATURE,
            missionType: mission.type,
            stepKey: step.key,
            attested: true,
        });
    }

    const fresh = await ownedMission(auth.data, parsed.data.missionId);
    if (!fresh) return err('Unknown mission', 'not_found');
    return ok(toView(fresh, await refreshMission(fresh)));
}

/**
 * Finish a mission by answering the one question that matters.
 *
 * §2 rule 4. `result` is required and has no default: a mission that completes
 * itself with an assumed outcome produces a dataset that says whatever we
 * guessed, which is worse than no dataset. "not_yet" is a first-class answer,
 * and it is the highest-intent moment in the product — the caller decides what
 * to offer next, and §3 M1 is explicit that it must be handled with care
 * rather than a hard sell.
 */
export async function completeMission(input: {
    missionId: string;
    result: MissionResult;
    note?: string;
}): Promise<Result<null>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);

    const parsed = z
        .object({
            missionId: IdSchema,
            result: z.enum(MISSION_RESULTS),
            note: z.string().trim().max(2000).optional(),
        })
        .safeParse(input);
    if (!parsed.success) return err('Tell us how it went first', 'invalid_input');

    const mission = await ownedMission(auth.data, parsed.data.missionId);
    if (!mission) return err('Unknown mission', 'not_found');
    if (mission.status === MissionStatus.completed) return err('Already finished', 'conflict');

    await setStatus(parsed.data.missionId, MissionStatus.completed, {
        completedAt: new Date(),
        outcome: {
            result: parsed.data.result,
            reportedAt: new Date().toISOString(),
            note: parsed.data.note ?? null,
        } as unknown as Prisma.InputJsonValue,
    });

    await track(auth.data, 'mission_completed', {
        ...FEATURE,
        missionType: mission.type,
        result: parsed.data.result,
    });
    return ok(null);
}

/** Give up on a mission without recording an outcome. Not a failure, just an end. */
export async function abandonMission(missionId: string): Promise<Result<null>> {
    const auth = await requireUser();
    if (!auth.success) return err(auth.error, auth.code);
    if (!IdSchema.safeParse(missionId).success) return err('Unknown mission', 'invalid_input');

    const mission = await ownedMission(auth.data, missionId);
    if (!mission) return err('Unknown mission', 'not_found');

    await setStatus(missionId, MissionStatus.abandoned, { completedAt: new Date() });
    await track(auth.data, 'mission_abandoned', { ...FEATURE, missionType: mission.type });
    return ok(null);
}
