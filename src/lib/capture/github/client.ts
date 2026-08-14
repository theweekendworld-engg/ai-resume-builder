/**
 * The GitHub read surface, behind one interface.
 *
 * Two reasons this is an interface and not direct Octokit calls in the adapter:
 *
 *   1. The adapter is the part with product logic in it (what counts as a
 *      signal, what gets grouped, what gets dropped). It has to be testable
 *      against the labelled fixture corpus with no network, and the corpus is
 *      the acceptance gate for the whole feature.
 *   2. The request budget (§3.3: ≤60 per sync) and the rate-limit contract
 *      (403/429 → partial, resumable) are properties of *this* layer. Keeping
 *      them here means the adapter cannot accidentally spend requests in a loop.
 *
 * We never request diffs or file contents. The narrowest thing that answers the
 * question is the only thing we ask for (§3.2).
 */

import { Octokit } from 'octokit';
import { MAX_REQUESTS_PER_SYNC } from '../caps';

// ───────────────────────────────────────────────────────────── errors

/** Thrown on 403/429. The caller persists the cursor and reports `partial`. */
export class GithubRateLimitError extends Error {
    readonly status: number;
    readonly retryAfterMs: number | null;

    constructor(status: number, retryAfterMs: number | null = null) {
        super(`github rate limit (status ${status})`);
        this.name = 'GithubRateLimitError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/** Thrown when the sync has spent its request budget. Same handling as a 403. */
export class GithubBudgetExhaustedError extends Error {
    constructor(budget: number) {
        super(`github request budget of ${budget} exhausted`);
        this.name = 'GithubBudgetExhaustedError';
    }
}

export function isRecoverablePullError(error: unknown): boolean {
    return error instanceof GithubRateLimitError || error instanceof GithubBudgetExhaustedError;
}

function statusOf(error: unknown): number | null {
    if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status?: unknown }).status;
        if (typeof status === 'number') return status;
    }
    return null;
}

function retryAfterMsOf(error: unknown): number | null {
    if (!error || typeof error !== 'object' || !('response' in error)) return null;
    const response = (error as { response?: { headers?: Record<string, string> } }).response;
    const raw = response?.headers?.['retry-after'];
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

// ───────────────────────────────────────────────────────────── wire shapes

export type SearchIssueItem = {
    /** The GraphQL node id. THE identity — never the number (§5). */
    nodeId: string;
    number: number;
    title: string;
    body: string;
    htmlUrl: string;
    /** "owner/name", parsed from `repository_url`. */
    repo: string;
    labels: string[];
    authorLogin: string;
    authorType: 'User' | 'Bot';
    createdAt: string;
    closedAt: string | null;
    pullRequestMergedAt: string | null;
    isPullRequest: boolean;
    /** Comments from anyone, including the author. Refined per-PR when we fetch detail. */
    commentCount: number;
};

export type SearchPage = { items: SearchIssueItem[]; totalCount: number; incompleteResults: boolean };

export type PullDetail = {
    nodeId: string;
    number: number;
    title: string;
    body: string;
    htmlUrl: string;
    repo: string;
    repoPrivate: boolean;
    labels: string[];
    authorLogin: string;
    authorType: 'User' | 'Bot';
    branch: string;
    createdAt: string;
    mergedAt: string | null;
    merged: boolean;
    additions: number;
    deletions: number;
    changedFiles: number;
    reviewComments: number;
    comments: number;
};

export type ReviewSummary = {
    id: number;
    authorLogin: string;
    state: string;
    body: string;
    submittedAt: string | null;
};

export type ReleaseSummary = {
    nodeId: string;
    name: string;
    tagName: string;
    body: string;
    htmlUrl: string;
    authorLogin: string;
    publishedAt: string | null;
    draft: boolean;
    prerelease: boolean;
};

export type RepoSummary = {
    fullName: string;
    private: boolean;
    fork: boolean;
    archived: boolean;
    pushedAt: string | null;
    /** Null when the provider did not report it. */
    contributionsLast90d: number | null;
};

export type SearchSort = {
    sort?: 'updated' | 'created';
    /** Ascending is the default for a reason: see `pull`'s cursor contract. */
    order?: 'asc' | 'desc';
};

export type IssueDetail = {
    nodeId: string;
    number: number;
    title: string;
    body: string;
    htmlUrl: string;
    repo: string;
    labels: string[];
    closedAt: string | null;
    /** Who closed it, when the API tells us. */
    closedByLogin: string;
};

export interface GithubApi {
    /** One page of `GET /search/issues`. */
    searchIssues(query: string, page: number, perPage: number, sort?: SearchSort): Promise<SearchPage>;
    getPullRequest(repo: string, number: number): Promise<PullDetail>;
    /** Only called when a PR links an issue we did not already have. */
    getIssue(repo: string, number: number): Promise<IssueDetail>;
    listReviews(repo: string, number: number): Promise<ReviewSummary[]>;
    /**
     * File PATHS only — never contents, never a diff. Paths are what tell us a
     * refactor spread over six PRs touched the same top-level directory (§4.1),
     * and they are the most we ever learn about the code itself.
     */
    listPullFilePaths(repo: string, number: number): Promise<string[]>;
    listReleases(repo: string): Promise<ReleaseSummary[]>;
    listRepos(): Promise<RepoSummary[]>;
    /** Requests spent so far. Read by the adapter for the run record. */
    requestsUsed(): number;
}

// ───────────────────────────────────────────────────────────── octokit impl

function splitRepo(fullName: string): { owner: string; repo: string } {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) throw new Error(`invalid repo "${fullName}"`);
    return { owner, repo };
}

