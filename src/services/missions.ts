/**
 * Mission persistence — the reading and writing either side of the evaluator.
 *
 * `src/lib/missions/evaluate.ts` is pure and holds every decision. This file
 * holds the queries that feed it and the writes that follow it, and it is
 * deliberately boring: if a rule shows up here that is not in the evaluator,
 * it is in the wrong place and it is untestable without a database.
 */

import {
    ApplicationStatus,
    MissionStatus,
    MissionStepStatus,
    MissionType,
    WinCategory,
    WinStatus,
    type Mission,
    type MissionStep,
    type Prisma,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
    missionTemplate,
    stepKindOf,
    type MissionTemplate,
    type StepCondition,
    type ThresholdQuery,
} from '@/lib/missions/catalog';
import {
    evaluateMission,
    type EvaluableStep,
    type MissionEvaluation,
    type MissionFacts,
} from '@/lib/missions/evaluate';

/**
 * Wins that evidence a management case (M5).
 *
 * `led`, `influenced` and `grew` are the three categories the ladder actually
 * asks about. `shipped` is excluded on purpose — shipping more is the IC case,
 * and counting it here would tell someone they are ready to manage because
 * they wrote more code.
 */
const LEADERSHIP_CATEGORIES: WinCategory[] = [
    WinCategory.led,
    WinCategory.influenced,
    WinCategory.grew,
];

/**
 * Reaching an interview. `offer` counts — you cannot get one without.
 *
 * `rejected` and `ghosted` do NOT, even though many of those were interviews,
 * because the column records where the application ENDED, not how far it got.
 * Counting them would inflate the number in the one direction that matters,
 * and the honest reading of an ambiguous row is the lower one.
 */
const INTERVIEW_STAGES: ApplicationStatus[] = [ApplicationStatus.interview, ApplicationStatus.offer];

