/**
 * `link_analysis` is charged for JOB analyses only (audit 2026-09-27, §K).
 *
 * The unit is still taken at start — the gate is what stops an exhausted
 * trial before anything is spent — but a run that classifies as anything other
 * than a job or hiring post gets it back, exactly once. Before this, a Work
 * Log note, a saved article or an "other" link each burned one of Free's three
 * analyses, while the run page told the user "Nothing was charged".
 *
 * The receipt lives in the run itself, under `result._meter`:
 *   { charged, refunded, chargedAt }
 * and every transition is a single conditional SQL statement, so a replayed
 * workflow step, two concurrent classify attempts or a refresh cannot refund
 * twice or charge twice.
 *
 * Refresh rule (`refreshCharge`): refreshing a JOB run is free if the run was
 * charged in the last 7 days — research is cached for 14–30 days, so a
 * refresh inside that window mostly re-reads the cache and re-scores fit for a
 * fraction of a cent. After 7 days a refresh is a new analysis and charges
 * once, resetting the clock. Refreshing a non-job run is always free.
 */

import { refundMeteredAction } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import type { ScoutKind } from '@/lib/scout/types';

export const METER_KEY = '_meter';
export const FREE_REFRESH_DAYS = 7;

/** The only kinds `link_analysis` pays for. */
export const CHARGEABLE_KINDS: ReadonlySet<ScoutKind> = new Set(['job_posting', 'hiring_post']);

export type MeterReceipt = { charged: boolean; refunded: boolean; chargedAt: string };

export function readMeter(result: unknown): MeterReceipt | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const raw = (result as Record<string, unknown>)[METER_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const meter = raw as Record<string, unknown>;
    return {
        charged: meter.charged === true,
        refunded: meter.refunded === true,
        chargedAt: typeof meter.chargedAt === 'string' ? meter.chargedAt : '',
    };
}

/** Record that this run holds one `link_analysis` unit. */
export async function recordCharge(runId: string, now: Date = new Date()): Promise<void> {
    const receipt: MeterReceipt = { charged: true, refunded: false, chargedAt: now.toISOString() };
    await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = COALESCE("result", '{}'::jsonb) || jsonb_build_object(${METER_KEY}::text, ${JSON.stringify(receipt)}::jsonb),
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
    `;
}

/**
 * Atomically flip the receipt to refunded. True exactly once per charge — the
 * caller refunds only when it wins this flip.
 */
async function claimRefund(runId: string): Promise<boolean> {
    const changed = await prisma.$executeRaw`
        UPDATE "AgentRun"
        SET "result" = jsonb_set("result", ARRAY[${METER_KEY}::text, 'refunded'], 'true'::jsonb),
            "updatedAt" = NOW()
        WHERE "id" = ${runId}
          AND "result"->${METER_KEY}->>'charged' = 'true'
          AND COALESCE("result"->${METER_KEY}->>'refunded', 'false') <> 'true'
    `;
    return changed > 0;
}

/**
 * Give the unit back, once. Used when classification says "not a job" and
 * when the run could not be started at all.
 */
export async function refundCharge(runId: string, userId: string, reason: string): Promise<boolean> {
    if (!(await claimRefund(runId))) return false;
    await refundMeteredAction(userId, 'link_analysis', { reason });
    return true;
}

/** Called when a run learns its kind. Non-job kinds get their unit back. */
export async function settleChargeForKind(runId: string, kind: ScoutKind): Promise<boolean> {
    if (CHARGEABLE_KINDS.has(kind)) return false;
    const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { userId: true } });
    if (!run) return false;
    return refundCharge(runId, run.userId, 'scout_not_a_job');
}

/**
 * Does refreshing this run cost a unit? Pure. Runs from before receipts
 * existed fall back to their creation time.
 */
export function refreshCharge(
    run: { kind: string | null; result: unknown; createdAt: Date },
    now: Date = new Date(),
): boolean {
    if (!run.kind || !CHARGEABLE_KINDS.has(run.kind as ScoutKind)) return false;
    const meter = readMeter(run.result);
    const lastCharged = meter?.chargedAt ? Date.parse(meter.chargedAt) : run.createdAt.getTime();
    if (!Number.isFinite(lastCharged)) return true;
    return now.getTime() - lastCharged > FREE_REFRESH_DAYS * 86_400_000;
}
