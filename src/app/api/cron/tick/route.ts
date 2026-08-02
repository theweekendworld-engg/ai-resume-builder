/**
 * The single cron entry point (ADR-2). A dispatcher, not a worker.
 *
 * GET  — Vercel Cron and external pingers (cron-job.org) issue GET.
 * POST — the self-retrigger, and manual/ops invocation.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, constant-time compare. Vercel
 * sets this header automatically on scheduled invocations when CRON_SECRET is
 * present in the project's environment.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
    CHAIN_DEPTH_HEADER,
    MAX_CHAIN_DEPTH,
    cronTickUrl,
    drain,
    parseChainDepth,
    resolveBatchSize,
    resolveBudgetMs,
    shouldRetrigger,
    verifyCronSecret,
} from '@/lib/jobs/runner';
import { registerAllHandlers } from '@/lib/jobs/registry';
import { scheduleDigestWork } from '@/lib/jobs/handlers/weeklyDigest';
import { schedulePeriodicWork } from '@/lib/jobs/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Ceiling only — the drain stops claiming at CRON_TIME_BUDGET_MS well before this. */
export const maxDuration = 300;

function resolveBaseUrl(req: NextRequest): string {
    return (
        process.env.APP_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        new URL(req.url).origin
    );
}

/**
 * Fire-and-forget chained tick. Deliberately not awaited: the current
 * invocation must return inside its function timeout, and the next tick is
 * an independent invocation with its own budget.
 */
function selfRetrigger(req: NextRequest, nextDepth: number): void {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) return;

    let url: string;
    try {
        url = cronTickUrl(resolveBaseUrl(req));
    } catch (error: unknown) {
        console.error('[cron/tick] cannot resolve self URL for retrigger', error);
        return;
    }

    void fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            [CHAIN_DEPTH_HEADER]: String(nextDepth),
        },
        cache: 'no-store',
    }).catch((error: unknown) => {
        // A dropped chain is not a lost job — the next hourly tick picks it up.
        console.error('[cron/tick] self-retrigger failed', error);
    });
}

async function handleTick(req: NextRequest): Promise<NextResponse> {
    if (!verifyCronSecret(req.headers.get('authorization'))) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    registerAllHandlers();

    const depth = parseChainDepth(req.headers.get(CHAIN_DEPTH_HEADER));
    const budgetMs = resolveBudgetMs();
    const batchSize = resolveBatchSize();

    // Derived scheduling (ADR-3). Only the FIRST tick of a chain schedules:
    // a self-retrigger is the same hour continuing, and the hour-granular
    // dedupe keys would no-op anyway — this just saves the queries.
    //
    // Enqueued before the drain on purpose, so this invocation drains what it
    // just scheduled instead of leaving the digest an hour late.
    let scheduled: Awaited<ReturnType<typeof scheduleDigestWork>> | null = null;
    let periodic: Awaited<ReturnType<typeof schedulePeriodicWork>> | null = null;
    if (depth === 0) {
        try {
            scheduled = await scheduleDigestWork();
        } catch (error: unknown) {
            // Scheduling is additive. A failure here must not stop the drain,
            // which is what recovers stuck jobs and retries dead letters.
            console.error('[cron/tick] digest scheduling failed', error);
        }
        // Mission nudges and the monthly Radar snapshot. Both handlers existed
        // with nothing to fire them — a handler with no scheduler is as dead as
        // a job kind with no handler, and harder to spot because it looks done.
        try {
            periodic = await schedulePeriodicWork();
        } catch (error: unknown) {
            console.error('[cron/tick] periodic scheduling failed', error);
        }
    }

    let result;
    try {
        result = await drain(budgetMs, batchSize);
    } catch (error: unknown) {
        console.error('[cron/tick] drain failed', error);
        return NextResponse.json(
            { ok: false, depth, error: error instanceof Error ? error.message : 'drain failed' },
            { status: 500 },
        );
    }

    const retriggered = shouldRetrigger({ workRemaining: result.workRemaining, depth });
    if (retriggered) selfRetrigger(req, depth + 1);

    return NextResponse.json({
        ok: true,
        depth,
        maxDepth: MAX_CHAIN_DEPTH,
        retriggered,
        scheduled,
        periodic,
        ...result,
    });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    return handleTick(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    return handleTick(req);
}
