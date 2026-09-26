/**
 * The Win graph — the data layer behind the Work Log (PRD 01 §7).
 *
 * The confirm transaction in here is the product thesis expressed as code:
 * confirming a Win writes `Evidence(confirmedByUser=true)` + `ClaimLink(grounded)`,
 * and that pair is simultaneously the retention loop and the moat (CLAUDE.md
 * rule 5). Un-confirming reverses all of it, including the Qdrant point.
 *
 * Everything here is plain async functions taking an explicit `userId`, so the
 * whole layer is testable against a real database without Clerk. Auth, zod
 * parsing, metering and telemetry live one level up in `src/actions/wins.ts`
 * (impl/00 §P-3).
 */

import {
    EvidenceKind,
    GroundState,
    Prisma,
    Tier,
    WinCategory,
    WinSensitivity,
    WinSource,
    WinStatus,
    type Evidence,
    type ImpactMetric,
    type Win,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { getUserTier } from '@/lib/entitlements';
import { mayEmbed } from '@/lib/graph/visibility';
import { deleteWinPoint, enqueueEmbedWin } from '@/lib/jobs/handlers/embedWin';
import type {
    BulkResult,
    DismissReason,
    EmployerOption,
    EvidenceView,
    ImpactInput,
    ImpactView,
    LogSummary,
    WinCursor,
    WinFilters,
    WinPage,
    WinPatch,
    WinView,
} from '@/actions/wins.types';

/** Re-exported so the service layer has one canonical impact shape. */
export type { ImpactInput };

// ═══════════════════════════════════════════════════════════════ constants

/** New value in the existing free-string `ClaimLink.claimType` (PRD 01 §7.1). */
export const WIN_CLAIM_TYPE = 'win';

/** `ImpactMetric.subjectType` discriminator for Win-owned metrics. */
export const WIN_SUBJECT_TYPE = 'win';

export const MAX_TITLE_LENGTH = 120;
export const MAX_EXCERPT_LENGTH = 2_000;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * PRD 01 §7.1. `ambient` is a user assertion harvested from another product
 * surface (an edited resume bullet, a confirmed truthfulness chip), so it maps
 * the same way `manual` does.
 */
export const EVIDENCE_KIND_BY_SOURCE: Record<WinSource, EvidenceKind> = {
    [WinSource.github]: EvidenceKind.repo,
    [WinSource.manual]: EvidenceKind.metric_confirmed,
    // A note sent to the bot is the user's own statement, exactly like typing
    // it into the Work Log; the channel it arrived on changes nothing about it.
    [WinSource.chat]: EvidenceKind.metric_confirmed,
    [WinSource.ambient]: EvidenceKind.metric_confirmed,
    [WinSource.calendar]: EvidenceKind.document,
    [WinSource.linear]: EvidenceKind.document,
    [WinSource.jira]: EvidenceKind.document,
    [WinSource.backfill]: EvidenceKind.interview_assertion,
    [WinSource.import]: EvidenceKind.import,
};

/** `ImpactMetric.source` vocabulary (interview | import | github | manual). */
const IMPACT_SOURCE_BY_WIN_SOURCE: Record<WinSource, string> = {
    [WinSource.github]: 'github',
    [WinSource.import]: 'import',
    [WinSource.backfill]: 'interview',
    [WinSource.manual]: 'manual',
    [WinSource.chat]: 'manual',
    [WinSource.ambient]: 'manual',
    [WinSource.calendar]: 'manual',
    [WinSource.linear]: 'manual',
    [WinSource.jira]: 'manual',
};

/**
 * Log history depth is a *plan attribute*, not a quota (PRD 01 §10). Older Wins
 * are hidden and restored on upgrade — never deleted.
 *
 * TODO(plans): move to `src/lib/plans.ts` PLAN_CATALOG when it lands (rule 4).
 */
export const WIN_HISTORY_DAYS_BY_TIER: Record<Tier, number> = {
    [Tier.free]: 90,
    [Tier.always_on]: Number.POSITIVE_INFINITY,
    [Tier.pro]: Number.POSITIVE_INFINITY,
    [Tier.team]: Number.POSITIVE_INFINITY,
};

export function historyCutoff(tier: Tier, now: Date = new Date()): Date | null {
    const days = WIN_HISTORY_DAYS_BY_TIER[tier];
    if (!Number.isFinite(days)) return null;
    return new Date(now.getTime() - days * 86_400_000);
}

const ALL_CATEGORIES: WinCategory[] = Object.values(WinCategory);

/**
 * The quantify prompt (PRD 01 §6.3). Deterministic and per-category rather than
 * a model call: this renders on every un-quantified row in a 500-row log, and
 * one AI call per row is not a thing we are going to do. §8.3's cached
 * per-Win generated question can replace these later without a contract change.
 * Each is <= 8 words, by construction and by test.
 */
const QUANTIFY_PROMPTS: Record<WinCategory, string> = {
    [WinCategory.shipped]: 'How many people use it?',
    [WinCategory.improved]: 'How much better, roughly?',
    [WinCategory.fixed]: 'How many users were affected?',
    [WinCategory.led]: 'How many people were involved?',
    [WinCategory.influenced]: 'How many teams changed course?',
    [WinCategory.grew]: 'How many people did you develop?',
    [WinCategory.learned]: 'Where did you apply it?',
    [WinCategory.saved]: 'How much did that save?',
};

export function quantifyPromptFor(category: WinCategory): string {
    return QUANTIFY_PROMPTS[category];
}

// ═══════════════════════════════════════════════════════ employer attribution

type ExperienceRange = { id: string; startDate: string; endDate: string; current: boolean };

const OPEN_ENDED = new Set(['', 'present', 'current', 'now', 'ongoing', 'today']);

/**
 * `UserExperience.startDate` / `endDate` are free-form strings ("2025",
 * "2025-03", "2025-03-17", "Present", ""). Parse defensively and return null
 * rather than a guess — an unparseable bound must not silently become "now".
 */
export function parseExperienceDate(raw: string, bound: 'start' | 'end'): Date | null {
    const value = (raw ?? '').trim();
    if (OPEN_ENDED.has(value.toLowerCase())) return null;

    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (ymd) {
        const [, y, m, d] = ymd;
        return bound === 'start'
            ? new Date(Date.UTC(+y, +m - 1, +d, 0, 0, 0, 0))
            : new Date(Date.UTC(+y, +m - 1, +d, 23, 59, 59, 999));
    }

    const ym = /^(\d{4})-(\d{1,2})$/.exec(value);
    if (ym) {
        const [, y, m] = ym;
        return bound === 'start'
            ? new Date(Date.UTC(+y, +m - 1, 1, 0, 0, 0, 0))
            : new Date(Date.UTC(+y, +m, 0, 23, 59, 59, 999));
    }

    const yearOnly = /^(\d{4})$/.exec(value);
    if (yearOnly) {
        const y = Number(yearOnly[1]);
        return bound === 'start'
            ? new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0))
            : new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * PRD 01 §4.5 / §12: the experience whose `[startDate, endDate ?? now]` contains
 * `occurredAt`. Zero matches (a gap, a missing row) and two or more matches
 * (contractor + full-time overlap) both resolve to `null`. We ask; we never guess.
 */
export function resolveEmployerIdFrom(
    experiences: readonly ExperienceRange[],
    occurredAt: Date,
    now: Date = new Date(),
): string | null {
    const at = occurredAt.getTime();
    const matches = experiences.filter((experience) => {
        const start = parseExperienceDate(experience.startDate, 'start');
        if (!start || start.getTime() > at) return false;
        const end = parseExperienceDate(experience.endDate, 'end');
        const upper = end ? end.getTime() : now.getTime();
        return at <= upper;
    });
    return matches.length === 1 ? matches[0].id : null;
}

export async function resolveEmployerId(params: {
    userId: string;
    occurredAt: Date;
    now?: Date;
}): Promise<string | null> {
    const experiences = await prisma.userExperience.findMany({
        where: { userId: params.userId },
        select: { id: true, startDate: true, endDate: true, current: true },
    });
    return resolveEmployerIdFrom(experiences, params.occurredAt, params.now);
}

// ═══════════════════════════════════════════════════════════ source artifacts

export type SourceArtifact = {
    /** Stable identity for idempotency: one Evidence row per key, ever. */
    key: string;
    kind: EvidenceKind;
    sourceRef: string;
    excerpt: string;
};

/** Synthetic `sourceRef` for a Win whose only source is the user's own words. */
export function syntheticSourceRef(winId: string): string {
    return `win:${winId}`;
}

/** Synthetic `sourceRef` for evidence typed into a `needs_confirmation` chip. */
export function userSourceRef(winId: string): string {
    return `win:${winId}:user-source`;
}

/**
 * The "for each source artifact" of PRD 01 §7.1. A Win normally carries exactly
 * one — the thing it was drafted from (a PR, a calendar event, or the user's
 * own words). `userSource` adds a second: whatever the user typed into the
 * GroundChip at confirm time. The chip is a producer, not a status light.
 */
export function sourceArtifactsFor(
    win: Pick<Win, 'id' | 'title' | 'narrative' | 'source' | 'sourceRef'>,
    userSource?: string | null,
): SourceArtifact[] {
    const kind = EVIDENCE_KIND_BY_SOURCE[win.source];
    const sourceRef = win.sourceRef && win.sourceRef.trim() ? win.sourceRef.trim() : syntheticSourceRef(win.id);
    const excerpt = [win.title, win.narrative]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(' — ')
        .slice(0, MAX_EXCERPT_LENGTH);

    const artifacts: SourceArtifact[] = [
        { key: `${kind}|${sourceRef}`, kind, sourceRef, excerpt: excerpt || win.title },
    ];

    const typed = (userSource ?? '').trim();
    if (typed) {
        // A pasted link is addressable; anything else is a user assertion.
        const isUrl = /^https?:\/\//i.test(typed);
        const userKind = isUrl ? EvidenceKind.url : EvidenceKind.metric_confirmed;
        const userRef = isUrl ? typed : userSourceRef(win.id);
        const key = `${userKind}|${userRef}`;
        if (key !== artifacts[0].key) {
            artifacts.push({
                key,
                kind: userKind,
                sourceRef: userRef,
                excerpt: typed.slice(0, MAX_EXCERPT_LENGTH),
            });
        }
    }

    return artifacts;
}

// ═══════════════════════════════════════════════════════════════ view mapping

function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

// ─────────────────────────────────────────────────── evidence presentation
//
// Derived on the server, deliberately. The client cannot do this: a URL-less
// source (a manual note, a calendar event id) has no URL to parse, and the
// GitHub-shaped guesses that work for a PR link produce nonsense for anything
// else. `SourceChip` renders `label` / `detail` verbatim.

/**
 * Tombstone marker on `Evidence.sourceRef`, written by a future connector
 * reconcile when it finds the upstream gone (PRD 01 §12: "user deletes their
 * GitHub account"). The excerpt is what we stored, so the evidence survives —
 * only its reachability changes.
 *
 * TODO(schema): this wants to be an `Evidence.availableAt` column. It is a
 * prefix today because `prisma/schema.prisma` is orchestrator-owned, and the
 * convention is confined to this file plus {@link describeEvidence}.
 */
export const UNAVAILABLE_SOURCE_PREFIX = 'gone:';

/** Chip copy per kind, matching `src/components/log/adapt.ts` KIND_FALLBACK. */
const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
    [EvidenceKind.repo]: 'Repository',
    [EvidenceKind.document]: 'Document',
    [EvidenceKind.url]: 'Link',
    [EvidenceKind.interview_assertion]: 'You said this',
    // Not "Confirmed metric": the kind means the USER confirmed an assertion,
    // and `winGraph` maps every `manual` and `ambient` Win to it. So a hand-
    // logged Win with no ImpactMetric was claiming a metric while the drawer
    // sat directly beneath it asking "How much better, roughly?".
    [EvidenceKind.metric_confirmed]: 'You confirmed this',
    [EvidenceKind.import]: 'Import',
};

