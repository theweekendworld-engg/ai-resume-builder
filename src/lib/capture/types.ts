/**
 * The connector framework contract — PRD 02 §2.1.
 *
 * Every source in the product speaks this interface. GitHub is the first
 * implementation; the R2 calendar adapter is meant to be one file that exports
 * a `CaptureAdapter` and one line in `registry.ts`, not a second subsystem.
 *
 * Two deliberate deviations from the PRD's sketch, both because the schema asks
 * for more than a boolean can carry:
 *
 *   - `isNoise` returns a `NoiseVerdict`, not `boolean`. `CaptureSignal.noiseRule`
 *     exists so a user can be told *why* something was filtered and so the
 *     dismiss-to-rule loop (§6.2) has something to point at. A bare boolean
 *     throws that away at the only place it is known.
 *   - `pull` also reports `requestsUsed`, so the ≤60-requests-per-sync budget
 *     (§3.3) is observable rather than aspirational.
 */

import type { CaptureSourceKind } from '@prisma/client';

// ───────────────────────────────────────────────────────────── signals

/**
 * Signal kinds across all adapters. Stored as a plain string on
 * `CaptureSignal.kind` (the schema keeps it open so R2 adapters do not need a
 * migration), but typed here so a typo is a compile error.
 */
export const SIGNAL_KINDS = [
    'pr_merged',
    'pr_reviewed',
    'issue_closed',
    'release_published',
    'repo_created',
    // R2 — declared now so the framework's types do not move when they land.
    'meeting_led',
    'issue_completed',
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

export function isSignalKind(value: unknown): value is SignalKind {
    return typeof value === 'string' && (SIGNAL_KINDS as readonly string[]).includes(value);
}

/**
 * What an adapter emits. Maps 1:1 onto a `CaptureSignal` row.
 *
 * `externalId` MUST be provider-stable. For GitHub that is the GraphQL node ID
 * — never the PR number, which is per-repo and reused after a transfer (§5).
 */
export type RawSignal = {
    externalId: string;
    kind: SignalKind;
    occurredAt: Date;
    title: string;
    body: string;
    url: string | null;
    metadata: Record<string, unknown>;
};

/** A stored signal, as the drafting stage sees it. */
export type StoredSignal = RawSignal & { id: string; sourceId: string; userId: string };

// ───────────────────────────────────────────────────────────── noise

export type NoiseVerdict =
    | { noise: false }
    /** `rule` lands in `CaptureSignal.noiseRule` and in the settings copy. */
    | { noise: true; rule: string; layer: 1 | 2 | 3 };

export const NOT_NOISE: NoiseVerdict = { noise: false };

export function noise(rule: string, layer: 1 | 2 | 3): NoiseVerdict {
    return { noise: true, rule, layer };
}

// ───────────────────────────────────────────────────────────── config

/**
 * `CaptureSource.config`, adapter-agnostic half. Persisted as JSON, so every
 * read goes through `parseSourceConfig` rather than a cast.
 */
export type SourceConfig = {
    /** GitHub: "owner/name". Empty means "not chosen yet" — sync must not run. */
    includedRepos: string[];
    /** Learned from dismiss-with-reason-noise (§6.2). */
    excludedRepos: string[];
    excludedKeywords: string[];
    /** R2 calendar. Present here so the type does not fork per adapter. */
    calendars: string[];
};

export const EMPTY_SOURCE_CONFIG: SourceConfig = {
    includedRepos: [],
    excludedRepos: [],
    excludedKeywords: [],
    calendars: [],
};

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
        seen.add(trimmed.toLowerCase());
        out.push(trimmed);
    }
    return out;
}

/** Total: any shape of stored JSON resolves to a usable config. */
export function parseSourceConfig(raw: unknown): SourceConfig {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
        includedRepos: stringArray(record.includedRepos),
        excludedRepos: stringArray(record.excludedRepos),
        excludedKeywords: stringArray(record.excludedKeywords),
        calendars: stringArray(record.calendars),
    };
}

// ───────────────────────────────────────────────────────────── grouping

/**
 * Related signals collapsed into one drafting candidate (§4.1). Grouping is
 * deterministic code, never a model call — a refactor spread over six PRs is
 * one Win, and that judgement must not vary between runs.
 */
export type SignalGroup = {
    /** Stable across runs for the same member set. Written to `CaptureSignal.groupKey`. */
    key: string;
    kind: SignalKind;
    /** The signal whose context leads the draft; carries the Win's `signalId`. */
    primary: RawSignal;
    /** Includes `primary`, ordered oldest first. */
    signals: RawSignal[];
};

// ───────────────────────────────────────────────────────────── pull

export type PullResult = {
    signals: RawSignal[];
    /** ISO timestamp of the last fully-processed item, or null to leave the cursor. */
    nextCursor: string | null;
    /** True when a rate limit cut the pull short. The cursor is still safe to persist. */
    partial: boolean;
    /** Provider requests spent. Budget is `MAX_REQUESTS_PER_SYNC`. */
    requestsUsed: number;
    /** Non-fatal problems worth surfacing in the run record. */
    warnings: string[];
};

/** The subset of `CaptureSource` an adapter needs. Keeps adapters testable. */
export type SourceContext = {
    id: string;
    userId: string;
    kind: CaptureSourceKind;
    externalAccountId: string;
    scopes: string[];
    config: SourceConfig;
    cursor: string | null;
};

export type ConnectResult = {
    externalAccountId: string;
    scopes: string[];
};

/** The "From: …" line rendered under a drafted Win in the digest. */
export type Attribution = { label: string; url: string | null };

// ───────────────────────────────────────────────────────────── the contract

export interface CaptureAdapter {
    kind: CaptureSourceKind;

    /** Human label for settings and the digest. */
    displayName: string;

    /** OAuth or token setup; returns the external account identity. */
    connect(userId: string, params: unknown): Promise<ConnectResult>;

    /**
     * Pull items since the cursor. MUST be incremental and MUST be idempotent:
     * the same window pulled twice yields the same `externalId`s, which the
     * `@@unique([sourceId, externalId])` constraint then collapses.
     */
    pull(source: SourceContext, since: Date | null, opts?: PullOptions): Promise<PullResult>;

    /** Source-specific noise rules, applied before any AI cost is incurred. */
    isNoise(signal: RawSignal, config: SourceConfig): NoiseVerdict;

    /** Collapse related signals into candidates. Deterministic. */
    group(signals: RawSignal[]): SignalGroup[];

    /** Attribution line for the digest. */
    attribution(signal: RawSignal): Attribution;
}

export type PullOptions = {
    /** Hard ceiling on provider requests. Defaults to `MAX_REQUESTS_PER_SYNC`. */
    maxRequests?: number;
    /** Upper bound of the window; defaults to now. Injected by tests. */
    now?: Date;
};
