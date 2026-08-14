/**
 * The GitHub adapter — PRD 02 §3.
 *
 * The first `CaptureAdapter`, and the one the framework was shaped around. It
 * is deliberately the only file in `src/lib/capture/github/` that knows about
 * both the provider and the product: the client knows GitHub, the noise and
 * grouping modules know the product, and this joins them.
 *
 * ── The cursor contract ───────────────────────────────────────────────────
 * `nextCursor` is an ISO timestamp meaning "everything up to here has been
 * fully processed". Because we pull several signal kinds with independent
 * pagination, the cursor is the MINIMUM high-water mark across kinds — never
 * the maximum. A run that finished merged PRs but ran out of budget during
 * reviews must not advance past the reviews it never looked at.
 *
 * That is the whole reason a rate limit is survivable: we lose progress, never
 * data, and the next run completes the window (§3.3, §12).
 */

import type { CaptureSourceKind } from '@prisma/client';
import { MAX_REQUESTS_PER_SYNC } from '../caps';
import { groupGithubSignals } from './grouping';
import { classifyGithubNoise, hardExclusion } from './noise';
import {
    EMPTY_GITHUB_METADATA,
    parseGithubMetadata,
    type GithubSignalMetadata,
    type LinkedIssue,
} from './types';
import {
    isRecoverablePullError,
    type GithubApi,
    type IssueDetail,
    type PullDetail,
    type SearchIssueItem,
} from './client';
import type {
    Attribution,
    CaptureAdapter,
    ConnectResult,
    NoiseVerdict,
    PullOptions,
    PullResult,
    RawSignal,
    SignalGroup,
    SourceConfig,
    SourceContext,
} from '../types';

export const GITHUB_KIND = 'github' as CaptureSourceKind;

/** Search page size. 50 keeps a page under the 1,000-result search ceiling per query. */
const SEARCH_PER_PAGE = 50;

/** Pages per query. Two pages × 50 is more merged PRs than 90 days holds for almost anyone. */
const MAX_SEARCH_PAGES = 2;

/**
 * Stop spending detail requests once the budget is this close to gone, so a
 * pull always has room to finish bookkeeping rather than dying mid-item.
 */
const DETAIL_RESERVE = 2;

/** File paths cost a request each; only worth it while the budget is comfortable. */
const FILE_PATHS_BUDGET_FRACTION = 0.6;

// ───────────────────────────────────────────────────── pure helpers

/** `closes #12`, `fixes patronus/api#12`, `resolves GH-12`. */
const LINKED_ISSUE_PATTERN =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]+(?:([\w.-]+\/[\w.-]+))?#(\d+)/gi;

export function parseLinkedIssueRefs(body: string, defaultRepo: string): Array<{ repo: string; number: number }> {
    const out: Array<{ repo: string; number: number }> = [];
    const seen = new Set<string>();
    for (const match of (body ?? '').matchAll(LINKED_ISSUE_PATTERN)) {
        const repo = match[1] || defaultRepo;
        const number = Number(match[2]);
        if (!repo || !Number.isInteger(number) || number <= 0) continue;
        const token = `${repo}#${number}`;
        if (seen.has(token)) continue;
        seen.add(token);
        out.push({ repo, number });
    }
    return out;
}

/**
 * Top-level directories, best effort and in cost order:
 *   1. real file paths, when we could afford them
 *   2. the conventional-commit scope — `perf(checkout):` is the author telling
 *      us the area, for free
 *   3. `area/*` and `team/*` labels, same idea from the other direction
 */
export function deriveTopDirs(input: {
    filePaths?: readonly string[];
    title: string;
    labels: readonly string[];
}): string[] {
    const dirs = new Set<string>();

    for (const path of input.filePaths ?? []) {
        const segments = path.split('/').filter(Boolean);
        if (segments.length <= 1) continue;
        // "src/lib/capture/x.ts" -> "src/lib"; a bare "src" groups half the repo.
        dirs.add(segments.length >= 3 ? `${segments[0]}/${segments[1]}` : segments[0]);
    }
    if (dirs.size > 0) return [...dirs].slice(0, 8);

    const scope = /^\s*[a-z]+\s*\(([^)]+)\)/i.exec(input.title ?? '');
    if (scope) {
        for (const part of scope[1].split(/[,/]/)) {
            const trimmed = part.trim().toLowerCase();
            if (trimmed) dirs.add(`scope:${trimmed}`);
        }
    }

    for (const label of input.labels ?? []) {
        const match = /^(?:area|team|component|module)[/:]\s*(.+)$/i.exec(label.trim());
        if (match) dirs.add(`scope:${match[1].trim().toLowerCase()}`);
    }

    return [...dirs].slice(0, 8);
}

