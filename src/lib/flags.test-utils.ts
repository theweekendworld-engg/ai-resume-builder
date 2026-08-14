/**
 * The flag table, borrowed and given back.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Nine test files write `FeatureFlag`, and the suite runs against the same
 * local Postgres a human develops on. Between them they:
 *
 *   - left `missions` disabled after using it,
 *   - DELETED `github_capture` and `weekly_digest` outright, via the
 *     "if the row did not exist before, remove it" cleanup pattern — which is
 *     correct in isolation and wrong the moment two files disagree about
 *     whether it existed,
 *   - and assumed `enabled` was ambient-false while asserting about gating.
 *
 * The visible symptom: turn every feature on for development, run the tests,
 * and some features are off again. It cost a real debugging detour — a flag
 * that read `enabled=true` in one process and `false` a minute later, with the
 * boot-time seeder wrongly suspected.
 *
 * A test may absolutely change a flag. It may not change one and walk away.
 */

import { prisma } from '@/lib/prisma';
import { invalidateFlagCache, type FeatureFlagKey } from '@/lib/flags';

export type FlagSnapshot = Array<{
    key: string;
    enabled: boolean;
    rolloutPercent: number;
    allowUserIds: string[];
    description: string;
}>;

/** Take before you touch anything. */
export async function snapshotFlags(): Promise<FlagSnapshot> {
    const rows = await prisma.featureFlag.findMany();
    return rows.map((row) => ({
        key: row.key,
        enabled: row.enabled,
        rolloutPercent: row.rolloutPercent,
        allowUserIds: Array.isArray(row.allowUserIds)
            ? (row.allowUserIds as unknown[]).filter((v): v is string => typeof v === 'string')
            : [],
        description: row.description ?? '',
    }));
}

/**
 * Put it back exactly: values restored, rows the test invented removed, rows
 * the test deleted recreated.
 */
export async function restoreFlags(snapshot: FlagSnapshot): Promise<void> {
    const keep = new Set(snapshot.map((row) => row.key));

    await prisma.featureFlag.deleteMany({ where: { key: { notIn: [...keep] } } });

    for (const row of snapshot) {
        await prisma.featureFlag.upsert({
            where: { key: row.key },
            create: row,
            update: {
                enabled: row.enabled,
                rolloutPercent: row.rolloutPercent,
                allowUserIds: row.allowUserIds,
            },
        });
    }

    invalidateFlagCache();
}

/**
 * Set a flag for the duration of a test file.
 *
 * Always pair with {@link restoreFlags}. `allowUserIds` defaults to empty
 * rather than preserving what was there — a test asserting that a flagged-off
 * user is refused must not inherit a developer's own id from the allow-list.
 */
export async function setFlagForTest(
    key: FeatureFlagKey,
    state: { enabled: boolean; rolloutPercent?: number; allowUserIds?: string[] },
): Promise<void> {
    await prisma.featureFlag.upsert({
        where: { key },
        create: {
            key,
            enabled: state.enabled,
            rolloutPercent: state.rolloutPercent ?? (state.enabled ? 100 : 0),
            allowUserIds: state.allowUserIds ?? [],
            description: `Career OS: ${key}`,
        },
        update: {
            enabled: state.enabled,
            rolloutPercent: state.rolloutPercent ?? (state.enabled ? 100 : 0),
            allowUserIds: state.allowUserIds ?? [],
        },
    });
    invalidateFlagCache();
}
