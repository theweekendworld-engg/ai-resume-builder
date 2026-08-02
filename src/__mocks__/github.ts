/**
 * The GitHub mock — the only boundary where the pattern already existed.
 *
 * `GithubApi` in `src/lib/capture/github/client.ts` is a hand-written interface
 * that `OctokitGithubApi` implements. This mock implements the same interface,
 * in full, with no `Pick<>` and no cast: the compiler checks it against the
 * exact contract the adapter consumes. That is the model every other mock in
 * this directory is approximating.
 *
 * It also reproduces the two properties that live at this layer rather than in
 * the adapter — the per-sync request budget and the 403/429 → resumable-partial
 * contract — because a mock with an unlimited budget would let a runaway loop in
 * the adapter pass silently.
 */

import {
    GithubBudgetExhaustedError,
    GithubRateLimitError,
    type GithubApi,
    type IssueDetail,
    type PullDetail,
    type ReleaseSummary,
    type RepoSummary,
    type ReviewSummary,
    type SearchIssueItem,
    type SearchPage,
    type SearchSort,
} from '@/lib/capture/github/client';
import { MAX_REQUESTS_PER_SYNC } from '@/lib/capture/caps';
import type { Recorder } from './recorder';

/** What the mock will answer with. Everything is opt-in; absent means empty. */
export type GithubCorpus = {
    /** Answered for a query containing `is:merged`. */
    merged?: SearchIssueItem[];
    /** Answered for a query containing `reviewed-by`. */
    reviewed?: SearchIssueItem[];
    /** Everything else — issues, and any query the two above do not claim. */
    issues?: SearchIssueItem[];
    /** Keyed `owner/name#number`. */
    pulls?: Record<string, PullDetail>;
    issueDetails?: Record<string, IssueDetail>;
    reviews?: Record<string, ReviewSummary[]>;
    files?: Record<string, string[]>;
    releases?: Record<string, ReleaseSummary[]>;
    repos?: RepoSummary[];
};

export type GithubMockOptions = {
    /** Requests before `GithubBudgetExhaustedError`. Defaults to the real cap. */
    maxRequests?: number;
    /** After this many requests, every call raises 403 — the resumable-partial path. */
    rateLimitAfter?: number;
    /** Status used when `rateLimitAfter` trips. 403 and 429 are both real. */
    rateLimitStatus?: 403 | 429;
    retryAfterMs?: number | null;
    /** Search results per page. Drives the adapter's pagination loop. */
    pageSize?: number;
};

export class MockGithubApi implements GithubApi {
    private spent = 0;
    private corpus: GithubCorpus;
    private options: Required<Omit<GithubMockOptions, 'rateLimitAfter' | 'retryAfterMs'>> & {
        rateLimitAfter: number | null;
        retryAfterMs: number | null;
    };

    constructor(
        private readonly recorder: Recorder,
        corpus: GithubCorpus = {},
        options: GithubMockOptions = {},
    ) {
        this.corpus = corpus;
        this.options = {
            maxRequests: options.maxRequests ?? MAX_REQUESTS_PER_SYNC,
            rateLimitAfter: options.rateLimitAfter ?? null,
            rateLimitStatus: options.rateLimitStatus ?? 403,
            retryAfterMs: options.retryAfterMs ?? null,
            pageSize: options.pageSize ?? 100,
        };
    }

    // ── arrange

    load(corpus: GithubCorpus): this {
        this.corpus = corpus;
        return this;
    }

    configure(options: GithubMockOptions): this {
        this.options = {
            maxRequests: options.maxRequests ?? this.options.maxRequests,
            rateLimitAfter: options.rateLimitAfter ?? this.options.rateLimitAfter,
            rateLimitStatus: options.rateLimitStatus ?? this.options.rateLimitStatus,
            retryAfterMs: options.retryAfterMs ?? this.options.retryAfterMs,
            pageSize: options.pageSize ?? this.options.pageSize,
        };
        return this;
    }

    reset(): void {
        this.spent = 0;
        this.corpus = {};
        this.options = {
            maxRequests: MAX_REQUESTS_PER_SYNC,
            rateLimitAfter: null,
            rateLimitStatus: 403,
            retryAfterMs: null,
            pageSize: 100,
        };
        this.recorder.github.length = 0;
    }

    /** Ordered call log, e.g. `['searchIssues:is:merged', 'getPullRequest:acme/api#12']`. */
    get calls(): string[] {
        return this.recorder.github.map((call) => `${call.method}:${call.detail}`);
    }

    // ── budget + rate limit, exactly as the real client enforces them

    private spend(method: string, detail: string): void {
        if (this.spent >= this.options.maxRequests) {
            throw new GithubBudgetExhaustedError(this.options.maxRequests);
        }
        this.spent += 1;
        this.recorder.github.push({ method, detail });
        if (this.options.rateLimitAfter !== null && this.spent > this.options.rateLimitAfter) {
            throw new GithubRateLimitError(this.options.rateLimitStatus, this.options.retryAfterMs);
        }
    }

    // ── GithubApi

    async searchIssues(
        query: string,
        page: number,
        perPage: number,
        sort: SearchSort = { sort: 'updated', order: 'asc' },
    ): Promise<SearchPage> {
        this.spend('searchIssues', `${query.slice(0, 40)}|p${page}`);
        void sort;

        const pool = query.includes('is:merged')
            ? (this.corpus.merged ?? [])
            : query.includes('reviewed-by')
              ? (this.corpus.reviewed ?? [])
              : (this.corpus.issues ?? []);

        const size = Math.min(perPage || this.options.pageSize, this.options.pageSize);
        const start = Math.max(0, (page - 1) * size);
        const items = pool.slice(start, start + size);

        return { items, totalCount: pool.length, incompleteResults: false };
    }

    async getPullRequest(repo: string, number: number): Promise<PullDetail> {
        const key = `${repo}#${number}`;
        this.spend('getPullRequest', key);
        const detail = this.corpus.pulls?.[key];
        if (!detail) throw new Error(`mock github: no pull scripted for ${key}`);
        return detail;
    }

    async getIssue(repo: string, number: number): Promise<IssueDetail> {
        const key = `${repo}#${number}`;
        this.spend('getIssue', key);
        const detail = this.corpus.issueDetails?.[key];
        if (!detail) throw new Error(`mock github: no issue scripted for ${key}`);
        return detail;
    }

    async listReviews(repo: string, number: number): Promise<ReviewSummary[]> {
        const key = `${repo}#${number}`;
        this.spend('listReviews', key);
        return this.corpus.reviews?.[key] ?? [];
    }

    async listPullFilePaths(repo: string, number: number): Promise<string[]> {
        const key = `${repo}#${number}`;
        this.spend('listPullFilePaths', key);
        return this.corpus.files?.[key] ?? [];
    }

    async listReleases(repo: string): Promise<ReleaseSummary[]> {
        this.spend('listReleases', repo);
        return this.corpus.releases?.[repo] ?? [];
    }

    async listRepos(): Promise<RepoSummary[]> {
        this.spend('listRepos', '');
        return this.corpus.repos ?? [];
    }

    requestsUsed(): number {
        return this.spent;
    }
}