function labelFromUrl(raw: string): { label: string; detail: string | null } | null {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    const path = parsed.pathname;

    const pull = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(path);
    if (pull) return { label: `PR #${pull[2]}`, detail: pull[1] };

    const issue = /^\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(path);
    if (issue) return { label: `Issue #${issue[2]}`, detail: issue[1] };

    const commit = /^\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{7,40})/i.exec(path);
    if (commit) return { label: `Commit ${commit[2].slice(0, 7)}`, detail: commit[1] };

    const host = parsed.hostname.replace(/^www\./, '');
    const repo = /^\/([^/]+)\/([^/]+)\/?$/.exec(path);
    if (repo && /github|gitlab|bitbucket/i.test(host)) {
        return { label: repo[2], detail: repo[1] };
    }

    const file = path.split('/').filter(Boolean).pop();
    if (file && file.includes('.')) return { label: decodeURIComponent(file), detail: host };

    return { label: host, detail: null };
}

export type EvidencePresentation = {
    label: string;
    detail: string | null;
    url: string | null;
    available: boolean;
};

export function describeEvidence(
    evidence: Pick<Evidence, 'kind' | 'sourceRef'>,
): EvidencePresentation {
    const raw = evidence.sourceRef ?? '';
    const available = !raw.startsWith(UNAVAILABLE_SOURCE_PREFIX);
    const ref = available ? raw : raw.slice(UNAVAILABLE_SOURCE_PREFIX.length);

    // `url` stays populated for a dead link: `available:false` is what drives
    // the strikethrough, `url === null` means it never had an address at all.
    const url = /^https?:\/\//i.test(ref) ? ref : null;

    if (url) {
        const derived = labelFromUrl(url);
        if (derived) return { ...derived, url, available };
        return { label: EVIDENCE_KIND_LABEL[evidence.kind], detail: null, url, available };
    }

    // Synthetic refs: the user's own words are the source, so they cannot 404.
    if (ref.startsWith('win:')) {
        const label =
            evidence.kind === EvidenceKind.interview_assertion ? 'You said this' : 'You logged this';
        return { label, detail: null, url: null, available: true };
    }

    // An opaque upstream id (calendar event, Linear issue key, import batch).
    return {
        label: EVIDENCE_KIND_LABEL[evidence.kind],
        detail: ref ? ref.slice(0, 80) : null,
        url: null,
        available,
    };
}

