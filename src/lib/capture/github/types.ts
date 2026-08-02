/**
 * GitHub signal metadata — the provider-specific half of `RawSignal.metadata`.
 *
 * This is the shape the fixture corpus, the noise rules, the confidence formula
 * and the drafting prompt all agree on. It is written to `CaptureSignal.metadata`
 * as JSON, so every read goes through `parseGithubMetadata`.
 *
 * Note what is NOT here: file paths beyond the top-level directory, diffs, and
 * any code at all. We never send source code to a model (§3.2), and the cheapest
 * way to keep that promise is to never fetch it.
 */

import type { RawSignal, SignalKind } from '../types';

export type GithubRole = 'author' | 'reviewer';

export type GithubReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

export type LinkedIssue = {
    number: number;
    title: string;
    body: string;
    url: string | null;
};

export type GithubSignalMetadata = {
    /** "owner/name". The grouping key's first component and the settings copy. */
    repo: string;
    repoPrivate: boolean;
    role: GithubRole;
    /** Per-repo and reused after transfers — display only, never an identity. */
    number: number;
    labels: string[];
    filesChanged: number;
    additions: number;
    deletions: number;
    /** Review comments left by people who are not the user. */
    reviewCommentsByOthers: number;
    linkedIssue: LinkedIssue | null;
    authorLogin: string;
    authorType: 'User' | 'Bot';
    /** Head branch, for the `release/*` auto-merge rule (§6.1). */
    branch: string;
    /** ISO. Used for the >60-day "which date?" prompt (§11). */
    openedAt: string | null;
    /** Top-level directories touched. Drives multi-PR grouping (§4.1). */
    topDirs: string[];
    /** `pr_reviewed` only. */
    reviewState: GithubReviewState | null;
    /** `pr_reviewed` only — the user's own review text, which must be quoted (§4.2 r4). */
    reviewBody: string;
    /** True when the PR is a merge commit / revert of the user's own PR (§6.1). */
    isRevert: boolean;
};

export const EMPTY_GITHUB_METADATA: GithubSignalMetadata = {
    repo: '',
    repoPrivate: false,
    role: 'author',
    number: 0,
    labels: [],
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    reviewCommentsByOthers: 0,
    linkedIssue: null,
    authorLogin: '',
    authorType: 'User',
    branch: '',
    openedAt: null,
    topDirs: [],
    reviewState: null,
    reviewBody: '',
    isRevert: false,
};

function str(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseLinkedIssue(value: unknown): LinkedIssue | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const title = str(record.title);
    if (!title) return null;
    return {
        number: num(record.number),
        title,
        body: str(record.body),
        url: typeof record.url === 'string' ? record.url : null,
    };
}

/** Total: malformed stored JSON degrades to defaults rather than throwing mid-sync. */
export function parseGithubMetadata(raw: unknown): GithubSignalMetadata {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const reviewState = str(record.reviewState);
    return {
        repo: str(record.repo),
        repoPrivate: bool(record.repoPrivate),
        role: record.role === 'reviewer' ? 'reviewer' : 'author',
        number: num(record.number),
        labels: strings(record.labels),
        filesChanged: num(record.filesChanged),
        additions: num(record.additions),
        deletions: num(record.deletions),
        reviewCommentsByOthers: num(record.reviewCommentsByOthers),
        linkedIssue: parseLinkedIssue(record.linkedIssue),
        authorLogin: str(record.authorLogin),
        authorType: record.authorType === 'Bot' ? 'Bot' : 'User',
        branch: str(record.branch),
        openedAt: typeof record.openedAt === 'string' ? record.openedAt : null,
        topDirs: strings(record.topDirs),
        reviewState: (['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'] as string[]).includes(reviewState)
            ? (reviewState as GithubReviewState)
            : null,
        reviewBody: str(record.reviewBody),
        isRevert: bool(record.isRevert),
    };
}

/** A `RawSignal` whose metadata has already been narrowed. */
export type GithubSignal = RawSignal & { kind: SignalKind; metadata: GithubSignalMetadata };

export function asGithubSignal(signal: RawSignal): GithubSignal {
    return { ...signal, metadata: parseGithubMetadata(signal.metadata) };
}