/** Narrow a Json column to the record the config is supposed to be. */
function readConfig(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readGapCategory(config: Record<string, unknown>): WinCategory | null {
    const raw = config.gapCategory;
    return typeof raw === 'string' && raw in WinCategory ? (raw as WinCategory) : null;
}

/**
 * Run every threshold query the mission's steps actually use.
 *
 * Only the ones in use: a `keep_warm` mission has no reason to count
 * applications, and the evaluator treats a missing count as zero, so running
 * all five for every mission would be five round trips to answer questions
 * nobody asked.
 */
async function loadCounts(
    userId: string,
    mission: Pick<Mission, 'startedAt' | 'config'>,
    needed: ReadonlySet<ThresholdQuery>,
): Promise<Partial<Record<ThresholdQuery, number>>> {
    // Everything is measured from the moment the user committed. A mission is
    // a program you start, so wins from before it began are not progress
    // within it — counting them would show someone 60% complete on day one.
    const since = mission.startedAt ?? new Date();
    const config = readConfig(mission.config);
    const counts: Partial<Record<ThresholdQuery, number>> = {};

    const jobs: Array<Promise<void>> = [];

    if (needed.has('confirmed_wins_since_start')) {
        jobs.push(
            prisma.win
                .count({ where: { userId, status: WinStatus.confirmed, occurredAt: { gte: since } } })
                .then((n) => {
                    counts.confirmed_wins_since_start = n;
                }),
        );
    }

    if (needed.has('confirmed_wins_in_gap_category')) {
        const gap = readGapCategory(config);
        jobs.push(
            (gap
                ? prisma.win.count({
                      where: {
                          userId,
                          status: WinStatus.confirmed,
                          category: gap,
                          occurredAt: { gte: since },
                      },
                  })
                : // No gap identified yet — the readiness report has not run.
                  // Zero, not "all wins": the step is "close the gap the report
                  // named", and without a report there is no gap to close.
                  Promise.resolve(0)
            ).then((n) => {
                counts.confirmed_wins_in_gap_category = n;
            }),
        );
    }

    if (needed.has('applications_since_start')) {
        jobs.push(
            prisma.applicationWorkspace
                .count({
                    where: {
                        userId,
                        createdAt: { gte: since },
                        applicationStatus: {
                            // Opening a tab is not applying. Only workspaces
                            // that reached a submitted state count toward a
                            // pace target, or the number flatters the user.
                            notIn: [
                                ApplicationStatus.discovered,
                                ApplicationStatus.analyzed,
                                ApplicationStatus.drafting,
                                ApplicationStatus.in_progress,
                                ApplicationStatus.archived,
                            ],
                        },
                    },
                })
                .then((n) => {
                    counts.applications_since_start = n;
                }),
        );
    }

    if (needed.has('interviews_reached')) {
        jobs.push(
            prisma.applicationWorkspace
                .count({
                    where: { userId, createdAt: { gte: since }, applicationStatus: { in: INTERVIEW_STAGES } },
                })
                .then((n) => {
                    counts.interviews_reached = n;
                }),
        );
    }

    if (needed.has('leadership_wins')) {
        jobs.push(
            prisma.win
                .count({
                    where: {
                        userId,
                        status: WinStatus.confirmed,
                        category: { in: LEADERSHIP_CATEGORIES },
                        occurredAt: { gte: since },
                    },
                })
                .then((n) => {
                    counts.leadership_wins = n;
                }),
        );
    }

    await Promise.all(jobs);
    return counts;
}

/** Which product events have fired for this user since the mission started. */
async function loadEvents(
    userId: string,
    since: Date,
    needed: ReadonlySet<string>,
): Promise<Set<string>> {
    if (needed.size === 0) return new Set();
    const rows = await prisma.funnelEvent.findMany({
        where: { userId, type: { in: [...needed] }, occurredAt: { gte: since } },
        select: { type: true },
        distinct: ['type'],
    });
    return new Set(rows.map((row) => row.type));
}

function conditionOf(step: MissionStep): StepCondition {
    const raw = step.condition;
    return (raw && typeof raw === 'object' ? raw : { kind: 'attested' }) as unknown as StepCondition;
}

export type MissionWithSteps = Mission & { steps: MissionStep[] };

/** Gather the facts. No decisions here — that is the evaluator's job. */
export async function loadMissionFacts(mission: MissionWithSteps): Promise<MissionFacts> {
    const conditions = mission.steps.map(conditionOf);

    const thresholds = new Set<ThresholdQuery>(
        conditions.flatMap((c) => (c.kind === 'threshold' ? [c.query] : [])),
    );
    const events = new Set<string>(
        conditions.flatMap((c) => (c.kind === 'automatic' ? [c.event] : [])),
    );

    const [counts, eventsSinceStart] = await Promise.all([
        loadCounts(mission.userId, mission, thresholds),
        loadEvents(mission.userId, mission.startedAt ?? new Date(), events),
    ]);

    const steps: EvaluableStep[] = mission.steps.map((step) => ({
        key: step.key,
        order: step.order,
        kind: step.kind,
        status: step.status,
        condition: conditionOf(step),
    }));

    return {
        status: mission.status,
        startedAt: mission.startedAt,
        targetDate: mission.targetDate,
        counts,
        eventsSinceStart,
        steps,
    };
}

/**
 * Persist an evaluation.
 *
 * Writes only what changed. The evaluator runs on every mission view, and
 * issuing six no-op UPDATEs per page load would put `updatedAt` churn on the
 * index the Home query orders by.
 */
export async function applyEvaluation(
    mission: MissionWithSteps,
    evaluation: MissionEvaluation,
    now: Date,
): Promise<void> {
    const byKey = new Map(mission.steps.map((step) => [step.key, step]));
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    for (const evaluated of evaluation.steps) {
        const row = byKey.get(evaluated.key);
        if (!row) continue;

        const progressChanged =
            JSON.stringify(row.progress ?? {}) !== JSON.stringify(evaluated.progress);
        const statusChanged = row.status !== evaluated.status;
        if (!progressChanged && !statusChanged) continue;

        writes.push(
            prisma.missionStep.update({
                where: { id: row.id },
                data: {
                    status: evaluated.status,
                    progress: evaluated.progress as unknown as Prisma.InputJsonValue,
                    // Set once. Re-deriving it on every pass would move the
                    // date every time the page loaded.
                    completedAt:
                        evaluated.status === MissionStepStatus.done
                            ? (row.completedAt ?? now)
                            : null,
                },
            }),
        );
    }

    if (writes.length > 0) await prisma.$transaction(writes);
}

/** Read, evaluate, persist. The one entry point everything else calls. */
export async function refreshMission(
    mission: MissionWithSteps,
    now: Date = new Date(),
): Promise<MissionEvaluation> {
    const facts = await loadMissionFacts(mission);
    const evaluation = evaluateMission(facts, now);
    await applyEvaluation(mission, evaluation, now);
    return evaluation;
}

/**
 * Create a mission from its template.
 *
 * The steps are COPIED, never referenced. A template that changes in a later
 * release must not reorder or rename the steps of a mission somebody is three
 * months into (§6).
 */
export function stepsFromTemplate(template: MissionTemplate): Prisma.MissionStepCreateWithoutMissionInput[] {
    return template.steps.map((step, index) => ({
        key: step.key,
        title: step.title,
        order: index,
        kind: stepKindOf(step.condition),
        condition: step.condition as unknown as Prisma.InputJsonValue,
    }));
}

/**
 * The one mission occupying the slot, if any.
 *
 * §2 rule 1 is about ACTIVE missions — "at most one active Mission at a time
 * (plus an always-implicit keep-warm background loop)". Paused deliberately
 * does not count, and that distinction is load-bearing rather than pedantic:
 * §2 rule 2 says a mission can be paused without guilt, which is hollow if
 * pausing still blocks you from starting anything else. Someone who parks
 * "get promoted" for a quarter to run a job search has done exactly what the
 * feature invites.
 *
 * `keep_warm` is excluded because it is the resting state, not a goal.
 */
export async function activeMission(userId: string): Promise<MissionWithSteps | null> {
    return prisma.mission.findFirst({
        where: { userId, status: MissionStatus.active, type: { not: MissionType.keep_warm } },
        include: { steps: { orderBy: { order: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
    });
}

/**
 * What Home should render.
 *
 * The active mission, or — failing that — the most recently touched paused
 * one. Showing the paused mission matters: it is the only route back to
 * resuming it, and a paused mission that vanishes from the surface is
 * abandoned in practice whatever the column says.
 */
export async function currentMission(userId: string): Promise<MissionWithSteps | null> {
    const active = await activeMission(userId);
    if (active) return active;

    return prisma.mission.findFirst({
        where: { userId, status: MissionStatus.paused, type: { not: MissionType.keep_warm } },
        include: { steps: { orderBy: { order: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
    });
}

/** The always-on background mission. Everyone has exactly one, created lazily. */
export async function ensureKeepWarm(userId: string): Promise<MissionWithSteps> {
    const existing = await prisma.mission.findFirst({
        where: { userId, type: MissionType.keep_warm },
        include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (existing) return existing;

    const template = missionTemplate(MissionType.keep_warm);
    if (!template) throw new Error('keep_warm has no template');

    return prisma.mission.create({
        data: {
            userId,
            type: MissionType.keep_warm,
            status: MissionStatus.active,
            title: template.label,
            startedAt: new Date(),
            steps: { create: stepsFromTemplate(template) },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
    });
}
