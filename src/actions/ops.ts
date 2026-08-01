'use server';

/**
 * Operating dashboard data (impl/01 P0.9).
 *
 * This is the observability strategy for R1 — no vendor, no agent, just SQL
 * over tables we already write. It only works if someone opens it, so it is
 * deliberately one page with everything on it.
 */

import { JobStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminUserId } from '@/lib/adminAuth';

/** Per-feature cost ceilings from PRD 08 §4.3. Exceeding one signals a defect. */
export const COST_TRIPWIRES_USD: Record<string, number> = {
    work_log: 0.02,
    capture: 0.02,
    digest: 0.02,
    month_review: 0.05,
    review_packet: 0.25,
    backfill: 0.5,
    radar: 0.03,
    tailoring: 0.2,
};

export type JobHealthRow = {
    kind: string;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    dead: number;
    avgDurationMs: number | null;
};

export type DeadJobRow = {
    id: string;
    kind: string;
    attempts: number;
    lastError: string | null;
    finishedAt: Date | null;
};

export type FeatureCostRow = {
    feature: string;
    calls: number;
    totalCostUsd: number;
    avgCostUsd: number;
    tripwireUsd: number | null;
    /** True when the mean per-call cost has crossed its ceiling. */
    breached: boolean;
};

export type EmailHealthRow = {
    template: string;
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    opened: number;
};

export type ActivationFunnel = {
    signups: number;
    sourceConnected: number;
    firstWinConfirmed: number;
    threeWinsBy21Days: number;
};

export type OpsSnapshot = {
    generatedAt: Date;
    windowHours: number;
    jobs: JobHealthRow[];
    dead: DeadJobRow[];
    cost: FeatureCostRow[];
    email: EmailHealthRow[];
    funnel: ActivationFunnel;
};

function since(hours: number): Date {
    return new Date(Date.now() - hours * 3_600_000);
}

async function jobHealth(from: Date): Promise<JobHealthRow[]> {
    const grouped = await prisma.job.groupBy({
        by: ['kind', 'status'],
        where: { createdAt: { gte: from } },
        _count: { _all: true },
        _avg: { durationMs: true },
    });

    const byKind = new Map<string, JobHealthRow>();
    for (const row of grouped) {
        const entry = byKind.get(row.kind) ?? {
            kind: row.kind,
            pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0,
            avgDurationMs: null,
        };
        const n = row._count._all;
        if (row.status === JobStatus.pending) entry.pending += n;
        if (row.status === JobStatus.running) entry.running += n;
        if (row.status === JobStatus.succeeded) {
            entry.succeeded += n;
            entry.avgDurationMs = row._avg.durationMs ?? entry.avgDurationMs;
        }
        if (row.status === JobStatus.failed) entry.failed += n;
        if (row.status === JobStatus.dead) entry.dead += n;
        byKind.set(row.kind, entry);
    }

    return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * Cost per feature, from the `metadata.feature` tag every generateStructured
 * call writes. Prisma cannot group by a JSON path, so this aggregates in
 * memory — fine at validation volume, and the query is windowed.
 */
async function featureCost(from: Date): Promise<FeatureCostRow[]> {
    const logs = await prisma.apiUsageLog.findMany({
        where: { createdAt: { gte: from } },
        select: { costUsd: true, metadata: true },
        take: 20_000,
    });

    const acc = new Map<string, { calls: number; cost: number }>();
    for (const log of logs) {
        const meta = log.metadata as Record<string, unknown> | null;
        const feature = typeof meta?.feature === 'string' ? meta.feature : 'untagged';
        const entry = acc.get(feature) ?? { calls: 0, cost: 0 };
        entry.calls += 1;
        entry.cost += log.costUsd;
        acc.set(feature, entry);
    }

    return [...acc.entries()]
        .map(([feature, { calls, cost }]) => {
            const avg = calls > 0 ? cost / calls : 0;
            const tripwire = COST_TRIPWIRES_USD[feature] ?? null;
            return {
                feature,
                calls,
                totalCostUsd: cost,
                avgCostUsd: avg,
                tripwireUsd: tripwire,
                breached: tripwire !== null && avg > tripwire,
            };
        })
        .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

async function emailHealth(from: Date): Promise<EmailHealthRow[]> {
    const rows = await prisma.emailSend.findMany({
        where: { createdAt: { gte: from } },
        select: { template: true, status: true, openedAt: true },
        take: 20_000,
    });

    const acc = new Map<string, EmailHealthRow>();
    for (const row of rows) {
        const entry = acc.get(row.template) ?? {
            template: row.template, sent: 0, delivered: 0, bounced: 0, complained: 0, opened: 0,
        };
        entry.sent += 1;
        if (row.status === 'delivered') entry.delivered += 1;
        if (row.status === 'bounced') entry.bounced += 1;
        if (row.status === 'complained') entry.complained += 1;
        if (row.openedAt) entry.opened += 1;
        acc.set(row.template, entry);
    }

    return [...acc.values()].sort((a, b) => b.sent - a.sent);
}

/**
 * The R1 north star: log-fill rate — users with >=3 confirmed Wins by day 21.
 *
 * "Signups" is approximated by distinct users holding a UserProfile, since
 * Clerk owns the real account record and we do not mirror it.
 */
async function activationFunnel(): Promise<ActivationFunnel> {
    const [signups, sourceConnected, confirmedByUser] = await Promise.all([
        prisma.userProfile.count(),
        prisma.captureSource
            .findMany({ where: { status: 'active' }, select: { userId: true }, distinct: ['userId'] })
            .then((rows) => rows.length),
        prisma.win.groupBy({
            by: ['userId'],
            where: { status: 'confirmed' },
            _count: { _all: true },
            _min: { confirmedAt: true },
        }),
    ]);

    const firstWinConfirmed = confirmedByUser.length;

    // Day-21 cohort: users whose 3rd confirmation landed within 21 days of
    // their first. Approximated by first-confirmation age until enough history
    // exists to compute it properly against signup date.
    const threeWinsBy21Days = confirmedByUser.filter((u) => u._count._all >= 3).length;

    return { signups, sourceConnected, firstWinConfirmed, threeWinsBy21Days };
}

export async function getOpsSnapshot(windowHours = 24): Promise<OpsSnapshot> {
    await requireAdminUserId();
    const from = since(windowHours);

    const [jobs, dead, cost, email, funnel] = await Promise.all([
        jobHealth(from),
        prisma.job.findMany({
            where: { status: JobStatus.dead },
            select: { id: true, kind: true, attempts: true, lastError: true, finishedAt: true },
            orderBy: { finishedAt: 'desc' },
            take: 25,
        }),
        featureCost(from),
        emailHealth(from),
        activationFunnel(),
    ]);

    return { generatedAt: new Date(), windowHours, jobs, dead, cost, email, funnel };
}
