/**
 * The career inbox, read side and status moves (src/lib/inbox/types.ts).
 *
 * No table of its own. Jobs are `ApplicationWorkspace` rows, joined to the
 * Scout run that analysed them; insights are `SavedInsight`; notes are Wins;
 * companies are derived. The run is the source of truth for what Scout
 * concluded — the workspace columns are a copy taken when `track` ran, and a
 * run whose fit changed after a question was answered must not show the old
 * verdict on the board.
 *
 * Every query filters on `userId` in its WHERE clause, including the joins.
 */

import { topStrength } from '@/lib/scout/fit/strength';
import type { ApplicationStatus, Prisma, WinStatus } from '@prisma/client';
import { readSections, type StoredSection } from '@/lib/agent/run';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import {
    COLUMN_OF_STATUS,
    JOB_ACTION_STATUS,
    type BoardColumn,
    type CompanyItem,
    type InboxCounts,
    type InsightItem,
    type JobAction,
    type JobBoardFilters,
    type JobBoardItem,
    type NoteItem,
} from '@/lib/inbox/types';
import type {
    ClassifyData,
    CompData,
    FitData,
    FitVerdict,
    JdData,
    TrackedStatus,
    WorkMode,
} from '@/lib/scout/types';
import { SCOUT_AGENT } from '@/lib/scout/types';
import { track } from '@/lib/track';

// Not yet in SERVER_EVENTS (src/lib/track.ts is shared); declared here and
// cast at the one call site, the pattern src/actions/backfill.ts used.
const INBOX_EVENTS = { statusChanged: 'inbox_job_status_changed' } as const;

const DEFAULT_LIMIT = 200;
/** Rows read before in-memory filters; the board is a person's list, not a feed. */
const SCAN_CAP = 1_000;

// ─────────────────────────────────────────────────────────────── helpers

/**
 * How far along a job is. Used only to stop `saved` from undoing progress;
 * every other action is an explicit statement by the user and is honoured.
 */
const STATUS_RANK: Record<TrackedStatus, number> = {
    discovered: 0,
    analyzed: 1,
    drafting: 2,
    in_progress: 3,
    submitted: 4,
    applied: 4,
    in_review: 5,
    interview: 6,
    offer: 7,
    rejected: 8,
    ghosted: 8,
    archived: 8,
};

function columnsToStatuses(columns: readonly BoardColumn[]): ApplicationStatus[] {
    return (Object.keys(COLUMN_OF_STATUS) as TrackedStatus[])
        .filter((status) => columns.includes(COLUMN_OF_STATUS[status])) as ApplicationStatus[];
}

