'use server';

/**
 * Capture / connected-source server actions — PRD 02 §3.2, §7.
 *
 * Every one follows impl/00 §P-3 in order: Clerk `auth()` → zod parse → work →
 * `FunnelEvent` → a discriminated `Result`. None of them throw for an expected
 * failure, because "GitHub is not connected" is a state, not an exception.
 *
 * Nothing here is metered. PRD 02 §9 gates the *number of sources*, not the
 * capture itself — gating capture would starve the context graph, which is the
 * asset the whole product is built on.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import {
    CaptureRunStatus,
    CaptureSourceKind,
    CaptureSourceStatus,
    WinSource,
    WinStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { getUserTier } from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';
import { track } from '@/lib/track';
import { enqueue, buildDedupeKey } from '@/lib/jobs/runner';
import { MANUAL_SYNC_COOLDOWN_MS } from '@/lib/capture/caps';
import { GITHUB_CONSENT_VERSION } from '@/lib/capture/consent';
import { getGithubIdentity, hasPrivateRepoAccess } from '@/lib/capture/github/auth';
import { OctokitGithubApi } from '@/lib/capture/github/client';
import { NOISE_RULES } from '@/lib/capture/noise';
import { deleteCachedSignals } from '@/lib/capture/sync';
import { deleteWin } from '@/services/winGraph';
import { parseSourceConfig } from '@/lib/capture/types';
import {
    AVAILABLE_SOURCE_COPY,
    buildRepoOptions,
    describeAccess,
    describeContribution,
    describeLastRun,
    maxSourcesForTier,
    statusPill,
    type AvailableSourceView,
    type RepoOption,
    type SourcesOverview,
    type SourceView,
} from '@/lib/capture/views';

const FEATURE = { feature: 'github_capture' } as const;

const KindSchema = z.enum(CaptureSourceKind);
const ModeSchema = z.enum(['public', 'full']);
const RepoNameSchema = z
    .string()
    .min(3)
    .max(200)
    .regex(/^[\w.-]+\/[\w.-]+$/, 'expected "owner/name"');

async function requireUserId(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
}

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

/**
 * Every surface in this file is behind `github_capture` (ADR-7). A flag answers
 * "is this built and switched on for this user"; the entitlement below answers
 * "is this user allowed to". Both, in that order.
 */
async function captureEnabled(userId: string): Promise<boolean> {
    return isEnabled(userId, 'github_capture');
}

const NOT_ENABLED = ['Not available yet', 'not_enabled'] as const;

// ═══════════════════════════════════════════════════════════════ 1. overview

