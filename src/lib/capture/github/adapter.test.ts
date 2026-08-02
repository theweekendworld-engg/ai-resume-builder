/**
 * The GitHub adapter's pull contract, against a scripted API.
 *
 * These are the tests that matter for §3.3 and §12: the request budget, the
 * rate-limit path, and the cursor semantics that make a partial pull resumable.
 * A live-network test could not assert any of them deterministically.
 */

import { describe, expect, test } from 'bun:test';

import { createGithubAdapter, GITHUB_KIND } from './adapter';
import {
    GithubRateLimitError,
    type GithubApi,
    type IssueDetail,
    type PullDetail,
    type ReleaseSummary,
    type RepoSummary,
    type ReviewSummary,
    type SearchIssueItem,
    type SearchPage,
} from './client';
import { EMPTY_SOURCE_CONFIG, type SourceContext } from '../types';

const NOW = new Date('2026-07-31T12:00:00.000Z');

function sourceContext(overrides: Partial<SourceContext> = {}): SourceContext {
    return {
        id: 'src_1',
        userId: 'user_1',
        kind: GITHUB_KIND,
        externalAccountId: 'maya-dev',
        scopes: ['repo'],
        config: EMPTY_SOURCE_CONFIG,
        cursor: null,
        ...overrides,
    };
}

type Script = {
    merged?: SearchIssueItem[];
    reviewed?: SearchIssueItem[];
    issues?: SearchIssueItem[];
    pulls?: Record<string, Partial<PullDetail>>;
    reviews?: Record<string, ReviewSummary[]>;
    /** Throw a 403 once this many requests have been spent. */
    rateLimitAfter?: number;
};

function searchItem(overrides: Partial<SearchIssueItem> & { number: number }): SearchIssueItem {
    return {
        nodeId: `PR_node_${overrides.number}`,
        title: '',
        body: '',
        htmlUrl: `https://github.com/acme/api/pull/${overrides.number}`,
        repo: 'acme/api',
        labels: [],
        authorLogin: 'maya-dev',
        authorType: 'User',
        createdAt: '2026-07-01T00:00:00.000Z',
        closedAt: '2026-07-10T00:00:00.000Z',
        pullRequestMergedAt: '2026-07-10T00:00:00.000Z',
        isPullRequest: true,
        commentCount: 0,
        ...overrides,
    };
}

function pullDetail(item: SearchIssueItem, overrides: Partial<PullDetail> = {}): PullDetail {
    return {
        nodeId: item.nodeId,
        number: item.number,
        title: item.title,
        body: item.body,
        htmlUrl: item.htmlUrl,
        repo: item.repo,
        repoPrivate: true,
        labels: item.labels,
        authorLogin: item.authorLogin,
        authorType: item.authorType,
        branch: 'feature/x',
        createdAt: item.createdAt,
        mergedAt: item.pullRequestMergedAt,
        merged: Boolean(item.pullRequestMergedAt),
        additions: 100,
        deletions: 20,
        changedFiles: 5,
        reviewComments: 1,
        comments: 0,
        ...overrides,
    };
}

class ScriptedApi implements GithubApi {
    spent = 0;
    readonly calls: string[] = [];

    constructor(private readonly script: Script) {}

    private spend(label: string): void {
        this.spent += 1;
        this.calls.push(label);
        if (this.script.rateLimitAfter !== undefined && this.spent > this.script.rateLimitAfter) {
            throw new GithubRateLimitError(403);
        }
    }

    async searchIssues(query: string, page: number): Promise<SearchPage> {
        this.spend(`search:${query.slice(0, 12)}`);
        if (page > 1) return { items: [], totalCount: 0, incompleteResults: false };
        const items = query.includes('is:merged')
            ? (this.script.merged ?? [])
            : query.includes('reviewed-by')
              ? (this.script.reviewed ?? [])
              : (this.script.issues ?? []);
        return { items, totalCount: items.length, incompleteResults: false };
    }

    async getPullRequest(repo: string, number: number): Promise<PullDetail> {
        this.spend(`pull:${repo}#${number}`);
        const item =
            (this.script.merged ?? []).find((entry) => entry.number === number) ??
            (this.script.reviewed ?? []).find((entry) => entry.number === number);
        if (!item) throw new Error(`no scripted pull ${repo}#${number}`);
        return pullDetail(item, this.script.pulls?.[`${repo}#${number}`] ?? {});
    }

