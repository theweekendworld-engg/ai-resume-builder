/**
 * Adapter registry.
 *
 * The whole point of the framework: adding Google Calendar in R2 is one adapter
 * file plus one line here. If it ever needs more than that, the abstraction in
 * `types.ts` is wrong and should be fixed rather than worked around.
 */

import type { CaptureSourceKind } from '@prisma/client';
import { createGithubAdapter, GITHUB_KIND } from './github/adapter';
import { getGithubIdentity } from './github/auth';
import { OctokitGithubApi } from './github/client';
import type { CaptureAdapter } from './types';

/**
 * The default GitHub adapter: a fresh, budgeted Octokit per sync.
 *
 * Token resolution is async and the adapter's `createApi` is not, so the token
 * is fetched lazily on first request. That keeps `pull` free of an await it
 * does not need and means a public-only source never asks Clerk for a token.
 */
export const githubAdapter: CaptureAdapter = createGithubAdapter({
    createApi: (source, maxRequests) => {
        let delegate: OctokitGithubApi | null = null;
        let pending: Promise<OctokitGithubApi> | null = null;

        const resolve = async (): Promise<OctokitGithubApi> => {
            if (delegate) return delegate;
            if (!pending) {
                pending = getGithubIdentity(source.userId).then((identity) => {
                    delegate = new OctokitGithubApi({ token: identity.token ?? undefined, maxRequests });
                    return delegate;
                });
            }
            return pending;
        };

        return {
            async searchIssues(query, page, perPage, sort) {
                return (await resolve()).searchIssues(query, page, perPage, sort);
            },
            async getPullRequest(repo, number) {
                return (await resolve()).getPullRequest(repo, number);
            },
            async getIssue(repo, number) {
                return (await resolve()).getIssue(repo, number);
            },
            async listReviews(repo, number) {
                return (await resolve()).listReviews(repo, number);
            },
            async listPullFilePaths(repo, number) {
                return (await resolve()).listPullFilePaths(repo, number);
            },
            async listReleases(repo) {
                return (await resolve()).listReleases(repo);
            },
            async listRepos() {
                return (await resolve()).listRepos();
            },
            requestsUsed() {
                return delegate?.requestsUsed() ?? 0;
            },
        };
    },
});

const ADAPTERS = new Map<CaptureSourceKind, CaptureAdapter>([[GITHUB_KIND, githubAdapter]]);

export function getAdapter(kind: CaptureSourceKind): CaptureAdapter | undefined {
    return ADAPTERS.get(kind);
}

export function requireAdapter(kind: CaptureSourceKind): CaptureAdapter {
    const adapter = ADAPTERS.get(kind);
    if (!adapter) throw new Error(`no capture adapter registered for kind "${kind}"`);
    return adapter;
}

export function registeredAdapterKinds(): CaptureSourceKind[] {
    return [...ADAPTERS.keys()];
}

/** Test-only seam: swap an adapter for a fixture-backed one. */
export const __testing = {
    set(kind: CaptureSourceKind, adapter: CaptureAdapter): void {
        ADAPTERS.set(kind, adapter);
    },
    reset(): void {
        ADAPTERS.clear();
        ADAPTERS.set(GITHUB_KIND, githubAdapter);
    },
};
