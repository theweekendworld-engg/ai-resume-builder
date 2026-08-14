/**
 * Noise filtering, adapter-neutral half — PRD 02 §6.
 *
 * Four layers, cheapest first. This file owns layer 2 (user config) and the
 * shared rule vocabulary; layers 1 and 3 are provider knowledge and live in the
 * adapter. Layer 4 is not here at all: it is a confidence penalty, not an
 * exclusion, and lives in `confidence.ts`.
 *
 * Why the ordering matters beyond cost: one dependabot PR in a digest tells the
 * user we are not paying attention, and that costs more than the model call did.
 */

import { NOT_NOISE, noise, type NoiseVerdict, type SourceConfig } from './types';

/**
 * The rule vocabulary. Stored in `CaptureSignal.noiseRule`, so these strings
 * are effectively data — renaming one orphans existing rows. `NOISE_RULE_COPY`
 * is what the UI renders; the key is what the database holds.
 */
export const NOISE_RULES = {
    // layer 1 — provider hard exclusions
    botAuthor: 'bot_author',
    dependencyBump: 'dependency_bump',
    choreTitle: 'chore_title',
    mergeCommit: 'merge_commit',
    revertOwn: 'revert_of_own_pr',
    noNetChange: 'no_net_change',
    releaseBranch: 'release_branch_automerge',
    // layer 2 — user config
    excludedRepo: 'user_excluded_repo',
    excludedKeyword: 'user_excluded_keyword',
    notIncludedRepo: 'repo_not_selected',
    // layer 3 — review substance
    reviewNotSubstantive: 'review_not_substantive',
    // post-scoring
    belowDraftThreshold: 'below_draft_threshold',
} as const;

export type NoiseRule = (typeof NOISE_RULES)[keyof typeof NOISE_RULES];

/** User-facing explanation. Never blames the user, never apologises. */
export const NOISE_RULE_COPY: Record<NoiseRule, string> = {
    [NOISE_RULES.botAuthor]: 'Opened by a bot',
    [NOISE_RULES.dependencyBump]: 'Dependency bump',
    [NOISE_RULES.choreTitle]: 'Chore, CI or docs change',
    [NOISE_RULES.mergeCommit]: 'Merge commit',
    [NOISE_RULES.revertOwn]: 'Revert of your own change',
    [NOISE_RULES.noNetChange]: 'No net line change',
    [NOISE_RULES.releaseBranch]: 'Automated release merge',
    [NOISE_RULES.excludedRepo]: 'Repo you asked us to ignore',
    [NOISE_RULES.excludedKeyword]: 'Matches a keyword you ignore',
    [NOISE_RULES.notIncludedRepo]: 'Repo not selected for this source',
    [NOISE_RULES.reviewNotSubstantive]: 'Approval with no substantive comment',
    [NOISE_RULES.belowDraftThreshold]: 'Too little context to draft from',
};

export function describeNoiseRule(rule: string | null | undefined): string {
    if (!rule) return 'Filtered';
    return NOISE_RULE_COPY[rule as NoiseRule] ?? 'Filtered';
}

// ───────────────────────────────────────────────────── layer 2: user config

export type ScopedSignalText = {
    /** The container the signal came from — "owner/repo" for GitHub. */
    scope: string | null;
    title: string;
    body: string;
};

function matchesScope(scope: string, pattern: string): boolean {
    const left = scope.trim().toLowerCase();
    const right = pattern.trim().toLowerCase();
    if (!left || !right) return false;
    if (left === right) return true;
    // "acme/*" excludes a whole org, which is the only wildcard anyone asks for.
    if (right.endsWith('/*')) return left.startsWith(right.slice(0, -1));
    return false;
}

/**
 * Keyword match is whole-word and case-insensitive.
 *
 * Substring matching looks more forgiving and is worse: a user who excludes
 * "ci" would silently lose every PR mentioning "specific" or "decision", and
 * they would never find out, because the whole point of a noise rule is that
 * the result is invisible.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return false;
    const haystack = (text ?? '').toLowerCase();
    if (!haystack) return false;

    // Multi-word keywords are matched as a phrase, still on word boundaries.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{Nd}])${escaped}([^\\p{L}\\p{Nd}]|$)`, 'u').test(haystack);
}

/**
 * Layer 2 — the rules the user taught us. Runs after the provider's hard
 * exclusions and before anything expensive.
 *
 * `includedRepos` is treated as an allow-list when non-empty: the repo picker
 * is mandatory before first sync (§3.2), so "not in the list" is a deliberate
 * user choice and must be honoured even if a stale cursor drags in an old repo.
 */
export function userConfigNoise(signal: ScopedSignalText, config: SourceConfig): NoiseVerdict {
    const scope = signal.scope;

    if (scope) {
        if (config.excludedRepos.some((pattern) => matchesScope(scope, pattern))) {
            return noise(NOISE_RULES.excludedRepo, 2);
        }
        if (
            config.includedRepos.length > 0 &&
            !config.includedRepos.some((pattern) => matchesScope(scope, pattern))
        ) {
            return noise(NOISE_RULES.notIncludedRepo, 2);
        }
    }

    if (config.excludedKeywords.length > 0) {
        const text = `${signal.title ?? ''}\n${signal.body ?? ''}`;
        if (config.excludedKeywords.some((keyword) => matchesKeyword(text, keyword))) {
            return noise(NOISE_RULES.excludedKeyword, 2);
        }
    }

    return NOT_NOISE;
}