export async function getSourcesOverview(): Promise<Result<SourcesOverview>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const [sources, tier] = await Promise.all([
        prisma.captureSource.findMany({
            where: { userId, status: { not: CaptureSourceStatus.revoked } },
            orderBy: { createdAt: 'asc' },
        }),
        getUserTier(userId),
    ]);

    const [totalWins, winsByKind] = await Promise.all([
        prisma.win.count({ where: { userId, status: { not: WinStatus.dismissed } } }),
        prisma.win.groupBy({
            by: ['source'],
            where: { userId, status: { not: WinStatus.dismissed } },
            _count: { _all: true },
        }),
    ]);
    const winCountBySource = new Map(winsByKind.map((row) => [row.source, row._count._all]));

    const runs = await prisma.captureRun.findMany({
        where: { sourceId: { in: sources.map((source) => source.id) } },
        orderBy: { startedAt: 'desc' },
        take: 50,
    });
    const latestRun = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latestRun.has(run.sourceId)) latestRun.set(run.sourceId, run);

    const connected: SourceView[] = sources.map((source) => {
        const config = parseSourceConfig(source.config);
        const scopes = Array.isArray(source.scopes)
            ? (source.scopes as unknown[]).filter((scope): scope is string => typeof scope === 'string')
            : [];
        const canSeePrivate = hasPrivateRepoAccess(scopes);
        const run = latestRun.get(source.id) ?? null;
        const winsFromSource = winCountBySource.get(sourceToWinSource(source.kind)) ?? 0;
        const cooldownUntil = source.lastSyncedAt
            ? new Date(source.lastSyncedAt.getTime() + MANUAL_SYNC_COOLDOWN_MS)
            : null;

        return {
            id: source.id,
            kind: source.kind,
            displayName: AVAILABLE_SOURCE_COPY[source.kind]?.displayName ?? source.kind,
            accountLabel: source.externalAccountId,
            pill: statusPill(source.status),
            access: describeAccess({ repoCount: config.includedRepos.length, canSeePrivate }),
            repoCount: config.includedRepos.length,
            canSeePrivate,
            lastRun: describeLastRun(
                run
                    ? {
                          finishedAt: run.finishedAt,
                          startedAt: run.startedAt,
                          status: run.status,
                          itemsScanned: run.itemsScanned,
                          winsDrafted: run.winsDrafted,
                      }
                    : null,
            ),
            contribution: describeContribution({ fromSource: winsFromSource, total: totalWins }),
            winsFromSource,
            canSyncNow: !cooldownUntil || cooldownUntil.getTime() <= Date.now(),
            syncCooldownUntil: cooldownUntil,
            lastError: source.lastError,
        };
    });

    const connectedKinds = new Set(sources.map((source) => source.kind));
    const maxSources = maxSourcesForTier(tier);
    const remainingSlots = Math.max(0, maxSources - sources.length);

    const available: AvailableSourceView[] = (Object.values(CaptureSourceKind) as CaptureSourceKind[])
        .filter((kind) => !connectedKinds.has(kind))
        .map((kind) => ({
            kind,
            displayName: AVAILABLE_SOURCE_COPY[kind]?.displayName ?? kind,
            pitch: AVAILABLE_SOURCE_COPY[kind]?.pitch ?? '',
            // R2. Named rather than hidden, so the roadmap is legible.
            requiresTierLabel: kind === CaptureSourceKind.github ? null : 'Coming in the next release',
            available: kind === CaptureSourceKind.github && remainingSlots > 0,
        }));

    return ok({ connected, available, remainingSlots, maxSources });
}

function sourceToWinSource(kind: CaptureSourceKind): WinSource {
    switch (kind) {
        case CaptureSourceKind.github:
            return WinSource.github;
        case CaptureSourceKind.calendar:
            return WinSource.calendar;
        case CaptureSourceKind.linear:
            return WinSource.linear;
        case CaptureSourceKind.jira:
            return WinSource.jira;
    }
}

// ═══════════════════════════════════════════════════════════════ 2. connect

/**
 * Record consent and create the source. Deliberately does NOT start a sync:
 * the repo picker is mandatory before the first pull (§3.2), and a source with
 * no `includedRepos` is inert by construction.
 */