function sectionData<T>(section: StoredSection | undefined): T | null {
    if (!section) return null;
    if (section.status === 'ok') return section.data as T;
    if ((section.status === 'unavailable' || section.status === 'needs_input') && section.data) return section.data as T;
    return null;
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

const workspaceSelect = {
    id: true,
    userId: true,
    sourceUrl: true,
    companyName: true,
    roleTitle: true,
    location: true,
    applicationStatus: true,
    fitScore: true,
    fitVerdict: true,
    scoutRunId: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ApplicationWorkspaceSelect;

type WorkspaceRow = Prisma.ApplicationWorkspaceGetPayload<{ select: typeof workspaceSelect }>;
type RunResult = { result: Prisma.JsonValue };

/** Runs for these workspaces, keyed by id, scoped to the user. */
async function runsFor(userId: string, rows: readonly WorkspaceRow[]): Promise<Map<string, RunResult>> {
    const ids = [...new Set(rows.map((row) => row.scoutRunId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const runs = await prisma.agentRun.findMany({
        where: { id: { in: ids }, userId, agent: SCOUT_AGENT },
        select: { id: true, result: true },
    });
    return new Map(runs.map((run) => [run.id, { result: run.result }]));
}

const VERDICTS: readonly FitVerdict[] = ['strong', 'possible', 'stretch', 'not_a_fit', 'unknown'];

export function toBoardItem(row: WorkspaceRow, run: RunResult | null): JobBoardItem {
    const sections = run ? readSections(run) : {};
    const fit = sectionData<FitData>(sections.fit);
    const jd = sectionData<JdData>(sections.jd);
    const comp = sectionData<CompData>(sections.comp);
    const figure = comp?.figures?.[0];
    const storedVerdict = VERDICTS.includes(row.fitVerdict as FitVerdict) ? (row.fitVerdict as FitVerdict) : null;
    const status = row.applicationStatus as TrackedStatus;

    return {
        workspaceId: row.id,
        runId: row.scoutRunId,
        company: row.companyName,
        role: row.roleTitle,
        location: row.location,
        workMode: (jd?.workMode as WorkMode | undefined) ?? null,
        // The run is newer than the copy whenever fit re-ran after an answer.
        fitScore: fit ? fit.score : row.fitScore,
        verdict: fit ? fit.verdict : storedVerdict,
        status,
        column: COLUMN_OF_STATUS[status] ?? 'to_review',
        sourceUrl: row.sourceUrl.startsWith('scout:') ? null : row.sourceUrl,
        compHint: figure ? `${figure.value} · ${hostOf(figure.sourceUrl)}` : null,
        topStrength: topStrength(fit?.matched)?.evidence ?? null,
        topConcern: fit?.notFitReasons?.[0] ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function byFit(a: JobBoardItem, b: JobBoardItem): number {
    if (a.fitScore === null && b.fitScore !== null) return 1;
    if (b.fitScore === null && a.fitScore !== null) return -1;
    if (a.fitScore !== b.fitScore) return (b.fitScore ?? 0) - (a.fitScore ?? 0);
    return b.updatedAt.localeCompare(a.updatedAt);
}

function byRecent(a: JobBoardItem, b: JobBoardItem): number {
    return b.updatedAt.localeCompare(a.updatedAt);
}

// ──────────────────────────────────────────────────────────── status moves

/** Move a job along the tracker. Identify it by workspace or by Scout run. */
export async function setJobStatus(
    userId: string,
    ref: { workspaceId: string } | { runId: string },
    action: JobAction,
): Promise<Result<JobBoardItem>> {
    const where = 'workspaceId' in ref
        ? { id: ref.workspaceId, userId }
        : { scoutRunId: ref.runId, userId };
    const row = await prisma.applicationWorkspace.findFirst({ where, select: workspaceSelect });
    if (!row) return err('That job is not in your tracker', 'not_found');

    const next = JOB_ACTION_STATUS[action];
    const current = row.applicationStatus as TrackedStatus;
    const runs = await runsFor(userId, [row]);
    const run = row.scoutRunId ? runs.get(row.scoutRunId) ?? null : null;

    // "Save it" on a job already applied to is not a request to un-apply.
    if (action === 'saved' && STATUS_RANK[current] > STATUS_RANK[next]) return ok(toBoardItem(row, run));
    if (current === next) return ok(toBoardItem(row, run));

    const updated = await prisma.applicationWorkspace.update({
        where: { id: row.id },
        data: { applicationStatus: next as ApplicationStatus },
        select: workspaceSelect,
    });
    await track(userId, INBOX_EVENTS.statusChanged, {
        feature: 'scout',
        workspaceId: row.id,
        from: current,
        to: next,
        action,
    });
    return ok(toBoardItem(updated, run));
}

// ────────────────────────────────────────────────────────────────── board

export async function listJobBoard(userId: string, filters: JobBoardFilters = {}): Promise<JobBoardItem[]> {
    const where: Prisma.ApplicationWorkspaceWhereInput = { userId };
    if (filters.columns?.length) where.applicationStatus = { in: columnsToStatuses(filters.columns) };
    if (filters.sinceDays) where.createdAt = { gte: new Date(Date.now() - filters.sinceDays * 86_400_000) };
    if (filters.location?.trim()) where.location = { contains: filters.location.trim(), mode: 'insensitive' };

    const rows = await prisma.applicationWorkspace.findMany({
        where,
        select: workspaceSelect,
        orderBy: { updatedAt: 'desc' },
        take: SCAN_CAP,
    });
    const runs = await runsFor(userId, rows);
    let items = rows.map((row) => toBoardItem(row, row.scoutRunId ? runs.get(row.scoutRunId) ?? null : null));

    if (filters.verdicts?.length) {
        const wanted = new Set(filters.verdicts);
        items = items.filter((item) => item.verdict !== null && wanted.has(item.verdict));
    }
    if (filters.workModes?.length) {
        const wanted = new Set(filters.workModes);
        items = items.filter((item) => wanted.has(item.workMode ?? 'unknown'));
    }

    items.sort(filters.sort === 'recent' ? byRecent : byFit);
    return items.slice(0, filters.limit ?? DEFAULT_LIMIT);
}

const VERDICT_PRIORITY: Record<FitVerdict, number> = { strong: 0, possible: 1, stretch: 2, unknown: 3, not_a_fit: 4 };

/** Best fits recently added and still to review — `/jobs` and the digest. */
export async function topFits(userId: string, opts: { sinceDays?: number; limit?: number } = {}): Promise<JobBoardItem[]> {
    const items = await listJobBoard(userId, { columns: ['to_review'], sinceDays: opts.sinceDays ?? 7, limit: SCAN_CAP });
    items.sort((a, b) => {
        const va = a.verdict ? VERDICT_PRIORITY[a.verdict] : 3;
        const vb = b.verdict ? VERDICT_PRIORITY[b.verdict] : 3;
        return va !== vb ? va - vb : byFit(a, b);
    });
    return items.slice(0, opts.limit ?? 5);
}

// ─────────────────────────────────────────────────────────────── insights

function stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export async function listInsights(
    userId: string,
    opts: { tag?: string | null; q?: string | null; limit?: number } = {},
): Promise<InsightItem[]> {
    const rows = await prisma.savedInsight.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: SCAN_CAP,
    });
    const tag = opts.tag?.trim().toLowerCase() || null;
    const q = opts.q?.trim().toLowerCase() || null;
    const items: InsightItem[] = [];
    for (const row of rows) {
        const tags = stringArray(row.tags);
        const takeaways = stringArray(row.takeaways);
        if (tag && !tags.some((entry) => entry.toLowerCase() === tag)) continue;
        if (q && !`${row.title}\n${takeaways.join('\n')}`.toLowerCase().includes(q)) continue;
        items.push({
            id: row.id,
            runId: row.runId,
            title: row.title,
            takeaways,
            tags,
            url: row.url,
            author: row.author,
            createdAt: row.createdAt.toISOString(),
        });
        if (items.length >= (opts.limit ?? DEFAULT_LIMIT)) break;
    }
    return items;
}

// ────────────────────────────────────────────────────────────── companies

export async function listCompanies(userId: string): Promise<CompanyItem[]> {
    const [rows, signalRuns] = await Promise.all([
        prisma.applicationWorkspace.findMany({
            where: { userId, companyName: { not: null } },
            select: workspaceSelect,
            take: SCAN_CAP,
        }),
        prisma.agentRun.findMany({
            where: { userId, agent: SCOUT_AGENT, kind: 'company_signal' },
            select: { result: true, createdAt: true },
            take: SCAN_CAP,
        }),
    ]);
    const runs = await runsFor(userId, rows);

    type Acc = { name: string; nameSeenAt: string; jobs: JobBoardItem[]; mentions: number; lastSeenAt: string };
    const byKey = new Map<string, Acc>();
    const bump = (rawName: string, seenAt: string): Acc | null => {
        const key = canonicalCompanyKey(rawName);
        if (!key) return null;
        const entry = byKey.get(key) ?? { name: rawName.trim(), nameSeenAt: seenAt, jobs: [], mentions: 0, lastSeenAt: seenAt };
        // Display the most recently seen spelling.
        if (seenAt > entry.nameSeenAt) {
            entry.name = rawName.trim();
            entry.nameSeenAt = seenAt;
        }
        if (seenAt > entry.lastSeenAt) entry.lastSeenAt = seenAt;
        byKey.set(key, entry);
        return entry;
    };

    for (const row of rows) {
        const item = toBoardItem(row, row.scoutRunId ? runs.get(row.scoutRunId) ?? null : null);
        bump(row.companyName!, item.updatedAt)?.jobs.push(item);
    }
    for (const run of signalRuns) {
        const classify = sectionData<ClassifyData>(readSections(run).classify);
        for (const company of classify?.companies ?? []) {
            const entry = bump(company, run.createdAt.toISOString());
            if (entry) entry.mentions += 1;
        }
    }

    // A radar board for a company is public data; matched by the same key.
    const sources = byKey.size
        ? await prisma.jobSource.findMany({ select: { companyName: true }, take: 10_000 })
        : [];
    const tracked = new Set(sources.map((source) => canonicalCompanyKey(source.companyName)).filter(Boolean));

    return [...byKey.entries()]
        .map(([key, entry]): CompanyItem => {
            const best = [...entry.jobs].sort(byFit)[0] ?? null;
            return {
                name: entry.name,
                jobs: entry.jobs.length,
                bestFit: best ? { score: best.fitScore, verdict: best.verdict, role: best.role, workspaceId: best.workspaceId, runId: best.runId } : null,
                mentions: entry.mentions,
                radarTracked: tracked.has(key),
                lastSeenAt: entry.lastSeenAt,
            };
        })
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

// ────────────────────────────────────────────────────────────────── notes

/** Win drafts and confirmations that came in through a chat channel. */
export async function listChatNotes(userId: string, opts: { limit?: number } = {}): Promise<NoteItem[]> {
    const wins = await prisma.win.findMany({
        where: { userId, OR: [{ source: 'chat' }, { sourceRef: { startsWith: 'scout:' } }] },
        orderBy: { createdAt: 'desc' },
        take: opts.limit ?? 50,
        select: { id: true, title: true, status: true, source: true, createdAt: true },
    });
    return wins.map((win) => ({
        winId: win.id,
        title: win.title,
        status: win.status as NoteItem['status'],
        source: win.source,
        createdAt: win.createdAt.toISOString(),
    }));
}

// ───────────────────────────────────────────────────────────────── counts

export async function inboxCounts(userId: string): Promise<InboxCounts> {
    const [byStatus, insights, draftNotes] = await Promise.all([
        prisma.applicationWorkspace.groupBy({ by: ['applicationStatus'], where: { userId }, _count: { _all: true } }),
        prisma.savedInsight.count({ where: { userId } }),
        prisma.win.count({
            where: {
                userId,
                status: 'draft' as WinStatus,
                OR: [{ source: 'chat' }, { sourceRef: { startsWith: 'scout:' } }],
            },
        }),
    ]);
    const inColumn = (column: BoardColumn) => byStatus
        .filter((row) => COLUMN_OF_STATUS[row.applicationStatus as TrackedStatus] === column)
        .reduce((sum, row) => sum + row._count._all, 0);
    return {
        toReview: inColumn('to_review'),
        applied: inColumn('applied'),
        interviewing: inColumn('interviewing'),
        insights,
        draftNotes,
    };
}