function toImpactView(metric: ImpactMetric | undefined): ImpactView | null {
    if (!metric) return null;
    return {
        id: metric.id,
        metric: metric.metric,
        baseline: metric.baseline,
        result: metric.result,
        delta: metric.delta,
        scope: metric.scope,
        timeframe: metric.timeframe,
    };
}

export function deriveGroundState(
    win: Pick<Win, 'status'>,
    links: { groundState: GroundState }[],
): WinView['groundState'] {
    if (links.some((link) => link.groundState === GroundState.grounded)) return 'grounded';
    if (links.length > 0) return 'needs_confirmation';
    return win.status === WinStatus.confirmed ? 'needs_confirmation' : 'unsupported';
}

type LinkWithEvidence = { groundState: GroundState; claimRefId: string; evidence: Evidence };

export async function buildWinViews(userId: string, wins: Win[]): Promise<WinView[]> {
    if (wins.length === 0) return [];
    const winIds = wins.map((win) => win.id);

    const [links, metrics, employers] = await Promise.all([
        prisma.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: { in: winIds } },
            include: { evidence: true },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.impactMetric.findMany({
            where: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: { in: winIds } },
        }),
        prisma.userExperience.findMany({
            where: {
                userId,
                id: { in: [...new Set(wins.map((win) => win.employerId).filter((id): id is string => !!id))] },
            },
            select: { id: true, company: true },
        }),
    ]);

    const linksByWin = new Map<string, LinkWithEvidence[]>();
    for (const link of links as LinkWithEvidence[]) {
        const bucket = linksByWin.get(link.claimRefId) ?? [];
        bucket.push(link);
        linksByWin.set(link.claimRefId, bucket);
    }
    const metricByWin = new Map(metrics.map((metric) => [metric.subjectId, metric]));
    const employerNames = new Map(employers.map((employer) => [employer.id, employer.company]));

    return wins.map((win) => {
        const winLinks = linksByWin.get(win.id) ?? [];
        const evidence: EvidenceView[] = winLinks.map((link) => {
            const presentation = describeEvidence(link.evidence);
            return {
                id: link.evidence.id,
                kind: link.evidence.kind,
                excerpt: link.evidence.excerpt,
                label: presentation.label,
                detail: presentation.detail,
                url: presentation.url,
                available: presentation.available,
                confirmedByUser: link.evidence.confirmedByUser,
            };
        });
        const impact = toImpactView(metricByWin.get(win.id));

        return {
            id: win.id,
            title: win.title,
            narrative: win.narrative,
            occurredAt: win.occurredAt,
            periodEnd: win.periodEnd,
            category: win.category,
            status: win.status,
            sensitivity: win.sensitivity,
            source: win.source,
            sourceRef: win.sourceRef,
            employerId: win.employerId,
            employerName: win.employerId ? employerNames.get(win.employerId) ?? null : null,
            projectId: win.projectId,
            skills: asStringArray(win.skills),
            collaborators: asStringArray(win.collaborators),
            confidence: win.confidence,
            confirmedAt: win.confirmedAt,
            createdAt: win.createdAt,
            impact,
            evidence,
            groundState: deriveGroundState(win, winLinks),
            quantifyPrompt: impact ? null : quantifyPromptFor(win.category),
        };
    });
}