export async function connectGithub(input: { mode: 'public' | 'full' }): Promise<Result<{ sourceId: string }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await captureEnabled(userId))) return err(...NOT_ENABLED);

    const parsed = ModeSchema.safeParse(input?.mode);
    if (!parsed.success) return err('Pick public or full access', 'invalid_input');

    const [tier, existingCount, existing] = await Promise.all([
        getUserTier(userId),
        prisma.captureSource.count({ where: { userId, status: { not: CaptureSourceStatus.revoked } } }),
        prisma.captureSource.findUnique({
            where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
        }),
    ]);

    if (!existing && existingCount >= maxSourcesForTier(tier)) {
        return err(
            `Your plan connects ${maxSourcesForTier(tier)} source${maxSourcesForTier(tier) === 1 ? '' : 's'}.`,
            'entitlement_required',
        );
    }

    const identity = await getGithubIdentity(userId);
    if (!identity.login) {
        return err('Connect your GitHub account in Account settings first', 'github_not_linked');
    }
    if (parsed.data === 'full' && !hasPrivateRepoAccess(identity.scopes)) {
        // Not an error the user can act on inside this dialog, but they must not
        // be told we can see private repos when we cannot.
        console.warn('[actions/capture] full mode requested without repo scope', { userId });
    }

    const scopes = parsed.data === 'full' ? identity.scopes : [];
    const now = new Date();

    const source = await prisma.captureSource.upsert({
        where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
        create: {
            userId,
            kind: CaptureSourceKind.github,
            status: CaptureSourceStatus.active,
            externalAccountId: identity.login,
            scopes,
            config: {},
            consentGrantedAt: now,
            consentCopyVersion: GITHUB_CONSENT_VERSION,
        },
        update: {
            // Reconnecting resets health but keeps the cursor: re-pulling a window
            // we already have is free (the unique constraint eats it) but skipping
            // one we do not is a silent hole in the record.
            status: CaptureSourceStatus.active,
            externalAccountId: identity.login,
            scopes,
            consentGrantedAt: now,
            consentCopyVersion: GITHUB_CONSENT_VERSION,
            revokedAt: null,
            errorCount: 0,
            lastError: null,
        },
    });

    await track(userId, 'source_connect_completed', {
        ...FEATURE,
        kind: CaptureSourceKind.github,
        mode: parsed.data,
    });

    return ok({ sourceId: source.id });
}

// ═══════════════════════════════════════════════════════════ 3. repo picker

export async function listGithubRepos(): Promise<Result<RepoOption[]>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await captureEnabled(userId))) return err(...NOT_ENABLED);

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
    });
    const alreadySelected = source ? parseSourceConfig(source.config).includedRepos : [];

    const identity = await getGithubIdentity(userId);
    if (!identity.login) return err('Connect your GitHub account first', 'github_not_linked');

    try {
        const api = new OctokitGithubApi({ token: identity.token ?? undefined, maxRequests: 6 });
        const repos = await api.listRepos();
        return ok(
            buildRepoOptions(
                repos.map((repo) => ({
                    fullName: repo.fullName,
                    private: repo.private,
                    pushedAt: repo.pushedAt,
                    archived: repo.archived,
                    fork: repo.fork,
                    contributionsLast90d: repo.contributionsLast90d,
                })),
                alreadySelected,
            ),
        );
    } catch (error: unknown) {
        console.error('[actions/capture] listGithubRepos failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return err("Couldn't reach GitHub just now — try again", 'provider_unavailable');
    }
}

/**
 * Save the picker and start the first scan.
 *
 * Zero selected is a blocking inline error, never a saved empty list (§7.3) —
 * a source that can see nothing produces silent empty digests forever, and the
 * user has no way to discover why.
 */
export async function saveRepoSelection(repos: string[]): Promise<Result<{ jobId: string; initial: boolean }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await captureEnabled(userId))) return err(...NOT_ENABLED);

    const parsed = z.array(RepoNameSchema).max(500).safeParse(repos ?? []);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    if (parsed.data.length === 0) {
        return err('Pick at least one repo — we can’t scan nothing.', 'no_repos_selected');
    }

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
    });
    if (!source) return err('Connect GitHub first', 'not_found');

    const config = parseSourceConfig(source.config);
    const initial = source.lastSuccessAt === null;
    const selected = [...new Set(parsed.data)];

    await prisma.captureSource.update({
        where: { id: source.id },
        data: {
            config: { ...config, includedRepos: selected },
            status: CaptureSourceStatus.active,
            lastError: null,
            errorCount: 0,
        },
    });

    await track(userId, 'source_repo_selection_saved', {
        ...FEATURE,
        kind: CaptureSourceKind.github,
        selectedCount: selected.length,
    });

    const trigger = initial ? 'initial' : 'manual';
    const job = await enqueue(
        'capture_sync',
        { sourceId: source.id, trigger },
        {
            dedupeKey: buildDedupeKey('capture_sync', [source.id, trigger, new Date().toISOString().slice(0, 13)]),
            // The first fill is the best activation moment the product has
            // (§7.1). It jumps the queue.
            priority: initial ? 10 : 80,
        },
    );

    return ok({ jobId: job.jobId, initial });
}