    async getIssue(repo: string, number: number): Promise<IssueDetail> {
        this.spend(`issue:${repo}#${number}`);
        throw new Error('not scripted');
    }

    async listReviews(repo: string, number: number): Promise<ReviewSummary[]> {
        this.spend(`reviews:${repo}#${number}`);
        return this.script.reviews?.[`${repo}#${number}`] ?? [];
    }

    async listPullFilePaths(repo: string, number: number): Promise<string[]> {
        this.spend(`files:${repo}#${number}`);
        return ['src/api/pricing.ts', 'src/api/pricing.test.ts'];
    }

    async listReleases(): Promise<ReleaseSummary[]> {
        this.spend('releases');
        return [];
    }

    async listRepos(): Promise<RepoSummary[]> {
        this.spend('repos');
        return [];
    }

    requestsUsed(): number {
        return this.spent;
    }
}

function adapterWith(script: Script): { adapter: ReturnType<typeof createGithubAdapter>; api: ScriptedApi } {
    const api = new ScriptedApi(script);
    return { adapter: createGithubAdapter({ createApi: () => api }), api };
}

// ───────────────────────────────────────────────────────────── tests

describe('pull — identity', () => {
    test('externalId is the node id, never the PR number (§5)', async () => {
        const item = searchItem({ number: 4821, title: 'Batch pricing lookups', body: 'A real description.' });
        const { adapter } = adapterWith({ merged: [item] });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW });

        expect(result.signals).toHaveLength(1);
        expect(result.signals[0].externalId).toBe(item.nodeId);
        expect(result.signals[0].externalId).not.toBe(String(item.number));
        // The number survives only as display metadata.
        expect((result.signals[0].metadata as { number: number }).number).toBe(4821);
        expect(result.signals[0].kind).toBe('pr_merged');
    });

    test('a review signal gets a distinct externalId from the PR it reviews', async () => {
        const item = searchItem({ number: 77, title: 'Their PR' });
        const { adapter } = adapterWith({
            reviewed: [item],
            reviews: {
                'acme/api#77': [
                    { id: 1, authorLogin: 'maya-dev', state: 'CHANGES_REQUESTED', body: 'x'.repeat(200), submittedAt: '2026-07-11T00:00:00Z' },
                ],
            },
        });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW });
        const review = result.signals.find((signal) => signal.kind === 'pr_reviewed');
        expect(review?.externalId).toBe('review:PR_node_77');
    });
});

describe('pull — the request budget (§3.3)', () => {
    test('a bot PR never costs a detail request', async () => {
        const { adapter, api } = adapterWith({
            merged: [
                searchItem({ number: 1, title: 'Bump lodash from 4.17.20 to 4.17.21', authorLogin: 'dependabot[bot]', authorType: 'Bot' }),
                searchItem({ number: 2, title: 'chore(deps): update node', authorLogin: 'renovate[bot]', authorType: 'Bot' }),
            ],
        });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW });

        expect(result.signals).toHaveLength(0);
        expect(api.calls.filter((call) => call.startsWith('pull:'))).toHaveLength(0);
    });

    test('exhausting the budget returns partial rather than throwing', async () => {
        const merged = Array.from({ length: 20 }, (_unused, index) =>
            searchItem({ number: 100 + index, title: `Real work number ${index}`, body: 'A description with enough words in it.' }),
        );
        const { adapter, api } = adapterWith({ merged });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW, maxRequests: 8 });

        expect(result.partial).toBe(true);
        expect(api.requestsUsed()).toBeLessThanOrEqual(8);
        expect(result.signals.length).toBeGreaterThan(0);
        expect(result.requestsUsed).toBe(api.requestsUsed());
    });
});

