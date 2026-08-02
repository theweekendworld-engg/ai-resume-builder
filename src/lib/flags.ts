/**
 * Feature flags (impl/00 ADR-7).
 *
 * Postgres-backed, not a vendor. At validation scale one table plus a short
 * in-process cache is the whole requirement, and a flag you can flip with SQL
 * beats one behind someone else's dashboard.
 *
 * Distinct from entitlements: a flag answers "is this built and turned on for
 * this user", an entitlement answers "is this user allowed to use it". A gated
 * feature checks both, in that order.
 */

import { prisma } from '@/lib/prisma';

export const FEATURE_FLAGS = [
    'work_log',
    'github_capture',
    'weekly_digest',
    'review_packet',
    'month_in_review',
    'backfill',
    'career_radar',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

type FlagRow = {
    enabled: boolean;
    allowUserIds: string[];
    rolloutPercent: number;
};

const CACHE_TTL_MS = 60_000;

let cache: Map<string, FlagRow> | null = null;
let cachedAt = 0;
let inflight: Promise<Map<string, FlagRow>> | null = null;

function parseAllowList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

async function loadFlags(): Promise<Map<string, FlagRow>> {
    const rows = await prisma.featureFlag.findMany({
        select: { key: true, enabled: true, allowUserIds: true, rolloutPercent: true },
    });
    const next = new Map<string, FlagRow>();
    for (const row of rows) {
        next.set(row.key, {
            enabled: row.enabled,
            allowUserIds: parseAllowList(row.allowUserIds),
            rolloutPercent: row.rolloutPercent,
        });
    }
    return next;
}

/** Single-flight so a cold cache under load issues one query, not N. */
async function getFlags(): Promise<Map<string, FlagRow>> {
    const fresh = cache && Date.now() - cachedAt < CACHE_TTL_MS;
    if (fresh && cache) return cache;
    if (inflight) return inflight;

    inflight = loadFlags()
        .then((next) => {
            cache = next;
            cachedAt = Date.now();
            return next;
        })
        .catch((error: unknown) => {
            // Fail closed. An unreadable flag table must not silently enable
            // unfinished features; serve the stale cache if we have one.
            console.error('[flags] load failed; treating flags as off', {
                error: error instanceof Error ? error.message : 'unknown error',
            });
            return cache ?? new Map<string, FlagRow>();
        })
        .finally(() => {
            inflight = null;
        });

    return inflight;
}

/**
 * Deterministic 0–99 bucket for (userId, key).
 *
 * Must be stable: a user who flaps in and out of a rollout as the percentage
 * changes sees features appear and vanish. FNV-1a — cheap, no crypto needed,
 * and keyed by flag so a user is not always in the same bucket everywhere.
 */
export function rolloutBucket(userId: string, key: string): number {
    const input = `${key}:${userId}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % 100;
}

/** Pure decision, exported for testing without a database. */
export function decideFlag(row: FlagRow | undefined, userId: string, key: string): boolean {
    if (!row) return false;
    // The allow-list wins over `enabled` — that is what makes it useful for
    // giving the team access to a feature that is off for everyone else.
    if (row.allowUserIds.includes(userId)) return true;
    if (!row.enabled) return false;
    if (row.rolloutPercent >= 100) return true;
    if (row.rolloutPercent <= 0) return false;
    return rolloutBucket(userId, key) < row.rolloutPercent;
}

export async function isEnabled(userId: string, key: FeatureFlagKey): Promise<boolean> {
    const flags = await getFlags();
    return decideFlag(flags.get(key), userId, key);
}

/** One round trip when a surface gates on several flags. */
export async function getEnabledFlags(userId: string): Promise<Record<FeatureFlagKey, boolean>> {
    const flags = await getFlags();
    return Object.fromEntries(
        FEATURE_FLAGS.map((key) => [key, decideFlag(flags.get(key), userId, key)]),
    ) as Record<FeatureFlagKey, boolean>;
}

/** Call after an admin write so the change is visible immediately. */
export function invalidateFlagCache(): void {
    cache = null;
    cachedAt = 0;
}

/** Idempotent. Safe to run on every deploy. */
export async function ensureFlagsSeeded(): Promise<void> {
    await Promise.all(
        FEATURE_FLAGS.map((key) =>
            prisma.featureFlag.upsert({
                where: { key },
                create: { key, enabled: false, description: `Career OS: ${key}` },
                update: {},
            }),
        ),
    );
    invalidateFlagCache();
}
