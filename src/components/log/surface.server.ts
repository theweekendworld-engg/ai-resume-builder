import { CaptureSourceStatus, Tier } from '@prisma/client';
import type { ProgressStage } from '@/components/patterns/progress-stages';
import { getUserTier } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import type { LogSurfaceState } from './data-source';

/**
 * The Work Log's connector state, read from the rows that hold it.
 *
 * Until 2026-09-27 this was hard-coded (`sourceConnected: true`, a fixed
 * `lastSyncedAt`), so the first-run "Connect GitHub" state could never render,
 * the sync progress never showed and a failed sync looked like success. Server
 * only: `data-source.ts` is also imported by the client screen, so the queries
 * live here.
 *
 * States, in order of precedence:
 *   - a sync is queued or running  → `syncing`, so the log says it is working
 *   - the source is in error        → `error`, with the stored message
 *   - otherwise                     → `idle`, with the real last sync time
 */
export async function loadLogSurface(userId: string): Promise<LogSurfaceState> {
    const [sources, tier] = await Promise.all([
        prisma.captureSource.findMany({
            where: { userId, status: { not: CaptureSourceStatus.revoked } },
            select: { id: true, status: true, lastSyncedAt: true, lastSuccessAt: true, lastError: true },
        }),
        getUserTier(userId).catch(() => Tier.free),
    ]);
    const plan: LogSurfaceState['plan'] = tier === Tier.free ? 'free' : 'career';

    if (sources.length === 0) {
        return { sourceConnected: false, sync: { state: 'idle', lastSyncedAt: null }, plan };
    }

    const sourceIds = sources.map((source) => source.id);
    const lastSyncedAt = sources
        .map((source) => source.lastSuccessAt ?? source.lastSyncedAt)
        .filter((date): date is Date => date instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const [running, queued] = await Promise.all([
        prisma.captureRun.findFirst({
            where: { userId, sourceId: { in: sourceIds }, status: 'running' },
            orderBy: { startedAt: 'desc' },
            select: { itemsScanned: true, candidates: true, winsDrafted: true },
        }),
        prisma.job.count({
            where: {
                kind: 'capture_sync',
                status: { in: ['pending', 'running'] },
                OR: sourceIds.map((sourceId) => ({ payload: { path: ['sourceId'], equals: sourceId } })),
            },
        }),
    ]);

    if (running || queued > 0) {
        const stages: ProgressStage[] = [
            {
                id: 'read',
                label: 'Reading merged pull requests and reviews',
                status: running && running.itemsScanned > 0 ? 'done' : 'active',
                result: running && running.itemsScanned > 0 ? `read ${running.itemsScanned}` : undefined,
            },
            {
                id: 'draft',
                label: 'Drafting your strongest wins',
                status: running && running.candidates > 0 ? 'active' : 'pending',
            },
            { id: 'review', label: 'Adding them here for you to review', status: 'pending' },
        ];
        return { sourceConnected: true, sync: { state: 'syncing', stages }, plan };
    }

    const failing = sources.find((source) => source.status === CaptureSourceStatus.error);
    if (failing) {
        return {
            sourceConnected: true,
            sync: {
                state: 'error',
                message: failing.lastError
                    ? `The last GitHub sync failed: ${failing.lastError.slice(0, 160)}`
                    : 'The last GitHub sync failed.',
                lastSyncedAt,
            },
            plan,
        };
    }

    return { sourceConnected: true, sync: { state: 'idle', lastSyncedAt }, plan };
}