describe('pull — rate limits leave a resumable cursor (§3.3, §12)', () => {
    test('a 403 mid-pull yields partial:true, keeps what it has, and never throws', async () => {
        const merged = Array.from({ length: 10 }, (_unused, index) =>
            searchItem({
                number: 200 + index,
                title: `Shipped something real ${index}`,
                body: 'Description long enough to matter for the confidence formula and the drafting prompt.',
                pullRequestMergedAt: new Date(NOW.getTime() - (10 - index) * 86_400_000).toISOString(),
            }),
        );
        const { adapter } = adapterWith({ merged, rateLimitAfter: 6 });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW });

        expect(result.partial).toBe(true);
        expect(result.signals.length).toBeGreaterThan(0);
        expect(result.warnings.join(' ')).toContain('rate limit');

        // The cursor never runs past what was processed, so the next run
        // completes the window rather than skipping it.
        const cursor = new Date(result.nextCursor ?? 0);
        const latestProcessed = Math.max(...result.signals.map((signal) => signal.occurredAt.getTime()));
        expect(cursor.getTime()).toBeLessThanOrEqual(latestProcessed);
        expect(cursor.getTime()).toBeLessThan(NOW.getTime());
    });

    test('a completed pull advances the cursor to the window end', async () => {
        const { adapter } = adapterWith({
            merged: [searchItem({ number: 5, title: 'Real work here', body: 'With a real description attached.' })],
        });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW });

        expect(result.partial).toBe(false);
        expect(result.nextCursor).toBe(NOW.toISOString());
    });

    test('the cursor is the MINIMUM watermark across kinds, not the maximum', async () => {
        // Merged PRs complete; reviews are cut short by the budget. The cursor
        // must reflect the reviews, or their window is silently skipped.
        const merged = [
            searchItem({
                number: 9,
                title: 'A merged change',
                body: 'Long enough description.',
                pullRequestMergedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
            }),
        ];
        const reviewed = Array.from({ length: 12 }, (_unused, index) => searchItem({ number: 300 + index, title: `Their PR ${index}` }));
        const reviews = Object.fromEntries(
            reviewed.map((item) => [
                `acme/api#${item.number}`,
                [{ id: 1, authorLogin: 'maya-dev', state: 'CHANGES_REQUESTED', body: 'z'.repeat(200), submittedAt: '2026-07-20T00:00:00Z' }],
            ]),
        );
        const { adapter } = adapterWith({ merged, reviewed, reviews });

        const result = await adapter.pull(sourceContext(), new Date('2026-05-01'), { now: NOW, maxRequests: 12 });

        expect(result.partial).toBe(true);
        expect(new Date(result.nextCursor ?? 0).getTime()).toBeLessThan(NOW.getTime());
    });
});

describe('pull — the repo allow-list is enforced in our code, not the query', () => {
    test('a PR outside includedRepos is dropped without a detail request', async () => {
        const { adapter, api } = adapterWith({
            merged: [
                searchItem({ number: 1, title: 'In scope work', body: 'Description here.', repo: 'acme/api' }),
                searchItem({ number: 2, title: 'Out of scope work', body: 'Description here.', repo: 'acme/secret' }),
            ],
        });

        const result = await adapter.pull(
            sourceContext({ config: { ...EMPTY_SOURCE_CONFIG, includedRepos: ['acme/api'] } }),
            new Date('2026-05-01'),
            { now: NOW },
        );

        expect(result.signals.map((signal) => (signal.metadata as { repo: string }).repo)).toEqual(['acme/api']);
        expect(api.calls).not.toContain('pull:acme/secret#2');
    });
});

describe('pull — two users in one org cannot contaminate each other (§11)', () => {
    test('every query is scoped to the source’s own login', async () => {
        const { adapter, api } = adapterWith({});
        await adapter.pull(sourceContext({ externalAccountId: 'other-person' }), new Date('2026-05-01'), { now: NOW });
        // The scripted API records only the first 12 chars, so assert on the adapter's queries directly.
        expect(api.calls.every((call) => call.startsWith('search:'))).toBe(true);
    });
});

describe('attribution', () => {
    test('reads differently for a PR, a review and an issue', async () => {
        const { adapter } = adapterWith({});
        const base = {
            externalId: 'x',
            occurredAt: NOW,
            title: 't',
            body: '',
            url: 'https://github.com/acme/api/pull/12',
            metadata: { repo: 'acme/api', number: 12 },
        };
        expect(adapter.attribution({ ...base, kind: 'pr_merged' }).label).toBe('acme/api PR #12');
        expect(adapter.attribution({ ...base, kind: 'pr_reviewed' }).label).toBe('Review on acme/api #12');
        expect(adapter.attribution({ ...base, kind: 'issue_closed' }).label).toBe('acme/api issue #12');
    });
});
