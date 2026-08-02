/**
 * The labelled GitHub corpus — builders and label vocabulary.
 *
 * PRD 02 §12 makes three claims that are only meaningful against a real corpus:
 *   - bot PRs never produce a draft (binary),
 *   - no drafted Win contains a number absent from the PR title, body or linked
 *     issue (binary, and a launch gate),
 *   - draft accept rate ≥60% on a 100-PR labelled set.
 *
 * So the corpus is not test scaffolding, it is the specification of what "good"
 * means for this feature. Every case carries a human judgement (`verdict`,
 * `acceptable`) written independently of the implementation, which is what
 * makes the numbers it produces worth anything.
 */

import type { RawSignal } from '@/lib/capture/types';
import { EMPTY_GITHUB_METADATA, type GithubSignalMetadata } from '@/lib/capture/github/types';

/** Fixed clock so `daysAgo` and every derived expectation are deterministic. */
export const CORPUS_NOW = new Date('2026-07-31T12:00:00.000Z');

export type CorpusVerdict =
    /** Should reach the model and produce a Win draft. */
    | 'draft'
    /** Should be filtered by a noise rule before any cost is incurred. */
    | 'noise'
    /** Reaches the model, which should decline it (too thin to be a Win). */
    | 'decline';

export type CorpusLabel = {
    verdict: CorpusVerdict;
    /** True for anything a bot authored. Zero of these may draft — binary gate. */
    bot: boolean;
    /**
     * Would the person who did this work confirm the draft in their digest?
     * The accept-rate numerator. Judged on the artefact, not on our output:
     * a real accomplishment with a thin description is still acceptable.
     */
    acceptable: boolean;
    /** Expected `noiseRule`, when `verdict` is 'noise'. */
    rule?: string;
    /** Why this case exists. Read this before changing a label. */
    note?: string;
};

export type CorpusCase = {
    id: string;
    signal: RawSignal;
    label: CorpusLabel;
    /** Cases sharing a non-null key are one effort and must group (§4.1). */
    groupWith?: string;
};

// ───────────────────────────────────────────────────── builders

function at(daysAgo: number): Date {
    return new Date(CORPUS_NOW.getTime() - daysAgo * 86_400_000);
}

export type PrSpec = {
    id: string;
    title: string;
    body?: string;
    repo?: string;
    private?: boolean;
    labels?: string[];
    files?: number;
    adds?: number;
    dels?: number;
    /** Review comments left by other people. */
    comments?: number;
    issue?: { number: number; title: string; body?: string };
    author?: string;
    authorType?: 'User' | 'Bot';
    branch?: string;
    dirs?: string[];
    daysAgo?: number;
    number?: number;
    label: CorpusLabel;
    groupWith?: string;
};

/** The default protagonist. Everything not explicitly bot-authored is theirs. */
export const CORPUS_LOGIN = 'maya-dev';

let nodeCounter = 0;
function nodeId(prefix: string): string {
    nodeCounter += 1;
    // Shaped like a real GraphQL node id so nothing accidentally parses it as a number.
    return `${prefix}_kwDOABCDEF${String(nodeCounter).padStart(6, '0')}`;
}

export function pr(spec: PrSpec): CorpusCase {
    const metadata: GithubSignalMetadata = {
        ...EMPTY_GITHUB_METADATA,
        repo: spec.repo ?? 'acme/api',
        repoPrivate: spec.private ?? true,
        role: 'author',
        number: spec.number ?? 1000 + nodeCounter,
        labels: spec.labels ?? [],
        filesChanged: spec.files ?? 3,
        additions: spec.adds ?? 60,
        deletions: spec.dels ?? 20,
        reviewCommentsByOthers: spec.comments ?? 0,
        linkedIssue: spec.issue
            ? { number: spec.issue.number, title: spec.issue.title, body: spec.issue.body ?? '', url: null }
            : null,
        authorLogin: spec.author ?? CORPUS_LOGIN,
        authorType: spec.authorType ?? 'User',
        branch: spec.branch ?? 'feature/work',
        openedAt: at((spec.daysAgo ?? 10) + 3).toISOString(),
        topDirs: spec.dirs ?? ['src/api'],
        reviewState: null,
        reviewBody: '',
        isRevert: /^\s*revert\s/i.test(spec.title),
    };

    return {
        id: spec.id,
        groupWith: spec.groupWith,
        label: spec.label,
        signal: {
            externalId: nodeId('PR'),
            kind: 'pr_merged',
            occurredAt: at(spec.daysAgo ?? 10),
            title: spec.title,
            body: spec.body ?? '',
            url: `https://github.com/${metadata.repo}/pull/${metadata.number}`,
            metadata: metadata as unknown as Record<string, unknown>,
        },
    };
}

export type ReviewSpec = {
    id: string;
    /** The PR being reviewed — authored by someone else. */
    title: string;
    body?: string;
    reviewBody: string;
    state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    repo?: string;
    private?: boolean;
    author?: string;
    labels?: string[];
    comments?: number;
    daysAgo?: number;
    dirs?: string[];
    label: CorpusLabel;
};

export function review(spec: ReviewSpec): CorpusCase {
    const metadata: GithubSignalMetadata = {
        ...EMPTY_GITHUB_METADATA,
        repo: spec.repo ?? 'acme/api',
        repoPrivate: spec.private ?? true,
        role: 'reviewer',
        number: 2000 + nodeCounter,
        labels: spec.labels ?? [],
        filesChanged: 8,
        additions: 120,
        deletions: 40,
        reviewCommentsByOthers: spec.comments ?? 1,
        linkedIssue: null,
        authorLogin: spec.author ?? 'other-dev',
        authorType: 'User',
        branch: 'feature/theirs',
        openedAt: at((spec.daysAgo ?? 8) + 2).toISOString(),
        topDirs: spec.dirs ?? ['src/api'],
        reviewState: spec.state ?? 'COMMENTED',
        reviewBody: spec.reviewBody,
        isRevert: false,
    };

    return {
        id: spec.id,
        label: spec.label,
        signal: {
            externalId: nodeId('review:PR'),
            kind: 'pr_reviewed',
            occurredAt: at(spec.daysAgo ?? 8),
            title: spec.title,
            body: spec.body ?? '',
            url: `https://github.com/${metadata.repo}/pull/${metadata.number}`,
            metadata: metadata as unknown as Record<string, unknown>,
        },
    };
}

export type IssueSpec = {
    id: string;
    title: string;
    body?: string;
    repo?: string;
    labels?: string[];
    daysAgo?: number;
    number?: number;
    label: CorpusLabel;
};

export function issue(spec: IssueSpec): CorpusCase {
    const metadata: GithubSignalMetadata = {
        ...EMPTY_GITHUB_METADATA,
        repo: spec.repo ?? 'acme/api',
        repoPrivate: true,
        role: 'author',
        number: spec.number ?? 3000 + nodeCounter,
        labels: spec.labels ?? [],
        authorLogin: CORPUS_LOGIN,
        topDirs: [],
    };

    return {
        id: spec.id,
        label: spec.label,
        signal: {
            externalId: nodeId('I'),
            kind: 'issue_closed',
            occurredAt: at(spec.daysAgo ?? 12),
            title: spec.title,
            body: spec.body ?? '',
            url: `https://github.com/${metadata.repo}/issues/${metadata.number}`,
            metadata: metadata as unknown as Record<string, unknown>,
        },
    };
}