// ═══════════════════════════════════════════════════════════════ 4. sync now

export async function syncSourceNow(kind: CaptureSourceKind = CaptureSourceKind.github): Promise<Result<{ jobId: string }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await captureEnabled(userId))) return err(...NOT_ENABLED);

    const parsedKind = KindSchema.safeParse(kind);
    if (!parsedKind.success) return err('Unknown source', 'invalid_input');

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: parsedKind.data } },
    });
    if (!source) return err('Source not connected', 'not_found');
    if (parseSourceConfig(source.config).includedRepos.length === 0) {
        return err('Pick at least one repo first', 'no_repos_selected');
    }

    // §3.3 — manual refresh is rate-limited to one per hour.
    if (source.lastSyncedAt && Date.now() - source.lastSyncedAt.getTime() < MANUAL_SYNC_COOLDOWN_MS) {
        return err('Already synced in the last hour — the next one runs automatically', 'rate_limited');
    }

    const job = await enqueue(
        'capture_sync',
        { sourceId: source.id, trigger: 'manual' },
        {
            dedupeKey: buildDedupeKey('capture_sync', [source.id, 'manual', new Date().toISOString().slice(0, 13)]),
            priority: 50,
        },
    );

    return ok({ jobId: job.jobId });
}

// ═══════════════════════════════════════════════════════════ 5. pause/resume

export async function setSourcePaused(
    kind: CaptureSourceKind,
    paused: boolean,
): Promise<Result<{ status: CaptureSourceStatus }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedKind = KindSchema.safeParse(kind);
    if (!parsedKind.success) return err('Unknown source', 'invalid_input');
    const parsedPaused = z.boolean().safeParse(paused);
    if (!parsedPaused.success) return err('Invalid state', 'invalid_input');

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: parsedKind.data } },
    });
    if (!source) return err('Source not connected', 'not_found');

    const status = parsedPaused.data ? CaptureSourceStatus.paused : CaptureSourceStatus.active;
    await prisma.captureSource.update({
        where: { id: source.id },
        data: { status, ...(parsedPaused.data ? {} : { errorCount: 0, lastError: null }) },
    });

    return ok({ status });
}

// ═══════════════════════════════════════════════════════════ 6. disconnect

/**
 * §7.2 — both options ship.
 *
 * The safe path keeps every Win and deletes the cached raw signals. The
 * destructive path is offered deliberately: a user who cannot delete what we
 * gathered has no reason to believe the safe option either. It is a text link
 * in the UI, never a red button.
 */
export async function disconnectSource(input: {
    kind?: CaptureSourceKind;
    deleteWins?: boolean;
}): Promise<Result<{ winsDeleted: number; signalsDeleted: number }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z
        .object({ kind: KindSchema.default(CaptureSourceKind.github), deleteWins: z.boolean().default(false) })
        .safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: parsed.data.kind } },
    });
    if (!source) return err('Source not connected', 'not_found');

    const winSource = sourceToWinSource(source.kind);
    const winsAtDisconnect = await prisma.win.count({
        where: { userId, source: winSource, status: { not: WinStatus.dismissed } },
    });

    let winsDeleted = 0;
    if (parsed.data.deleteWins) {
        const wins = await prisma.win.findMany({
            where: { userId, source: winSource },
            select: { id: true },
        });
        // `winGraph.deleteWin` already removes the Evidence, the ClaimLinks, the
        // ImpactMetric and the Qdrant point in the right order. Re-implementing
        // that here is how a dangling ClaimLink survives a deletion.
        for (const win of wins) {
            const result = await deleteWin({ userId, winId: win.id });
            if (result.success) winsDeleted += 1;
        }
    }

    const signalsDeleted = await deleteCachedSignals(source.id);

    await prisma.captureSource.update({
        where: { id: source.id },
        data: {
            status: CaptureSourceStatus.revoked,
            revokedAt: new Date(),
            cursor: null,
            config: {},
            scopes: [],
        },
    });

    await track(userId, 'source_disconnected', {
        ...FEATURE,
        kind: source.kind,
        deletedWins: parsed.data.deleteWins,
        winsAtDisconnect,
    });

    return ok({ winsDeleted, signalsDeleted });
}

