/**
 * `mission_nudge` — the weekly (or twice-weekly) mission prompt, PRD 05 §7.
 *
 * Two modes, matching the shape every other fan-out handler uses:
 *
 *   `{}`          dispatch: enqueue one child per user with a running mission
 *   `{ userId }`  evaluate that mission and, if it warrants one, send
 *
 * The fan-out is mandatory (impl/00 §P-2), not stylistic: composing N users'
 * nudges in one invocation is one slow user away from nobody getting mail.
 *
 * ── What this handler does NOT decide ───────────────────────────────────────
 *
 * Whether the user has room for another message this week. That is the global
 * budget in `lib/notifications/budget.ts`, enforced inside `sendEmail`, and
 * deliberately not duplicated here — two places implementing the same limit is
 * how you get a limit that is enforced in one of them.
 *
 * What it DOES decide is whether there is anything worth saying, which is a
 * different question and a stricter one.
 */

import { z } from 'zod';
import { MissionStatus, MissionType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { sendEmail } from '@/lib/email/send';
import { config } from '@/lib/config';
import { isEnabled } from '@/lib/flags';
import { missionTemplate } from '@/lib/missions/catalog';
import { refreshMission } from '@/services/missions';

export const MISSION_NUDGE_JOB_KIND = 'mission_nudge' as const;

const PayloadSchema = z.object({
    userId: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(5_000).default(1_000),
});

/**
 * Cadence per mission type, in days (§7).
 *
 * "Twice weekly" for a job hunt is not us being noisier; it is that the pace
 * only means something if it is checked against reality more than once a week.
 * The global budget still caps the total, so a busy week silently drops the
 * second one rather than pushing the user to four messages.
 */
const CADENCE_DAYS: Partial<Record<MissionType, number>> = {
    [MissionType.get_promoted]: 7,
    [MissionType.land_new_role]: 3,
    [MissionType.switch_domain]: 14,
    [MissionType.ic_to_manager]: 14,
    [MissionType.return_from_break]: 7,
    // keep_warm is not nudged at all: §3 M7 says its cadence IS the weekly
    // digest and the monthly Radar. A third message about the resting state
    // would be interrupting someone to tell them nothing is happening.
};

function cadenceFor(type: MissionType): number | null {
    return CADENCE_DAYS[type] ?? null;
}

/** Users with a running mission that has a nudge cadence. */
export async function dueUserIds(limit: number): Promise<string[]> {
    const rows = await prisma.mission.findMany({
        where: {
            status: MissionStatus.active,
            type: { in: Object.keys(CADENCE_DAYS) as MissionType[] },
        },
        select: { userId: true },
        distinct: ['userId'],
        take: limit,
    });
    return rows.map((row) => row.userId);
}

async function dispatch(limit: number, ctx: JobContext): Promise<JobResultObject> {
    const userIds = await dueUserIds(limit);
    // Per user per day. The cadence check inside `sendOne` is what spaces them
    // properly; this key only stops a double-fired cron becoming two nudges.
    const day = new Date().toISOString().slice(0, 10);

    let enqueued = 0;
    for (const userId of userIds) {
        const { deduped } = await ctx.enqueue(
            MISSION_NUDGE_JOB_KIND,
            { userId },
            { dedupeKey: buildDedupeKey(MISSION_NUDGE_JOB_KIND, [userId, day]) },
        );
        if (!deduped) enqueued += 1;
    }

    return { mode: 'dispatch', due: userIds.length, enqueued };
}

function wholeWeeksUntil(target: Date | null, now: Date): number | null {
    if (!target) return null;
    return Math.floor((target.getTime() - now.getTime()) / (7 * 86_400_000));
}

async function sendOne(userId: string): Promise<JobResultObject> {
    if (!(await isEnabled(userId, 'missions'))) return { mode: 'send', skipped: 'flag_off' };

    const mission = await prisma.mission.findFirst({
        where: {
            userId,
            status: MissionStatus.active,
            type: { not: MissionType.keep_warm },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
    });
    // Paused missions are not nudged. §2 rule 2 — pausing has to actually stop
    // the pressure, or it is a setting that does nothing.
    if (!mission) return { mode: 'send', skipped: 'no_active_mission' };

    const cadence = cadenceFor(mission.type);
    if (cadence === null) return { mode: 'send', skipped: 'no_cadence' };

    const now = new Date();

    // Space nudges by the mission's own cadence, measured from the last one we
    // actually sent. Keyed off EmailSend rather than a column on Mission so a
    // send that failed at the provider does not silently reset the clock.
    const lastNudge = await prisma.emailSend.findFirst({
        where: { userId, template: 'mission_nudge' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });
    if (lastNudge && now.getTime() - lastNudge.createdAt.getTime() < cadence * 86_400_000) {
        return { mode: 'send', skipped: 'too_soon' };
    }

    const evaluation = await refreshMission(mission, now);

    // Nothing outstanding means nothing to nudge about. The completion prompt
    // lives on Home; chasing someone by email to click "I got it" would be
    // spending the budget on our own bookkeeping.
    if (!evaluation.activeStepKey) return { mode: 'send', skipped: 'nothing_outstanding' };

    const activeStep = evaluation.steps.find((step) => step.key === evaluation.activeStepKey);
    const row = mission.steps.find((step) => step.key === evaluation.activeStepKey);
    if (!activeStep || !row) return { mode: 'send', skipped: 'no_active_step' };

    // An attested step is waiting on the user to have a conversation, not to
    // log anything. Nudging weekly about "have you spoken to your manager yet"
    // is the single most irritating message this product could send.
    if (row.kind === 'attested') return { mode: 'send', skipped: 'awaiting_user_action' };

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { email: true },
    });
    if (!profile?.email) return { mode: 'send', skipped: 'no_email' };

    const template = missionTemplate(mission.type);
    const appUrl = config.app.url;

    const result = await sendEmail({
        userId,
        to: profile.email,
        template: 'mission_nudge',
        data: {
            missionTitle: mission.title,
            stepTitle: row.title,
            stepHint: template?.steps.find((step) => step.key === row.key)?.hint ?? null,
            progress:
                typeof activeStep.progress.current === 'number' &&
                typeof activeStep.progress.target === 'number'
                    ? { current: activeStep.progress.current, target: activeStep.progress.target }
                    : null,
            weeksRemaining: wholeWeeksUntil(mission.targetDate, now),
            missionUrl: `${appUrl}/home`,
            logUrl: `${appUrl}/log?compose=1&src=mission`,
        },
        idempotencyKey: `mission_nudge:${mission.id}:${now.toISOString().slice(0, 10)}`,
    });

    return {
        mode: 'send',
        status: result.status,
        missionType: mission.type,
        stepKey: row.key,
        // `budget_exhausted` here is the system working, not a failure. It is
        // reported so a category that is always dropped shows up as a cadence
        // problem rather than as silence.
        reason: result.status === 'skipped' ? result.reason : undefined,
    };
}

export const missionNudgeHandler: JobHandler = async (payload, ctx) => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) throw new Error('mission_nudge: invalid payload');

    const { userId, limit } = parsed.data;
    return userId ? sendOne(userId) : dispatch(limit, ctx);
};

/** Exported for the test that asserts the resting state is never nudged. */
export const __testing = { CADENCE_DAYS, cadenceFor };