export async function getWinView(userId: string, winId: string): Promise<Result<WinView>> {
    const win = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!win) return err('Win not found', 'not_found');
    const [view] = await buildWinViews(userId, [win]);
    return ok(view);
}

// ═══════════════════════════════════════════════════════════════ create

export type NewWinInput = {
    userId: string;
    title: string;
    narrative?: string;
    occurredAt: Date;
    periodEnd?: Date | null;
    category: WinCategory;
    sensitivity?: WinSensitivity;
    source: WinSource;
    sourceRef?: string | null;
    signalId?: string | null;
    /** Omit to resolve by date; pass `null` to record "unknown" explicitly. */
    employerId?: string | null;
    projectId?: string | null;
    skills?: string[];
    collaborators?: string[];
    confidence?: number;
    impact?: ImpactInput | null;
};

/**
 * Creates a `draft` Win, plus its `ImpactMetric` when the draft actually
 * captured a quantity. The metric is written here rather than at confirm time
 * because the numbers arrive with the draft and there is nowhere else to keep
 * them; the confirm transaction then only has to guarantee the link exists.
 */
export async function createWinRecord(input: NewWinInput): Promise<Win> {
    const employerId =
        input.employerId === undefined
            ? await resolveEmployerId({ userId: input.userId, occurredAt: input.occurredAt })
            : input.employerId;

    const win = await prisma.win.create({
        data: {
            userId: input.userId,
            title: input.title.slice(0, MAX_TITLE_LENGTH),
            narrative: input.narrative ?? '',
            occurredAt: input.occurredAt,
            periodEnd: input.periodEnd ?? null,
            category: input.category,
            status: WinStatus.draft,
            sensitivity: input.sensitivity ?? WinSensitivity.shareable,
            source: input.source,
            sourceRef: input.sourceRef ?? null,
            signalId: input.signalId ?? null,
            employerId,
            projectId: input.projectId ?? null,
            skills: (input.skills ?? []) as Prisma.InputJsonValue,
            collaborators: (input.collaborators ?? []) as Prisma.InputJsonValue,
            confidence: input.confidence ?? 0.5,
        },
    });

    if (!input.impact) return win;

    const metric = await prisma.impactMetric.create({
        data: {
            userId: input.userId,
            subjectType: WIN_SUBJECT_TYPE,
            subjectId: win.id,
            statement: win.title,
            metric: input.impact.metric,
            baseline: input.impact.baseline ?? null,
            result: input.impact.result ?? null,
            delta: input.impact.delta ?? null,
            scope: input.impact.scope ?? null,
            timeframe: input.impact.timeframe ?? null,
            source: IMPACT_SOURCE_BY_WIN_SOURCE[input.source],
        },
    });

    return prisma.win.update({ where: { id: win.id }, data: { impactMetricId: metric.id } });
}

// ═══════════════════════════════════════════════════════════════ patching