function repoFromApiUrl(repositoryUrl: string): string {
    // "https://api.github.com/repos/patronus/api" -> "patronus/api"
    const match = /\/repos\/([^/]+\/[^/]+)/.exec(repositoryUrl ?? '');
    return match ? match[1] : '';
}

function labelNames(labels: unknown): string[] {
    if (!Array.isArray(labels)) return [];
    return labels
        .map((label) => {
            if (typeof label === 'string') return label;
            if (label && typeof label === 'object' && 'name' in label) {
                const name = (label as { name?: unknown }).name;
                return typeof name === 'string' ? name : '';
            }
            return '';
        })
        .filter(Boolean);
}

export type OctokitApiOptions = {
    token?: string;
    maxRequests?: number;
    /** Injected in tests; defaults to a real Octokit. */
    octokit?: Octokit;
};

/**
 * Budgeted Octokit. Every call goes through `spend()`, which is the only place
 * that can raise `GithubBudgetExhaustedError` — so "≤60 requests per sync" is a
 * property of the type, not a comment someone has to remember.
 */
export class OctokitGithubApi implements GithubApi {
    private readonly octokit: Octokit;
    private readonly budget: number;
    private spent = 0;

    constructor(options: OctokitApiOptions = {}) {
        this.budget = options.maxRequests ?? MAX_REQUESTS_PER_SYNC;
        this.octokit =
            options.octokit ??
            new Octokit({
                ...(options.token ? { auth: options.token } : {}),
                request: { timeout: 10_000 },
            });
    }

    requestsUsed(): number {
        return this.spent;
    }

    private async spend<T>(run: () => Promise<T>): Promise<T> {
        if (this.spent >= this.budget) throw new GithubBudgetExhaustedError(this.budget);
        this.spent += 1;
        try {
            return await run();
        } catch (error: unknown) {
            const status = statusOf(error);
            // 403 is GitHub's secondary-rate-limit response as well as its
            // permission denial; both mean "stop pulling and resume later",
            // and a resumable partial beats a failed digest either way.
            if (status === 403 || status === 429) {
                throw new GithubRateLimitError(status, retryAfterMsOf(error));
            }
            throw error;
        }
    }

