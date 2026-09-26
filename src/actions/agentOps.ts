'use server';

/**
 * Operator view of agent runs (docs/impl/06-scout-agent.md §5).
 *
 * Built entirely from `AgentRun` / `AgentStep` / `ApiUsageLog` — the same rows
 * the user's own timeline reads, so there is no second telemetry pipeline to
 * drift from what users actually saw.
 */

import { Prisma } from '@prisma/client';
import { requireAdminUserId } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';

export type AgentStepStats = {
    name: string;
    total: number;
    succeeded: number;
    unavailable: number;
    failed: number;
    skipped: number;
    p50Ms: number | null;
    p95Ms: number | null;
    avgCostUsd: number;
};

export type AgentRunsSnapshot = {
    generatedAt: Date;
    windowHours: number;
    runs: { status: string; n: number }[];
    kinds: { kind: string | null; n: number; avgCostUsd: number; p50Ms: number | null }[];
    steps: AgentStepStats[];
    topReasons: { name: string; reason: string; n: number }[];
    recentProblems: { id: string; userId: string; status: string; kind: string | null; error: string | null; createdAt: Date; costUsd: number }[];
    cache: { total: number; live: number; byKind: { kind: string; n: number }[] };
};

function since(hours: number): Date {
    return new Date(Date.now() - hours * 3_600_000);
}

export async function getAgentRunsSnapshot(windowHours = 24, agent = 'scout'): Promise<AgentRunsSnapshot> {
    await requireAdminUserId();
    const from = since(windowHours);

    const [runs, kinds, steps, topReasons, recentProblems, cacheTotal, cacheLive, cacheByKind] = await Promise.all([
        prisma.agentRun.groupBy({
            by: ['status'],
            where: { agent, createdAt: { gte: from } },
            _count: { _all: true },
        }),
        prisma.$queryRaw<{ kind: string | null; n: bigint; avg_cost: number | null; p50: number | null }[]>`
            SELECT "kind", COUNT(*) AS n, AVG("costUsd") AS avg_cost,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000) AS p50
            FROM "AgentRun"
            WHERE "agent" = ${agent} AND "createdAt" >= ${from}
            GROUP BY "kind" ORDER BY n DESC
        `,
        prisma.$queryRaw<{
            name: string; total: bigint; succeeded: bigint; unavailable: bigint; failed: bigint; skipped: bigint;
            p50: number | null; p95: number | null; avg_cost: number | null;
        }[]>`
            SELECT s."name",
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE s."status" = 'succeeded') AS succeeded,
                   COUNT(*) FILTER (WHERE s."status" = 'unavailable') AS unavailable,
                   COUNT(*) FILTER (WHERE s."status" = 'failed') AS failed,
                   COUNT(*) FILTER (WHERE s."status" = 'skipped') AS skipped,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY s."latencyMs") AS p50,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY s."latencyMs") AS p95,
                   AVG(s."costUsd") AS avg_cost
            FROM "AgentStep" s JOIN "AgentRun" r ON r."id" = s."runId"
            WHERE r."agent" = ${agent} AND s."startedAt" >= ${from}
            GROUP BY s."name" ORDER BY total DESC
        `,
        prisma.$queryRaw<{ name: string; reason: string; n: bigint }[]>`
            SELECT s."name", COALESCE(s."reason", s."error", '(none)') AS reason, COUNT(*) AS n
            FROM "AgentStep" s JOIN "AgentRun" r ON r."id" = s."runId"
            WHERE r."agent" = ${agent} AND s."startedAt" >= ${from}
              AND s."status" IN ('failed', 'unavailable')
            GROUP BY s."name", 2 ORDER BY n DESC LIMIT 15
        `,
        prisma.agentRun.findMany({
            where: { agent, createdAt: { gte: from }, status: { in: ['failed', 'partial'] } },
            orderBy: { createdAt: 'desc' },
            take: 25,
            select: { id: true, userId: true, status: true, kind: true, error: true, createdAt: true, costUsd: true },
        }),
        prisma.researchCache.count(),
        prisma.researchCache.count({ where: { expiresAt: { gt: new Date() } } }),
        prisma.researchCache.groupBy({ by: ['kind'], _count: { _all: true } }),
    ]);

    const num = (value: bigint | number | null) => (value === null ? 0 : Number(value));
    const orNull = (value: number | null) => (value === null ? null : Number(value));

    return {
        generatedAt: new Date(),
        windowHours,
        runs: runs.map((row) => ({ status: row.status, n: row._count._all })),
        kinds: kinds.map((row) => ({ kind: row.kind, n: num(row.n), avgCostUsd: num(row.avg_cost), p50Ms: orNull(row.p50) })),
        steps: steps.map((row) => ({
            name: row.name,
            total: num(row.total),
            succeeded: num(row.succeeded),
            unavailable: num(row.unavailable),
            failed: num(row.failed),
            skipped: num(row.skipped),
            p50Ms: orNull(row.p50),
            p95Ms: orNull(row.p95),
            avgCostUsd: num(row.avg_cost),
        })),
        topReasons: topReasons.map((row) => ({ name: row.name, reason: row.reason, n: num(row.n) })),
        recentProblems,
        cache: {
            total: cacheTotal,
            live: cacheLive,
            byKind: cacheByKind.map((row) => ({ kind: row.kind, n: row._count._all })),
        },
    };
}

export type AgentRunTrace = {
    run: { id: string; userId: string; agent: string; status: string; kind: string | null; input: Prisma.JsonValue; error: string | null; costUsd: number; createdAt: Date; finishedAt: Date | null; workflowRunId: string | null };
    steps: { id: string; name: string; status: string; attempt: number; reason: string | null; error: string | null; latencyMs: number | null; costUsd: number; sources: Prisma.JsonValue; startedAt: Date }[];
    modelCalls: { operation: string; model: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; latencyMs: number | null; status: string | null; createdAt: Date }[];
};

/** One run end to end: steps, then every model call it made (joined by sessionId). */
export async function getAgentRunTrace(runId: string): Promise<AgentRunTrace | null> {
    await requireAdminUserId();
    const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { id: true, userId: true, agent: true, status: true, kind: true, input: true, error: true, costUsd: true, createdAt: true, finishedAt: true, workflowRunId: true },
    });
    if (!run) return null;
    const [steps, modelCalls] = await Promise.all([
        prisma.agentStep.findMany({
            where: { runId },
            orderBy: { startedAt: 'asc' },
            select: { id: true, name: true, status: true, attempt: true, reason: true, error: true, latencyMs: true, costUsd: true, sources: true, startedAt: true },
        }),
        prisma.apiUsageLog.findMany({
            where: { sessionId: runId },
            orderBy: { createdAt: 'asc' },
            select: { operation: true, model: true, inputTokens: true, outputTokens: true, costUsd: true, latencyMs: true, status: true, createdAt: true },
        }),
    ]);
    return { run, steps, modelCalls };
}