function patchData(patch: WinPatch | undefined): Prisma.WinUpdateInput {
    if (!patch) return {};
    const data: Prisma.WinUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title.slice(0, MAX_TITLE_LENGTH);
    if (patch.narrative !== undefined) data.narrative = patch.narrative;
    if (patch.occurredAt !== undefined) data.occurredAt = patch.occurredAt;
    if (patch.periodEnd !== undefined) data.periodEnd = patch.periodEnd;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.sensitivity !== undefined) data.sensitivity = patch.sensitivity;
    if (patch.employerId !== undefined) data.employerId = patch.employerId;
    if (patch.projectId !== undefined) data.projectId = patch.projectId;
    if (patch.skills !== undefined) data.skills = patch.skills as Prisma.InputJsonValue;
    if (patch.collaborators !== undefined) data.collaborators = patch.collaborators as Prisma.InputJsonValue;
    return data;
}

/** PRD 01 §9.1: re-embed when any of these changed. */
function touchesEmbedding(patch: WinPatch | undefined): boolean {
    if (!patch) return false;
    return (
        patch.title !== undefined ||
        patch.narrative !== undefined ||
        patch.skills !== undefined ||
        patch.sensitivity !== undefined
    );
}

// ═══════════════════════════════════════════════════════════════ confirm

/**
 * PRD 01 §7.1, verbatim. Idempotent: re-confirming reuses the existing
 * Evidence/ClaimLink pair for each artifact key rather than adding a second.
 *
 * The embed is enqueued AFTER the transaction commits and only when the Win is
 * shareable — a job enqueued inside a transaction that rolls back would embed a
 * Win that does not exist.
 */
export async function confirmWin(params: {
    userId: string;
    winId: string;
    patch?: WinPatch;
    /** What the user typed into the `needs_confirmation` GroundChip, if anything. */
    userSource?: string | null;
    now?: Date;
}): Promise<Result<WinView>> {
    const { userId, winId } = params;
    const now = params.now ?? new Date();

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');

    const wasEmbeddedPointId = existing.qdrantPointId;
    const nextSensitivity = params.patch?.sensitivity ?? existing.sensitivity;
    const losesEmbedding = existing.embedded && nextSensitivity !== WinSensitivity.shareable;

    const win = await prisma.$transaction(async (tx) => {
        const updated = await tx.win.update({
            where: { id: winId },
            data: {
                ...patchData(params.patch),
                status: WinStatus.confirmed,
                confirmedAt: existing.confirmedAt ?? now,
                dismissedReason: null,
                ...(losesEmbedding ? { embedded: false, qdrantPointId: null } : {}),
            },
        });

        const links = await tx.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId },
            include: { evidence: true },
        });
        const seen = new Set(
            (links as LinkWithEvidence[]).map((link) => `${link.evidence.kind}|${link.evidence.sourceRef}`),
        );

        for (const artifact of sourceArtifactsFor(updated, params.userSource)) {
            if (seen.has(artifact.key)) continue;
            const evidence = await tx.evidence.create({
                data: {
                    userId,
                    kind: artifact.kind,
                    sourceRef: artifact.sourceRef,
                    excerpt: artifact.excerpt,
                    confidence: updated.confidence,
                    // The whole point (PRD 01 §7.1, CLAUDE.md rule 5).
                    confirmedByUser: true,
                },
            });
            await tx.claimLink.create({
                data: {
                    userId,
                    claimType: WIN_CLAIM_TYPE,
                    claimRefId: winId,
                    evidenceId: evidence.id,
                    groundState: GroundState.grounded,
                },
            });
            seen.add(artifact.key);
        }

        // Pre-existing links from an earlier lifecycle resolve UP only here,
        // where the user has just asserted the Win is true.
        if (links.length > 0) {
            await tx.claimLink.updateMany({
                where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId },
                data: { groundState: GroundState.grounded },
            });
            await tx.evidence.updateMany({
                where: { id: { in: links.map((link) => link.evidenceId) } },
                data: { confirmedByUser: true },
            });
        }

        return updated;
    });

    if (losesEmbedding) {
        await deleteWinPoint({ winId, storedPointId: wasEmbeddedPointId });
    } else if (mayEmbed(win)) {
        await enqueueEmbedWin(win);
    }

    return getWinView(userId, winId);
}

export async function bulkConfirm(params: {
    userId: string;
    winIds: string[];
}): Promise<Result<BulkResult>> {
    const { userId } = params;
    const result: BulkResult = { ok: [], failed: [] };
    // Sequential on purpose: each confirm is a transaction plus an enqueue, and
    // a bulk action from the review queue is at most a screenful of Wins.
    for (const winId of params.winIds) {
        try {
            const confirmed = await confirmWin({ userId, winId });
            if (confirmed.success) result.ok.push(winId);
            else result.failed.push({ winId, error: confirmed.error });
        } catch (error) {
            result.failed.push({ winId, error: error instanceof Error ? error.message : 'confirm failed' });
        }
    }
    return ok(result);
}

// ═══════════════════════════════════════════════════════════════ un-confirm

/**
 * The complete reversal (CLAUDE.md rule 5, PRD 01 §4.4).
 *
 * Order matters: Postgres first, Qdrant second. An embed run that is still in
 * flight will then fail its conditional `updateMany` — because the Win is no
 * longer `confirmed` — and delete the point it wrote. Deleting the point first
 * would leave that run free to re-create it.
 */
