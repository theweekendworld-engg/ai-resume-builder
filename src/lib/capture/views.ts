/**
 * View models for the sources surfaces — design/02 §A2, §A2b, §J1.
 *
 * Separate from `src/actions/capture.ts` because a `'use server'` module may
 * only export async functions, and separate from the components because the
 * copy in §J1 is specified down to the string ("42 repos · public + private")
 * and deserves a unit test rather than a JSX expression.
 */

import type { CaptureRunStatus, CaptureSourceKind, CaptureSourceStatus, Tier } from '@prisma/client';
import { sourceLimit } from '@/lib/plans';

/*
 * Type-only imports on purpose. This module is reached from the repo picker,
 * which is a client component, and importing enum *values* from
 * `@prisma/client` drags the server runtime into the browser bundle — the same
 * reason `src/components/patterns/types.ts` mirrors the enums as string unions.
 * The members below are compared as literals, which is structurally identical.
 */

// ───────────────────────────────────────────────────── entitlements (§9)

/**
 * Connected-source allowance — PRD 02 §9 / PRD 06 §2.1.
 *
 * A thin alias over `plans.sourceLimit`, kept only so capture code reads in its
 * own vocabulary. The number itself lives in `PLAN_CATALOG` with every other
 * plan limit; two places that both know how many sources a tier gets is one
 * place too many.
 */
export function maxSourcesForTier(tier: Tier): number {
    return sourceLimit(tier);
}

// ───────────────────────────────────────────────────── status

export type SourceStatusPill = {
    status: CaptureSourceStatus;
    /** Never colour alone — the word is the status (§J1). */
    label: 'Active' | 'Paused' | 'Needs attention' | 'Revoked';
    tone: 'positive' | 'neutral' | 'warning' | 'critical';
};

export function statusPill(status: CaptureSourceStatus): SourceStatusPill {
    switch (status) {
        case 'active':
            return { status, label: 'Active', tone: 'positive' };
        case 'paused':
            return { status, label: 'Paused', tone: 'neutral' };
        case 'error':
            return { status, label: 'Needs attention', tone: 'warning' };
        case 'revoked':
            return { status, label: 'Revoked', tone: 'critical' };
    }
}

// ───────────────────────────────────────────────────── access summary

/**
 * §J1's headline: "12 repos · public + private". This single line is the answer
 * to "what can this thing see?", which the settings page must answer without
 * navigation.
 */