    async searchIssues(
        query: string,
        page: number,
        perPage: number,
        sort: SearchSort = { sort: 'updated', order: 'asc' },
    ): Promise<SearchPage> {
        const response = await this.spend(() =>
            this.octokit.request('GET /search/issues', {
                q: query,
                per_page: perPage,
                page,
                ...(sort.sort ? { sort: sort.sort } : {}),
                ...(sort.order ? { order: sort.order } : {}),
                advanced_search: 'true',
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );

        const items: SearchIssueItem[] = response.data.items.map((item) => ({
            nodeId: item.node_id,
            number: item.number,
            title: item.title ?? '',
            body: item.body ?? '',
            htmlUrl: item.html_url,
            repo: repoFromApiUrl(item.repository_url),
            labels: labelNames(item.labels),
            authorLogin: item.user?.login ?? '',
            authorType: item.user?.type === 'Bot' ? 'Bot' : 'User',
            createdAt: item.created_at,
            closedAt: item.closed_at ?? null,
            pullRequestMergedAt: item.pull_request?.merged_at ?? null,
            isPullRequest: Boolean(item.pull_request),
            commentCount: item.comments ?? 0,
        }));

        return {
            items,
            totalCount: response.data.total_count ?? items.length,
            incompleteResults: Boolean(response.data.incomplete_results),
        };
    }

    async getPullRequest(repo: string, number: number): Promise<PullDetail> {
        const { owner, repo: name } = splitRepo(repo);
        const response = await this.spend(() =>
            this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
                owner,
                repo: name,
                pull_number: number,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );
        const data = response.data;
        return {
            nodeId: data.node_id,
            number: data.number,
            title: data.title ?? '',
            body: data.body ?? '',
            htmlUrl: data.html_url,
            repo,
            repoPrivate: Boolean(data.base?.repo?.private),
            labels: labelNames(data.labels),
            authorLogin: data.user?.login ?? '',
            authorType: data.user?.type === 'Bot' ? 'Bot' : 'User',
            branch: data.head?.ref ?? '',
            createdAt: data.created_at,
            mergedAt: data.merged_at ?? null,
            merged: Boolean(data.merged_at),
            additions: data.additions ?? 0,
            deletions: data.deletions ?? 0,
            changedFiles: data.changed_files ?? 0,
            reviewComments: data.review_comments ?? 0,
            comments: data.comments ?? 0,
        };
    }

    async getIssue(repo: string, number: number): Promise<IssueDetail> {
        const { owner, repo: name } = splitRepo(repo);
        const response = await this.spend(() =>
            this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
                owner,
                repo: name,
                issue_number: number,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );
        const data = response.data;
        return {
            nodeId: data.node_id,
            number: data.number,
            title: data.title ?? '',
            body: data.body ?? '',
            htmlUrl: data.html_url,
            repo,
            labels: labelNames(data.labels),
            closedAt: data.closed_at ?? null,
            closedByLogin: data.closed_by?.login ?? '',
        };
    }

    async listReviews(repo: string, number: number): Promise<ReviewSummary[]> {
        const { owner, repo: name } = splitRepo(repo);
        const response = await this.spend(() =>
            this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
                owner,
                repo: name,
                pull_number: number,
                per_page: 100,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );
        return response.data.map((review) => ({
            id: review.id,
            authorLogin: review.user?.login ?? '',
            state: review.state ?? '',
            body: review.body ?? '',
            submittedAt: review.submitted_at ?? null,
        }));
    }

    async listPullFilePaths(repo: string, number: number): Promise<string[]> {
        const { owner, repo: name } = splitRepo(repo);
        const response = await this.spend(() =>
            this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
                owner,
                repo: name,
                pull_number: number,
                per_page: 100,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );
        // `filename` only. `patch` is on the response and is deliberately dropped
        // here rather than downstream — the promise is that code never leaves GitHub.
        return response.data.map((file) => file.filename).filter(Boolean);
    }

    async listReleases(repo: string): Promise<ReleaseSummary[]> {
        const { owner, repo: name } = splitRepo(repo);
        const response = await this.spend(() =>
            this.octokit.request('GET /repos/{owner}/{repo}/releases', {
                owner,
                repo: name,
                per_page: 30,
                headers: { 'X-GitHub-Api-Version': '2022-11-28' },
            }),
        );
        return response.data.map((release) => ({
            nodeId: release.node_id,
            name: release.name ?? release.tag_name ?? '',
            tagName: release.tag_name ?? '',
            body: release.body ?? '',
            htmlUrl: release.html_url,
            authorLogin: release.author?.login ?? '',
            publishedAt: release.published_at ?? null,
            draft: Boolean(release.draft),
            prerelease: Boolean(release.prerelease),
        }));
    }

    async listRepos(): Promise<RepoSummary[]> {
        const out: RepoSummary[] = [];
        for (let page = 1; page <= 5; page += 1) {
            const response = await this.spend(() =>
                this.octokit.request('GET /user/repos', {
                    affiliation: 'owner,collaborator,organization_member',
                    sort: 'pushed',
                    per_page: 100,
                    page,
                    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
                }),
            );
            for (const repo of response.data) {
                out.push({
                    fullName: repo.full_name,
                    private: Boolean(repo.private),
                    fork: Boolean(repo.fork),
                    archived: Boolean(repo.archived),
                    pushedAt: repo.pushed_at ?? null,
                    contributionsLast90d: null,
                });
            }
            if (response.data.length < 100) break;
        }
        return out;
    }
}