export async function unconfirmWin(params: { userId: string; winId: string }): Promise<Result<WinView>> {
    const { userId, winId } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');

    const storedPointId = existing.qdrantPointId;

    await prisma.$transaction(async (tx) => {
        const links = await tx.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId },
            select: { id: true, evidenceId: true },
        });

        if (links.length > 0) {
            // ClaimLink cascades from Evidence; delete both explicitly anyway so
            // this reads as the exact inverse of confirm.
            await tx.claimLink.deleteMany({ where: { id: { in: links.map((link) => link.id) } } });
            await tx.evidence.deleteMany({ where: { id: { in: links.map((link) => link.evidenceId) } } });
        }

        await tx.win.update({
            where: { id: winId },
            data: {
                status: WinStatus.draft,
                confirmedAt: null,
                embedded: false,
                qdrantPointId: null,
            },
        });
    });

    try {
        await deleteWinPoint({ winId, storedPointId });
    } catch (error) {
        // The claim is already un-grounded, which is the fail-closed direction.
        // The weekly reconcile job sweeps the orphaned point.
        console.error('[winGraph] qdrant point delete failed on un-confirm', {
            winId,
            error: error instanceof Error ? error.message : String(error),
        });
        return err('Un-confirmed, but the search index could not be updated', 'qdrant_delete_failed');
    }

    return getWinView(userId, winId);
}

// ═══════════════════════════════════════════════════════════════ update

export async function updateWin(params: {
    userId: string;
    winId: string;
    patch: WinPatch;
}): Promise<Result<WinView>> {
    const { userId, winId, patch } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');

    const nextSensitivity = patch.sensitivity ?? existing.sensitivity;
    const losesEmbedding =
        (existing.embedded || existing.qdrantPointId !== null) && nextSensitivity !== WinSensitivity.shareable;

    // A corrected date re-resolves attribution only when it was never resolved.
    // A Win that already names an employer keeps it (PRD 01 §12, "user changes jobs").
    const reresolveEmployer =
        patch.occurredAt !== undefined && patch.employerId === undefined && existing.employerId === null;
    const employerId = reresolveEmployer
        ? await resolveEmployerId({ userId, occurredAt: patch.occurredAt as Date })
        : undefined;

    const win = await prisma.win.update({
        where: { id: winId },
        data: {
            ...patchData(patch),
            ...(employerId !== undefined ? { employerId } : {}),
            ...(losesEmbedding ? { embedded: false, qdrantPointId: null } : {}),
        },
    });

    if (losesEmbedding) {
        // PRD 01 §12: synchronously, before returning success.
        await deleteWinPoint({ winId, storedPointId: existing.qdrantPointId });
    } else if (touchesEmbedding(patch) && mayEmbed(win)) {
        await enqueueEmbedWin(win);
    }

    return getWinView(userId, winId);
}

// ═══════════════════════════════════════════════════════════════ dismiss

export async function dismissWin(params: {
    userId: string;
    winId: string;
    reason: DismissReason;
}): Promise<Result<void>> {
    const { userId, winId, reason } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');

    // Dismissing something previously confirmed must not leave grounded claims
    // pointing at it. Reverse first, then dismiss.
    if (existing.status === WinStatus.confirmed || existing.qdrantPointId) {
        const reversed = await unconfirmWin({ userId, winId });
        if (!reversed.success) return err(reversed.error, reversed.code);
    }

    // Retained, never deleted: dismissed Wins train the noise filter (PRD 01 §4.4).
    await prisma.win.update({
        where: { id: winId },
        data: { status: WinStatus.dismissed, dismissedReason: reason, confirmedAt: null },
    });

    return ok(undefined);
}

// ═══════════════════════════════════════════ archive / unarchive / delete

/**
 * Archive hides a Win from the default log view but keeps it in packets and
 * exports (PRD 01 §4.4). The Qdrant point goes, because `externalRetrievalFilter`
 * only admits `confirmed` — leaving the vector behind would put the two halves
 * of ADR-8 out of step, which is exactly the failure that ADR is there to prevent.
 */
export async function archiveWin(params: { userId: string; winId: string }): Promise<Result<WinView>> {
    const { userId, winId } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');
    if (existing.status === WinStatus.archived) return getWinView(userId, winId);

    await prisma.win.update({
        where: { id: winId },
        data: { status: WinStatus.archived, embedded: false, qdrantPointId: null },
    });
    await deleteWinPoint({ winId, storedPointId: existing.qdrantPointId });

    return getWinView(userId, winId);
}

/**
 * Restores the status the Win would have had. Derived rather than stored: a Win
 * with grounded evidence was confirmed, one without was a draft. That keeps
 * archive reversible without a `previousStatus` column.
 */
export async function unarchiveWin(params: { userId: string; winId: string }): Promise<Result<WinView>> {
    const { userId, winId } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');
    if (existing.status !== WinStatus.archived) return getWinView(userId, winId);

    const grounded = await prisma.claimLink.count({
        where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId, groundState: GroundState.grounded },
    });
    const status = grounded > 0 ? WinStatus.confirmed : WinStatus.draft;

    const win = await prisma.win.update({
        where: { id: winId },
        data: {
            status,
            confirmedAt: status === WinStatus.confirmed ? existing.confirmedAt ?? new Date() : null,
        },
    });

    if (mayEmbed(win)) await enqueueEmbedWin(win);

    return getWinView(userId, winId);
}

