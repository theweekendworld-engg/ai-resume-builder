/**
 * GitHub noise rules — PRD 02 §6.1 (layer 1) and §6.3 (layer 3).
 *
 * Layer 1 is free and deterministic and runs before a signal is even stored.
 * Layer 3 is the review-substance test, which is what stops "LGTM" from
 * becoming a Win.
 *
 * The bot rule is the one with a binary acceptance criterion (§12): zero bot
 * PRs may ever produce a draft. It is therefore written to over-exclude — a
 * human whose login happens to end in `-bot` loses some drafts; a dependabot PR
 * in a digest loses the user's trust in the whole product.
 */

import { NOT_NOISE, noise, type NoiseVerdict, type SourceConfig } from '../types';
import { NOISE_RULES, userConfigNoise } from '../noise';
import type { GithubSignalMetadata } from './types';

// ───────────────────────────────────────────────────── layer 1: bots

/**
 * Logins that are bots regardless of what the API says about `type`. GitHub
 * reports some app-driven accounts as `User`, and `github-actions[bot]` shows
 * up under several spellings depending on which endpoint answered.
 */
export const BOT_LOGIN_PATTERNS: readonly RegExp[] = [
    /\[bot\]$/i,
    /^dependabot(-preview)?$/i,
    /^renovate(-bot)?$/i,
    /^github-actions$/i,
    /^greenkeeper$/i,
    /^snyk-bot$/i,
    /^imgbot$/i,
    /^allcontributors$/i,
    /^mergify$/i,
    /^codecov(-commenter|-io)?$/i,
    /^semantic-release-bot$/i,
    /^whitesource(-bolt-for-github)?$/i,
    /^pyup-bot$/i,
    /^stale$/i,
    /^netlify$/i,
    /^vercel$/i,
    /-bot$/i,
    /^bot-/i,
];

export function isBotAuthor(metadata: Pick<GithubSignalMetadata, 'authorLogin' | 'authorType'>): boolean {
    if (metadata.authorType === 'Bot') return true;
    const login = (metadata.authorLogin ?? '').trim();
    if (!login) return false;
    return BOT_LOGIN_PATTERNS.some((pattern) => pattern.test(login));
}

// ───────────────────────────────────────────────────── layer 1: titles

/** §6.1 — conventional-commit chore scopes. */
export const CHORE_TITLE_PATTERN = /^\s*(chore|ci|build|deps|docs)\s*(\([^)]*\))?\s*!?\s*:/i;

/** §6.1 — "bump x from 1.2 to 1.3", "update y to v2". */
export const DEPENDENCY_BUMP_PATTERN = /^\s*(bump|update|upgrade)\b.*\b(from|to)\s+v?\d/i;

/** Belt and braces: dependabot's own title shapes, in case the author lookup failed. */
export const DEPENDENCY_TITLE_PATTERNS: readonly RegExp[] = [
    DEPENDENCY_BUMP_PATTERN,
    /^\s*(build\(deps\)|chore\(deps\))/i,
    /^\s*bump\s+@?[\w./-]+\s+from\s+/i,
    /^\s*update\s+dependenc(y|ies)\b/i,
    /^\s*\[security\]\s+bump\b/i,
];

export const MERGE_COMMIT_PATTERN = /^\s*merge\s+(branch|pull request|remote-tracking|commit)\b/i;

export const REVERT_PATTERN = /^\s*revert\s+["']?/i;

export const RELEASE_BRANCH_PATTERN = /^(release|releases|hotfix)\//i;

// ───────────────────────────────────────────────────── layer 1, assembled

export type GithubNoiseInput = {
    title: string;
    body: string;
    metadata: GithubSignalMetadata;
};

/**
 * Layer 1 — hard exclusions. A `true` verdict means the signal is dropped
 * before it is stored (§6.1), so this must never depend on user config or on
 * anything that could change between runs.
 */
export function hardExclusion(input: GithubNoiseInput): NoiseVerdict {
    const { title, metadata } = input;

    if (isBotAuthor(metadata)) return noise(NOISE_RULES.botAuthor, 1);

    if (DEPENDENCY_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
        return noise(NOISE_RULES.dependencyBump, 1);
    }
    if (CHORE_TITLE_PATTERN.test(title)) return noise(NOISE_RULES.choreTitle, 1);
    if (MERGE_COMMIT_PATTERN.test(title)) return noise(NOISE_RULES.mergeCommit, 1);

    // "Revert of *own* PR" — a revert of someone else's change is often real
    // incident work and keeps its chance at a draft (with the §6.4 penalty).
    if (metadata.isRevert || REVERT_PATTERN.test(title)) {
        if (metadata.role === 'author') return noise(NOISE_RULES.revertOwn, 1);
    }

    if (RELEASE_BRANCH_PATTERN.test(metadata.branch ?? '')) {
        return noise(NOISE_RULES.releaseBranch, 1);
    }

    // "PRs with 0 net line change" — read as "changed nothing at all". A pure
    // file move has additions === deletions and is emphatically not nothing.
    if (metadata.role === 'author' && metadata.additions + metadata.deletions === 0) {
        return noise(NOISE_RULES.noNetChange, 1);
    }

    return NOT_NOISE;
}

// ───────────────────────────────────────────────────── layer 3: reviews

/** §6.3 — "≥1 comment of ≥120 characters, or the review state is CHANGES_REQUESTED". */
export const SUBSTANTIVE_REVIEW_CHARS = 120;

/**
 * Boilerplate that clears the character count without carrying any substance.
 * Stripped before measuring so a 200-character quoted diff plus "LGTM" does not
 * pass as a considered review.
 */
function reviewSubstanceText(reviewBody: string): string {
    return (reviewBody ?? '')
        // fenced code and quoted diffs are the reviewee's words, not the reviewer's
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^>.*$/gm, ' ')
        .replace(/^\s*(lgtm|looks good(?: to me)?|ship it|👍|:\+1:|nice|thanks?|ty)\W*$/gim, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isSubstantiveReview(metadata: Pick<GithubSignalMetadata, 'reviewState' | 'reviewBody'>): boolean {
    if (metadata.reviewState === 'CHANGES_REQUESTED') return true;
    return reviewSubstanceText(metadata.reviewBody).length >= SUBSTANTIVE_REVIEW_CHARS;
}

export function reviewSubstanceNoise(input: GithubNoiseInput): NoiseVerdict {
    if (input.metadata.role !== 'reviewer') return NOT_NOISE;
    return isSubstantiveReview(input.metadata) ? NOT_NOISE : noise(NOISE_RULES.reviewNotSubstantive, 3);
}

// ───────────────────────────────────────────────────── all layers, in order

/**
 * Layers 1 → 2 → 3, cheapest first. Layer 4 is deliberately absent: it is a
 * confidence penalty (`confidence.ts`), because sometimes "cleanup" is a
 * 3,000-line deletion that mattered.
 */
export function classifyGithubNoise(input: GithubNoiseInput, config: SourceConfig): NoiseVerdict {
    const layer1 = hardExclusion(input);
    if (layer1.noise) return layer1;

    const layer2 = userConfigNoise(
        { scope: input.metadata.repo || null, title: input.title, body: input.body },
        config,
    );
    if (layer2.noise) return layer2;

    return reviewSubstanceNoise(input);
}
