/**
 * GitHub grouping — PRD 02 §4.1.
 *
 * Three rules, all deterministic:
 *   1. A PR and the issue it closes are one candidate (the PR leads; both URLs
 *      survive as evidence).
 *   2. Multiple PRs to the same repo within 5 days that touch the same
 *      top-level directory and share ≥2 title keywords are one candidate.
 *   3. Everything else stands alone. Reviews in particular never merge — the
 *      substance of a review is one person's argument, and blending two of them
 *      produces a Win that quotes nobody.
 */

import { buildGroup, byOccurredAt, sharedKeywordCount, singletonGroup, UnionFind } from '../grouping';
import type { RawSignal, SignalGroup } from '../types';
import { parseGithubMetadata, type GithubSignalMetadata } from './types';

/** §4.1 — "within 5 days". */
export const GROUP_WINDOW_MS = 5 * 86_400_000;

/** §4.1 — "share ≥2 title keywords". */
export const MIN_SHARED_KEYWORDS = 2;

type Enriched = { signal: RawSignal; meta: GithubSignalMetadata };

function sharesTopDir(a: GithubSignalMetadata, b: GithubSignalMetadata): boolean {
    if (a.topDirs.length === 0 || b.topDirs.length === 0) return false;
    const left = new Set(a.topDirs.map((dir) => dir.toLowerCase()));
    return b.topDirs.some((dir) => left.has(dir.toLowerCase()));
}

function sameEffort(a: Enriched, b: Enriched): boolean {
    if (a.meta.repo !== b.meta.repo || !a.meta.repo) return false;
    if (Math.abs(a.signal.occurredAt.getTime() - b.signal.occurredAt.getTime()) > GROUP_WINDOW_MS) return false;
    if (!sharesTopDir(a.meta, b.meta)) return false;
    return sharedKeywordCount(a.signal.title, b.signal.title) >= MIN_SHARED_KEYWORDS;
}

/**
 * How much context a member carries. Used only to pick which PR's description
 * leads the prompt; it never changes membership.
 */
function contextScore(signal: RawSignal): number {
    const meta = parseGithubMetadata(signal.metadata);
    return (
        signal.body.length +
        (meta.linkedIssue ? 400 : 0) +
        meta.reviewCommentsByOthers * 40 +
        meta.labels.length * 10
    );
}

export function groupGithubSignals(signals: readonly RawSignal[]): SignalGroup[] {
    const merged: Enriched[] = [];
    const reviewed: RawSignal[] = [];
    const issues: Enriched[] = [];
    const standalone: RawSignal[] = [];

    for (const signal of signals) {
        const meta = parseGithubMetadata(signal.metadata);
        if (signal.kind === 'pr_merged') merged.push({ signal, meta });
        else if (signal.kind === 'pr_reviewed') reviewed.push(signal);
        else if (signal.kind === 'issue_closed') issues.push({ signal, meta });
        else standalone.push(signal);
    }

    // ── rule 2: cluster merged PRs
    const ordered = merged.sort((a, b) => byOccurredAt(a.signal, b.signal));
    const union = new UnionFind(ordered.length);
    for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
            // Sorted by time, so once we are past the window nothing later can match.
            if (ordered[j].signal.occurredAt.getTime() - ordered[i].signal.occurredAt.getTime() > GROUP_WINDOW_MS) {
                break;
            }
            if (sameEffort(ordered[i], ordered[j])) union.union(i, j);
        }
    }

    const clusters = union.clusters().map((indices) => indices.map((index) => ordered[index]));

    // ── rule 1: absorb closed issues that a clustered PR already links
    const absorbed = new Set<string>();
    const groups: SignalGroup[] = clusters.map((cluster) => {
        const members: RawSignal[] = cluster.map((entry) => entry.signal);
        const linkedNumbers = new Set(
            cluster
                .filter((entry) => entry.meta.linkedIssue)
                .map((entry) => `${entry.meta.repo}#${entry.meta.linkedIssue?.number}`),
        );

        for (const issue of issues) {
            const token = `${issue.meta.repo}#${issue.meta.number}`;
            if (!linkedNumbers.has(token) || absorbed.has(issue.signal.externalId)) continue;
            absorbed.add(issue.signal.externalId);
            members.push(issue.signal);
        }

        // The PR always leads, even when an absorbed issue has a longer body —
        // "prefer the PR's context" is the spec (§4.1).
        return buildGroup(members, (signal) => (signal.kind === 'pr_merged' ? 1e6 + contextScore(signal) : 0));
    });

    for (const issue of issues) {
        if (!absorbed.has(issue.signal.externalId)) groups.push(singletonGroup(issue.signal));
    }
    for (const signal of reviewed) groups.push(singletonGroup(signal));
    for (const signal of standalone) groups.push(singletonGroup(signal));

    return groups.sort((a, b) => byOccurredAt(b.primary, a.primary));
}