/**
 * Permanent, and deliberately distinct from dismiss — a dismissed Win is
 * retained to train the noise filter (PRD 01 §4.4), a deleted one is gone
 * because the user asked for it to be gone.
 *
 * The vector goes first here, not last: after the row is deleted there is
 * nothing left to reconcile an orphaned point against.
 */
export async function deleteWin(params: { userId: string; winId: string }): Promise<Result<void>> {
    const { userId, winId } = params;

    const existing = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!existing) return err('Win not found', 'not_found');

    try {
        await deleteWinPoint({ winId, storedPointId: existing.qdrantPointId });
    } catch (error) {
        return err(
            error instanceof Error ? `Could not remove it from the search index: ${error.message}` : 'Delete failed',
            'qdrant_delete_failed',
        );
    }

    await prisma.$transaction(async (tx) => {
        const links = await tx.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: winId },
            select: { id: true, evidenceId: true },
        });
        if (links.length > 0) {
            await tx.claimLink.deleteMany({ where: { id: { in: links.map((link) => link.id) } } });
            await tx.evidence.deleteMany({ where: { id: { in: links.map((link) => link.evidenceId) } } });
        }
        await tx.impactMetric.deleteMany({
            where: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: winId },
        });
        await tx.win.delete({ where: { id: winId } });
    });

    return ok(undefined);
}

// ═══════════════════════════════════════════════════════════════ add impact

/**
 * Writes (or replaces) the Win's `ImpactMetric` from an already-parsed,
 * already-guarded impact. Parsing lives in `winDrafting.parseImpactAnswer`;
 * this function only persists, so it can never be the thing that invents a
 * number.
 */
export async function setWinImpact(params: {
    userId: string;
    winId: string;
    impact: ImpactInput;
}): Promise<Result<WinView>> {
    const { userId, winId, impact } = params;

    const win = await prisma.win.findFirst({ where: { id: winId, userId } });
    if (!win) return err('Win not found', 'not_found');

    const existing = await prisma.impactMetric.findFirst({
        where: { userId, subjectType: WIN_SUBJECT_TYPE, subjectId: winId },
        orderBy: { createdAt: 'asc' },
    });

    const data = {
        statement: win.title,
        metric: impact.metric,
        baseline: impact.baseline ?? null,
        result: impact.result ?? null,
        delta: impact.delta ?? null,
        scope: impact.scope ?? null,
        timeframe: impact.timeframe ?? null,
    };

    const metric = existing
        ? await prisma.impactMetric.update({ where: { id: existing.id }, data })
        : await prisma.impactMetric.create({
            data: {
                userId,
                subjectType: WIN_SUBJECT_TYPE,
                subjectId: winId,
                source: IMPACT_SOURCE_BY_WIN_SOURCE[win.source],
                ...data,
            },
        });

    if (win.impactMetricId !== metric.id) {
        await prisma.win.update({ where: { id: winId }, data: { impactMetricId: metric.id } });
    }

    return getWinView(userId, winId);
}

// ═══════════════════════════════════════════════════════════════ employers

/**
 * Most recent first. `UserExperience` stores dates as free-form strings, so the
 * sort is on the parsed start date with current roles pinned to the top;
 * unparseable rows fall to the bottom rather than sorting randomly.
 */
export async function listEmployers(params: { userId: string }): Promise<Result<EmployerOption[]>> {
    const rows = await prisma.userExperience.findMany({
        where: { userId: params.userId },
        select: { id: true, company: true, role: true, current: true, startDate: true, endDate: true },
    });

    const ranked = rows
        .map((row) => {
            const end = parseExperienceDate(row.endDate, 'end');
            const start = parseExperienceDate(row.startDate, 'start');
            const isCurrent = row.current || (row.endDate ?? '').trim() === '';
            return {
                option: { id: row.id, name: row.company, role: row.role, current: isCurrent },
                sortKey: (end ?? start)?.getTime() ?? Number.NEGATIVE_INFINITY,
                current: isCurrent,
            };
        })
        .sort((a, b) => {
            if (a.current !== b.current) return a.current ? -1 : 1;
            return b.sortKey - a.sortKey;
        });

    return ok(ranked.map((entry) => entry.option));
}

// ═══════════════════════════════════════════════════════════════ cursor

/** Opaque to callers. Encodes exactly the `(occurredAt, id)` sort key. */
export function encodeWinCursor(input: { occurredAt: Date; id: string }): WinCursor {
    return Buffer.from(`${input.occurredAt.toISOString()}|${input.id}`, 'utf8').toString('base64url');
}

export function decodeWinCursor(cursor: WinCursor): { occurredAt: Date; id: string } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
        const separator = decoded.indexOf('|');
        if (separator <= 0) return null;
        const occurredAt = new Date(decoded.slice(0, separator));
        const id = decoded.slice(separator + 1);
        if (Number.isNaN(occurredAt.getTime()) || !id) return null;
        return { occurredAt, id };
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════ list

/** Default view: the review queue plus the log. Dismissed and archived are opt-in. */
const DEFAULT_LIST_STATUSES: WinStatus[] = [WinStatus.draft, WinStatus.confirmed];