export function describeAccess(input: { repoCount: number; canSeePrivate: boolean }): string {
    const repos = `${input.repoCount} repo${input.repoCount === 1 ? '' : 's'}`;
    return `${repos} · ${input.canSeePrivate ? 'public + private' : 'public only'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDateTime(date: Date, timeZone?: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    const month = get('month') || MONTHS[date.getUTCMonth()];
    return `${month} ${get('day')}, ${get('hour')}:${get('minute')}`;
}

export type LastRunFacts = {
    finishedAt: Date | null;
    startedAt: Date;
    status: CaptureRunStatus;
    itemsScanned: number;
    winsDrafted: number;
};

/** §J1: "Last sync  Jul 31, 16:02 — 38 scanned, 3 drafted". */
export function describeLastRun(run: LastRunFacts | null, timeZone?: string): string {
    if (!run) return 'Not synced yet';
    const when = shortDateTime(run.finishedAt ?? run.startedAt, timeZone);
    if (run.status === 'running') return `${when} — running`;
    if (run.status === 'failed') return `${when} — sync failed`;
    const suffix = run.status === 'degraded' ? ' (partial)' : '';
    return `${when} — ${run.itemsScanned} scanned, ${run.winsDrafted} drafted${suffix}`;
}

/** §J1: "Has drafted 61 of your 74 wins". Silent when it has drafted none. */
export function describeContribution(input: { fromSource: number; total: number }): string | null {
    if (input.fromSource <= 0 || input.total <= 0) return null;
    return `Has drafted ${input.fromSource} of your ${input.total} wins`;
}

// ───────────────────────────────────────────────────── the views

export type SourceView = {
    id: string;
    kind: CaptureSourceKind;
    displayName: string;
    accountLabel: string;
    pill: SourceStatusPill;
    access: string;
    repoCount: number;
    canSeePrivate: boolean;
    lastRun: string;
    contribution: string | null;
    /** Wins this source has drafted — the number the disconnect dialog names. */
    winsFromSource: number;
    /** Manual sync is a paid affordance (§9) and rate-limited to 1/hour (§3.3). */
    canSyncNow: boolean;
    syncCooldownUntil: Date | null;
    lastError: string | null;
};

export type AvailableSourceView = {
    kind: CaptureSourceKind;
    displayName: string;
    /** One line saying what this source captures that the others cannot. */
    pitch: string;
    /** Null when available on every tier. */
    requiresTierLabel: string | null;
    available: boolean;
};

export type SourcesOverview = {
    connected: SourceView[];
    available: AvailableSourceView[];
    /** How many more sources this plan allows. Zero renders the upgrade line. */
    remainingSlots: number;
    maxSources: number;
};

/** §J1's not-connected cards. Copy is final. */
export const AVAILABLE_SOURCE_COPY: Record<string, { displayName: string; pitch: string }> = {
    github: {
        displayName: 'GitHub',
        pitch: 'Merged pull requests and the reviews you actually wrote.',
    },
    calendar: {
        displayName: 'Google Calendar',
        pitch: "Captures the meetings and reviews GitHub can't see.",
    },
    linear: {
        displayName: 'Linear',
        pitch: 'Issues you finished, with the business framing already attached.',
    },
    jira: {
        displayName: 'Jira',
        pitch: 'Issues you finished, with the business framing already attached.',
    },
};

// ───────────────────────────────────────────────────── repo picker

export type RepoOption = {
    fullName: string;
    private: boolean;
    /** Null when GitHub did not report a push date. */
    lastPushedAt: Date | null;
    /** Null when we could not count. Rendered as "84 commits, last week". */
    contributions: number | null;
    selected: boolean;
    archived: boolean;
    fork: boolean;
};

/**
 * §A2b — "Pre-selected: repos you've contributed to in the last 90 days",
 * ordered by recent contribution.
 *
 * Archived repos and forks sort last but are not removed: someone's most
 * significant work is occasionally in a repo that has since been archived, and
 * silently hiding it makes the picker a liar about what we can see.
 */
export function buildRepoOptions(
    repos: ReadonlyArray<{
        fullName: string;
        private: boolean;
        pushedAt: string | null;
        archived: boolean;
        fork: boolean;
        contributionsLast90d: number | null;
    }>,
    alreadySelected: readonly string[],
    now: Date = new Date(),
): RepoOption[] {
    const selectedSet = new Set(alreadySelected.map((name) => name.toLowerCase()));
    const hasExistingSelection = selectedSet.size > 0;
    const cutoff = now.getTime() - 90 * 86_400_000;

    return repos
        .map((repo) => {
            const pushed = repo.pushedAt ? new Date(repo.pushedAt) : null;
            const recent = pushed !== null && !Number.isNaN(pushed.getTime()) && pushed.getTime() >= cutoff;
            return {
                fullName: repo.fullName,
                private: repo.private,
                lastPushedAt: pushed && !Number.isNaN(pushed.getTime()) ? pushed : null,
                contributions: repo.contributionsLast90d,
                // An existing selection is the user's answer; never override it.
                selected: hasExistingSelection
                    ? selectedSet.has(repo.fullName.toLowerCase())
                    : recent && !repo.archived,
                archived: repo.archived,
                fork: repo.fork,
            };
        })
        .sort((a, b) => {
            const rank = (option: RepoOption): number => (option.archived ? 2 : option.fork ? 1 : 0);
            const byRank = rank(a) - rank(b);
            if (byRank !== 0) return byRank;
            const byPush = (b.lastPushedAt?.getTime() ?? 0) - (a.lastPushedAt?.getTime() ?? 0);
            if (byPush !== 0) return byPush;
            return a.fullName.localeCompare(b.fullName);
        });
}

/**
 * Search filter for the picker.
 *
 * A plain `includes` on a lowercased name, and nothing cleverer: at 500 repos
 * this is the difference between an instant list and a fuzzy-match library that
 * blows the <300ms interaction budget (§12) for a ranking nobody asked for.
 */
export function filterRepoOptions(options: readonly RepoOption[], query: string): RepoOption[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return options as RepoOption[];
    return options.filter((option) => option.fullName.toLowerCase().includes(needle));
}

export function selectedCount(options: readonly RepoOption[]): number {
    return options.reduce((count, option) => count + (option.selected ? 1 : 0), 0);
}

/** §A2b — "12 of 47 selected". */
export function describeSelection(options: readonly RepoOption[]): string {
    return `${selectedCount(options)} of ${options.length} selected`;
}
