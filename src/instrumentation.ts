/**
 * Boot hook.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `ensureFlagsSeeded()` carried the comment "Idempotent. Safe to run on every
 * deploy" and had no caller anywhere in the codebase. `FEATURE_FLAGS` declares
 * eight flags; the live table held six. `github_capture` and `weekly_digest`
 * had no row at all, and `decideFlag(undefined, …)` returns false before it
 * consults the allow-list — so those two features were off for every user
 * including the admins, permanently, with no supported way to change it.
 *
 * Both are sold on the pricing page as Free-tier features.
 *
 * A missing row is a different failure from a disabled row, and much worse:
 * disabled is a decision someone made, missing is a decision nobody can
 * unmake. Seeding on boot means the table always contains a row per declared
 * flag, defaulting to off, so turning a feature on is a decision rather than a
 * migration.
 */

export async function register(): Promise<void> {
    // Edge and browser bundles have no database. Next runs `register()` in
    // every runtime it builds for, so this guard is required, not defensive.
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    // Say loudly, at boot, which switched-on features cannot work here.
    const { logConfigHealth } = await import('@/lib/health');
    logConfigHealth();
    // Whether the connected database can hold vectors: a property of the live
    // server, not of env. Not awaited: three small queries must not delay boot.
    void import('@/lib/vectorStoreHealth').then((m) => m.logVectorStoreHealth());

    try {
        const { ensureFlagsSeeded } = await import('@/lib/flags');
        await ensureFlagsSeeded();
    } catch (error: unknown) {
        // Never take the process down for this. A boot that fails here should
        // serve a product with flags off, not no product at all — and flags
        // already fail closed when the table is unreadable.
        console.error('[instrumentation] flag seeding failed', {
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}