function baseWhere(userId: string, filters: WinFilters): Prisma.WinWhereInput {
    const where: Prisma.WinWhereInput = {
        userId,
        status: { in: filters.status && filters.status.length > 0 ? filters.status : DEFAULT_LIST_STATUSES },
    };

    if (filters.category && filters.category.length > 0) where.category = { in: filters.category };
    if (filters.employerId !== undefined) where.employerId = filters.employerId;

    if (filters.from || filters.to) {
        where.occurredAt = {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
        };
    }

    if (filters.search && filters.search.trim()) {
        const search = filters.search.trim();
        where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { narrative: { contains: search, mode: 'insensitive' } },
        ];
    }

    return where;
}

function withCursor(where: Prisma.WinWhereInput, cursor: { occurredAt: Date; id: string }): Prisma.WinWhereInput {
    return {
        AND: [
            where,
            {
                OR: [
                    { occurredAt: { lt: cursor.occurredAt } },
                    { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
                ],
            },
        ],
    };
}

export async function listWins(params: {
    userId: string;
    filters: WinFilters;
    cursor?: WinCursor;
    limit?: number;
    now?: Date;
}): Promise<Result<WinPage>> {
    const { userId, filters } = params;
    const limit = Math.min(Math.max(Math.floor(params.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const now = params.now ?? new Date();

    const tier = await getUserTier(userId);
    const cutoff = filters.includeBeyondHistoryLimit ? null : historyCutoff(tier, now);

    const unbounded = baseWhere(userId, filters);
    const visible: Prisma.WinWhereInput = cutoff
        ? { AND: [unbounded, { occurredAt: { gte: cutoff } }] }
        : unbounded;

    let paged = visible;
    if (params.cursor) {
        const decoded = decodeWinCursor(params.cursor);
        if (!decoded) return err('Invalid cursor', 'bad_cursor');
        paged = withCursor(visible, decoded);
    }

    const [rows, total, hiddenByPlan] = await Promise.all([
        prisma.win.findMany({
            where: paged,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        }),
        prisma.win.count({ where: visible }),
        cutoff
            ? prisma.win.count({ where: { AND: [unbounded, { occurredAt: { lt: cutoff } }] } })
            : Promise.resolve(0),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return ok({
        items: await buildWinViews(userId, page),
        nextCursor: hasMore && last ? encodeWinCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
        total,
        hiddenByPlan,
    });
}

// ═══════════════════════════════════════════════════════════════ summary

const WEEK_MS = 7 * 86_400_000;

/** Monday 00:00 UTC of the week containing `date`, as epoch ms. */
export function weekStartUtc(date: Date): number {
    const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const dayOfWeek = new Date(utc).getUTCDay(); // 0 = Sunday
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    return utc - daysSinceMonday * 86_400_000;
}

/**
 * Consecutive weeks ending now with at least one confirmed Win. The current
 * week is allowed to be empty without breaking the streak — on a Monday
 * morning you have not lost 19 weeks of habit (PRD 01 §6.1).
 */
export function computeStreakWeeks(occurredDates: Date[], now: Date = new Date()): number {
    if (occurredDates.length === 0) return 0;
    const weeks = new Set(occurredDates.map(weekStartUtc));
    let cursor = weekStartUtc(now);
    if (!weeks.has(cursor)) cursor -= WEEK_MS;
    let streak = 0;
    while (weeks.has(cursor)) {
        streak += 1;
        cursor -= WEEK_MS;
    }
    return streak;
}

export async function getLogSummary(params: {
    userId: string;
    range?: { from?: Date; to?: Date };
    now?: Date;
}): Promise<Result<LogSummary>> {
    const { userId } = params;
    const now = params.now ?? new Date();

    const rangeWhere: Prisma.WinWhereInput =
        params.range?.from || params.range?.to
            ? {
                occurredAt: {
                    ...(params.range.from ? { gte: params.range.from } : {}),
                    ...(params.range.to ? { lte: params.range.to } : {}),
                },
            }
            : {};

    const [confirmed, draftCount, groundedLinks] = await Promise.all([
        prisma.win.findMany({
            where: { userId, status: WinStatus.confirmed, ...rangeWhere },
            select: { id: true, occurredAt: true, category: true, impactMetricId: true },
            orderBy: { occurredAt: 'asc' },
        }),
        prisma.win.count({ where: { userId, status: WinStatus.draft, ...rangeWhere } }),
        prisma.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, groundState: GroundState.grounded },
            select: { claimRefId: true },
            distinct: ['claimRefId'],
        }),
    ]);

    const grounded = new Set(groundedLinks.map((link) => link.claimRefId));
    const counts = new Map<WinCategory, number>();
    for (const win of confirmed) counts.set(win.category, (counts.get(win.category) ?? 0) + 1);

    return ok({
        totalConfirmed: confirmed.length,
        withEvidence: confirmed.filter((win) => grounded.has(win.id)).length,
        withImpact: confirmed.filter((win) => win.impactMetricId !== null).length,
        draftCount,
        streakWeeks: computeStreakWeeks(confirmed.map((win) => win.occurredAt), now),
        categoryMix: ALL_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 })).filter(
            (entry) => entry.count > 0,
        ),
        // A category with nothing in it is the coaching line on the right rail:
        // a log that is 90% `shipped` is a promo case that will fail.
        gaps: ALL_CATEGORIES.filter((category) => (counts.get(category) ?? 0) === 0),
        recordStart: confirmed.length > 0 ? confirmed[0].occurredAt : null,
    });
}