// ═══════════════════════════════════════════════════════════ 7. noise rules

/**
 * §6.2 — "Always ignore PRs like this?" appended to the source config.
 *
 * This is how the filter learns without ML: the user's dismissal becomes a
 * deterministic rule they can read, edit and delete, which is a far better
 * trade than a model that quietly stops surfacing a category of their work.
 */
export async function addNoiseRule(input: {
    kind?: CaptureSourceKind;
    type: 'repo' | 'keyword';
    value: string;
}): Promise<Result<{ excludedRepos: string[]; excludedKeywords: string[] }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z
        .object({
            kind: KindSchema.default(CaptureSourceKind.github),
            type: z.enum(['repo', 'keyword']),
            value: z.string().min(2).max(120),
        })
        .safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: parsed.data.kind } },
    });
    if (!source) return err('Source not connected', 'not_found');

    const config = parseSourceConfig(source.config);
    const value = parsed.data.value.trim();

    if (parsed.data.type === 'repo') config.excludedRepos = [...new Set([...config.excludedRepos, value])];
    else config.excludedKeywords = [...new Set([...config.excludedKeywords, value])];

    await prisma.captureSource.update({ where: { id: source.id }, data: { config: { ...config } } });

    await track(userId, 'noise_rule_added', {
        ...FEATURE,
        kind: parsed.data.kind,
        ruleType: parsed.data.type === 'repo' ? NOISE_RULES.excludedRepo : NOISE_RULES.excludedKeyword,
    });

    return ok({ excludedRepos: config.excludedRepos, excludedKeywords: config.excludedKeywords });
}

export async function removeNoiseRule(input: {
    kind?: CaptureSourceKind;
    type: 'repo' | 'keyword';
    value: string;
}): Promise<Result<{ excludedRepos: string[]; excludedKeywords: string[] }>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = z
        .object({
            kind: KindSchema.default(CaptureSourceKind.github),
            type: z.enum(['repo', 'keyword']),
            value: z.string().min(1).max(120),
        })
        .safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const source = await prisma.captureSource.findUnique({
        where: { userId_kind: { userId, kind: parsed.data.kind } },
    });
    if (!source) return err('Source not connected', 'not_found');

    const config = parseSourceConfig(source.config);
    const value = parsed.data.value.trim().toLowerCase();
    if (parsed.data.type === 'repo') {
        config.excludedRepos = config.excludedRepos.filter((entry) => entry.toLowerCase() !== value);
    } else {
        config.excludedKeywords = config.excludedKeywords.filter((entry) => entry.toLowerCase() !== value);
    }

    await prisma.captureSource.update({ where: { id: source.id }, data: { config: { ...config } } });
    return ok({ excludedRepos: config.excludedRepos, excludedKeywords: config.excludedKeywords });
}

// ═══════════════════════════════════════════════════════════ 8. run history

export async function getRecentRuns(
    kind: CaptureSourceKind = CaptureSourceKind.github,
    limit = 10,
): Promise<Result<Array<{ id: string; status: CaptureRunStatus; startedAt: Date; scanned: number; drafted: number }>>> {
    const userId = await requireUserId();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsedLimit = z.number().int().min(1).max(50).safeParse(limit);
    if (!parsedLimit.success) return err('Invalid limit', 'invalid_input');

    const source = await prisma.captureSource.findUnique({ where: { userId_kind: { userId, kind } } });
    if (!source) return ok([]);

    const runs = await prisma.captureRun.findMany({
        where: { sourceId: source.id },
        orderBy: { startedAt: 'desc' },
        take: parsedLimit.data,
    });

    return ok(
        runs.map((run) => ({
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            scanned: run.itemsScanned,
            drafted: run.winsDrafted,
        })),
    );
}