export function truncateBody(body: string, max = 1_200): string {
    const text = (body ?? '').replace(/\r\n/g, '\n').trim();
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isoOrNull(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value: string | null | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

/** GitHub search wants `YYYY-MM-DD`; a finer grain is not honoured. */
export function searchDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * The queries, in one place so a scoping mistake is visible.
 *
 * Deliberately NOT repo-scoped. A `repo:` qualifier per selected repo blows the
 * 256-character query limit at ~12 repos and costs a query per batch; filtering
 * locally against `includedRepos` costs nothing and is the same answer. It also
 * means the allow-list is enforced by our code rather than by a query string we
 * might get wrong, which is the safer place for a privacy promise to live.
 */
export function buildQueries(login: string, since: Date): { merged: string; reviewed: string; issues: string } {
    const from = searchDate(since);
    return {
        merged: `is:pr is:merged author:${login} merged:>=${from}`,
        reviewed: `is:pr reviewed-by:${login} -author:${login} updated:>=${from}`,
        issues: `is:issue is:closed assignee:${login} closed:>=${from}`,
    };
}

// ───────────────────────────────────────────────────── signal builders

function metadataFor(base: Partial<GithubSignalMetadata>): GithubSignalMetadata {
    return { ...EMPTY_GITHUB_METADATA, ...base };
}

export function signalFromPull(params: {
    pull: PullDetail;
    role: 'author' | 'reviewer';
    linkedIssue: LinkedIssue | null;
    filePaths?: readonly string[];
    reviewState?: string | null;
    reviewBody?: string;
    reviewCommentsByOthers?: number;
    occurredAt: Date;
}): RawSignal {
    const { pull } = params;
    const metadata = metadataFor({
        repo: pull.repo,
        repoPrivate: pull.repoPrivate,
        role: params.role,
        number: pull.number,
        labels: pull.labels,
        filesChanged: pull.changedFiles,
        additions: pull.additions,
        deletions: pull.deletions,
        reviewCommentsByOthers: params.reviewCommentsByOthers ?? pull.reviewComments,
        linkedIssue: params.linkedIssue,
        authorLogin: pull.authorLogin,
        authorType: pull.authorType,
        branch: pull.branch,
        openedAt: isoOrNull(pull.createdAt),
        topDirs: deriveTopDirs({ filePaths: params.filePaths, title: pull.title, labels: pull.labels }),
        reviewState: (params.reviewState as GithubSignalMetadata['reviewState']) ?? null,
        reviewBody: params.reviewBody ?? '',
        isRevert: /^\s*revert\s+/i.test(pull.title),
    });

    return {
        externalId: params.role === 'reviewer' ? `review:${pull.nodeId}` : pull.nodeId,
        kind: params.role === 'reviewer' ? 'pr_reviewed' : 'pr_merged',
        occurredAt: params.occurredAt,
        title: pull.title,
        body: truncateBody(pull.body),
        url: pull.htmlUrl,
        metadata,
    };
}

export function signalFromIssue(issue: IssueDetail, occurredAt: Date): RawSignal {
    return {
        externalId: issue.nodeId,
        kind: 'issue_closed',
        occurredAt,
        title: issue.title,
        body: truncateBody(issue.body),
        url: issue.htmlUrl,
        metadata: metadataFor({
            repo: issue.repo,
            role: 'author',
            number: issue.number,
            labels: issue.labels,
            authorLogin: issue.closedByLogin,
            topDirs: deriveTopDirs({ title: issue.title, labels: issue.labels }),
        }),
    };
}

function searchItemToIssueDetail(item: SearchIssueItem): IssueDetail {
    return {
        nodeId: item.nodeId,
        number: item.number,
        title: item.title,
        body: item.body,
        htmlUrl: item.htmlUrl,
        repo: item.repo,
        labels: item.labels,
        closedAt: item.closedAt,
        closedByLogin: item.authorLogin,
    };
}

// ───────────────────────────────────────────────────── the adapter

export type GithubAdapterDeps = {
    /** Built per sync so the request budget is per-run. */
    createApi: (source: SourceContext, maxRequests: number) => GithubApi;
};

export function createGithubAdapter(deps: GithubAdapterDeps): CaptureAdapter {
    return {
        kind: GITHUB_KIND,
        displayName: 'GitHub',

        async connect(_userId: string, params: unknown): Promise<ConnectResult> {
            const record = (params ?? {}) as { login?: unknown; scopes?: unknown };
            const login = typeof record.login === 'string' ? record.login.trim() : '';
            if (!login) throw new Error('github connect requires a login');
            const scopes = Array.isArray(record.scopes)
                ? record.scopes.filter((scope): scope is string => typeof scope === 'string')
                : [];
            return { externalAccountId: login, scopes };
        },

        isNoise(signal: RawSignal, config: SourceConfig): NoiseVerdict {
            return classifyGithubNoise(
                { title: signal.title, body: signal.body, metadata: parseGithubMetadata(signal.metadata) },
                config,
            );
        },

        group(signals: RawSignal[]): SignalGroup[] {
            return groupGithubSignals(signals);
        },

        attribution(signal: RawSignal): Attribution {
            const meta = parseGithubMetadata(signal.metadata);
            const label =
                signal.kind === 'pr_reviewed'
                    ? `Review on ${meta.repo} #${meta.number}`
                    : signal.kind === 'issue_closed'
                      ? `${meta.repo} issue #${meta.number}`
                      : signal.kind === 'release_published'
                        ? `${meta.repo} release`
                        : `${meta.repo} PR #${meta.number}`;
            return { label, url: signal.url };
        },

        async pull(source: SourceContext, since: Date | null, opts: PullOptions = {}): Promise<PullResult> {
            const now = opts.now ?? new Date();
            const maxRequests = opts.maxRequests ?? MAX_REQUESTS_PER_SYNC;
            const api = deps.createApi(source, maxRequests);
            const login = source.externalAccountId;
            const windowStart = since ?? new Date(now.getTime() - 90 * 86_400_000);

            const signals: RawSignal[] = [];
            const warnings: string[] = [];
            let partial = false;

            // High-water marks per kind. A kind that completes reaches `now`; a
            // kind cut short by the budget stops at its last processed item.
            let mergedWatermark = windowStart;
            let reviewedWatermark = windowStart;
            let issuesWatermark = windowStart;

            const queries = buildQueries(login, windowStart);
            const budgetLeft = (): number => maxRequests - api.requestsUsed();
            const canSpendDetail = (): boolean => budgetLeft() > DETAIL_RESERVE;
            const canSpendFilePaths = (): boolean =>
                budgetLeft() > maxRequests * (1 - FILE_PATHS_BUDGET_FRACTION) + DETAIL_RESERVE;

            /** Issues we already have, so a linked-issue lookup is usually free. */
            const issueCache = new Map<string, IssueDetail>();

            const collectSearch = async (query: string): Promise<SearchIssueItem[]> => {
                const items: SearchIssueItem[] = [];
                for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
                    if (!canSpendDetail()) break;
                    const result = await api.searchIssues(query, page, SEARCH_PER_PAGE, {
                        sort: 'updated',
                        order: 'asc',
                    });
                    items.push(...result.items);
                    if (result.items.length < SEARCH_PER_PAGE) break;
                }
                return items;
            };

            const inScope = (repo: string): boolean =>
                source.config.includedRepos.length === 0 ||
                source.config.includedRepos.some((entry) => entry.toLowerCase() === repo.toLowerCase());

            const resolveLinkedIssue = async (repo: string, body: string): Promise<LinkedIssue | null> => {
                const refs = parseLinkedIssueRefs(body, repo);
                for (const ref of refs) {
                    const token = `${ref.repo}#${ref.number}`;
                    const cached = issueCache.get(token);
                    if (cached) {
                        return { number: cached.number, title: cached.title, body: truncateBody(cached.body, 600), url: cached.htmlUrl };
                    }
                    if (!canSpendFilePaths()) continue; // same "is the budget comfortable" test
                    try {
                        const issue = await api.getIssue(ref.repo, ref.number);
                        issueCache.set(token, issue);
                        return { number: issue.number, title: issue.title, body: truncateBody(issue.body, 600), url: issue.htmlUrl };
                    } catch (error: unknown) {
                        if (isRecoverablePullError(error)) throw error;
                        // A deleted or inaccessible issue is not a sync failure.
                        warnings.push(`linked issue ${token} unavailable`);
                    }
                }
                return null;
            };

            try {
                // ── issues first: cheap (one search, no detail calls) and it warms
                //    the cache that PR linked-issue resolution reads from.
                const issueItems = await collectSearch(queries.issues);
                for (const item of issueItems) {
                    if (item.isPullRequest) continue;
                    const detail = searchItemToIssueDetail(item);
                    issueCache.set(`${detail.repo}#${detail.number}`, detail);
                    if (!inScope(detail.repo)) continue;

                    const occurredAt = toDate(detail.closedAt, now);
                    const signal = signalFromIssue(detail, occurredAt);
                    if (!hardExclusion({ title: signal.title, body: signal.body, metadata: parseGithubMetadata(signal.metadata) }).noise) {
                        signals.push(signal);
                    }
                    issuesWatermark = occurredAt > issuesWatermark ? occurredAt : issuesWatermark;
                }
                issuesWatermark = now;

                // ── merged PRs: the highest-signal artefact, so they get the budget first.
                const mergedItems = await collectSearch(queries.merged);
                for (const item of mergedItems) {
                    if (!inScope(item.repo)) continue;

                    // Layer 1 on the *search* row, before spending a detail request.
                    // A dependabot PR must never cost us anything.
                    const cheapVerdict = hardExclusion({
                        title: item.title,
                        body: item.body,
                        metadata: metadataFor({
                            repo: item.repo,
                            authorLogin: item.authorLogin,
                            authorType: item.authorType,
                            role: 'author',
                            // additions/deletions unknown here; the 0-net rule is
                            // re-checked after the detail fetch.
                            additions: 1,
                        }),
                    });
                    if (cheapVerdict.noise) continue;

                    if (!canSpendDetail()) {
                        partial = true;
                        break;
                    }

                    const pull = await api.getPullRequest(item.repo, item.number);
                    if (!pull.merged) continue;

                    const filePaths = canSpendFilePaths()
                        ? await api.listPullFilePaths(item.repo, item.number).catch((error: unknown) => {
                              if (isRecoverablePullError(error)) throw error;
                              return [] as string[];
                          })
                        : undefined;

                    const linkedIssue = await resolveLinkedIssue(pull.repo, pull.body);
                    const occurredAt = toDate(pull.mergedAt, now);
                    signals.push(
                        signalFromPull({ pull, role: 'author', linkedIssue, filePaths, occurredAt }),
                    );
                    mergedWatermark = occurredAt > mergedWatermark ? occurredAt : mergedWatermark;
                }
                if (!partial) mergedWatermark = now;

                // ── reviews: two requests each (detail + reviews), so they run last.
                if (!partial) {
                    const reviewedItems = await collectSearch(queries.reviewed);
                    for (const item of reviewedItems) {
                        if (!inScope(item.repo)) continue;
                        if (budgetLeft() <= DETAIL_RESERVE + 1) {
                            partial = true;
                            break;
                        }

                        const reviews = await api.listReviews(item.repo, item.number);
                        const mine = reviews
                            .filter((review) => review.authorLogin.toLowerCase() === login.toLowerCase())
                            .sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0));
                        if (mine.length === 0) continue;

                        const best = mine[0];
                        const occurredAt = toDate(best.submittedAt ?? item.closedAt, now);
                        const pull = await api.getPullRequest(item.repo, item.number);
                        signals.push(
                            signalFromPull({
                                pull,
                                role: 'reviewer',
                                linkedIssue: null,
                                reviewState: best.state,
                                reviewBody: best.body,
                                reviewCommentsByOthers: reviews.filter(
                                    (review) => review.authorLogin.toLowerCase() !== login.toLowerCase(),
                                ).length,
                                occurredAt,
                            }),
                        );
                        reviewedWatermark = occurredAt > reviewedWatermark ? occurredAt : reviewedWatermark;
                    }
                    if (!partial) reviewedWatermark = now;
                }
            } catch (error: unknown) {
                if (!isRecoverablePullError(error)) throw error;
                // Rate limited or out of budget: keep everything already collected
                // and let the cursor say how far we actually got (§3.3).
                partial = true;
                warnings.push(error instanceof Error ? error.message : 'pull interrupted');
            }

            // The minimum, never the maximum. See the cursor contract above.
            const watermark = new Date(
                Math.min(mergedWatermark.getTime(), reviewedWatermark.getTime(), issuesWatermark.getTime()),
            );

            return {
                signals,
                nextCursor: watermark.toISOString(),
                partial,
                requestsUsed: api.requestsUsed(),
                warnings,
            };
        },
    };
}
