/**
 * A declared limit with no call site is not a limit; it is documentation.
 *
 * `METERED_ACTIONS` declares ten actions and the plan tables give every one of
 * them a per-tier quota. Six were actually passed to `gateMeteredAction`
 * somewhere. The other four had numbers in the comparison table and no
 * enforcement anywhere in the codebase — including `month_in_review`, which is
 * `period(0)` on Free and is the flagship Career differentiator. The day its
 * feature flag turned on, every free user would have had it, unmetered.
 *
 * Nothing catches that: an unused entry in a const array is perfectly
 * well-typed, and the quota tables have full test coverage of their *values*.
 *
 * So this is a linker, like `src/app/routes.test.ts`. It reads the source for
 * `gateMeteredAction` call sites and requires every declared action to either
 * have one or be listed below with a reason. Adding a metered action now
 * forces the decision instead of deferring it silently.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { METERED_ACTIONS, type MeteredAction } from '@/lib/plans';

const SRC = join(import.meta.dir, '..');

/**
 * Actions whose FEATURE does not exist yet, so there is nothing to gate.
 *
 * This is not a to-do list for wiring; it is a record that the limit is
 * currently describing a capability the product does not have. The comparison
 * table must not advertise these either — see `plans.test.ts` on `built`.
 */
const NO_FEATURE_YET: Record<string, string> = {
    auto_apply:
        'Multi-step apply orchestration is unbuilt. No action, no route, no service.',
    radar_refresh:
        'Radar builds its corpus on read; there is no on-demand refresh entry point to meter.',
    tier2_grounding:
        'Grounding runs one tier today. `claimGrounding` has no second-tier path to charge for.',
    cover_letter:
        'No cover-letter generator exists. The extension classifies a cover-letter QUESTION, which is a different thing and is not metered.',
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.') || entry === '__mocks__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

/** Every action name that reaches `gateMeteredAction`, directly or via a const. */
function gatedActions(): Set<string> {
    const found = new Set<string>();

    for (const file of walk(SRC)) {
        // The gate's own module defines it; a definition is not a call site.
        if (file.endsWith('/lib/entitlements.ts')) continue;
        const source = readFileSync(file, 'utf8');
        if (!source.includes('gateMeteredAction')) continue;

        // Direct: gateMeteredAction(userId, 'review_packet')
        for (const match of source.matchAll(/gateMeteredAction\(\s*[^,]+,\s*'([a-z_]+)'/g)) {
            found.add(match[1]);
        }

        // Indirect: `const X: MeteredAction = 'context_interview'` then
        // `gateMeteredAction(userId, X)`. Resolving the alias properly would
        // need a type-checker; matching the declaration in a file that also
        // calls the gate is enough and errs toward counting a real call site.
        for (const match of source.matchAll(
            /(?:const|let)\s+\w+\s*(?::\s*MeteredAction)?\s*=\s*'([a-z_]+)'(?:\s+as\s+MeteredAction)?/g,
        )) {
            if ((METERED_ACTIONS as readonly string[]).includes(match[1])) found.add(match[1]);
        }
    }

    return found;
}

describe('every metered action is enforced or explicitly unbuilt', () => {
    const gated = gatedActions();

    for (const action of METERED_ACTIONS) {
        test(`${action}`, () => {
            const isGated = gated.has(action);
            const excuse = NO_FEATURE_YET[action];

            if (excuse) {
                // If it gets wired later, delete the entry — an action that is
                // both gated and excused means this list has gone stale.
                expect(
                    isGated,
                    `${action} is now gated; remove it from NO_FEATURE_YET`,
                ).toBe(false);
                return;
            }

            expect(
                isGated,
                `${action} has a quota in every plan and no gateMeteredAction call site. ` +
                    'Either gate it, or add it to NO_FEATURE_YET with the reason its feature does not exist.',
            ).toBe(true);
        });
    }

    test('the excuse list does not name actions that were never declared', () => {
        for (const key of Object.keys(NO_FEATURE_YET)) {
            expect(
                (METERED_ACTIONS as readonly string[]).includes(key),
                `${key} is excused but is not a declared metered action`,
            ).toBe(true);
        }
    });

    test('month_in_review specifically is gated', () => {
        // Called out on its own because it is the one that was both real and
        // unenforced: a Career-only feature that Free would have received in
        // full the moment the work_log flag flipped.
        expect(gated.has('month_in_review' satisfies MeteredAction)).toBe(true);
    });
});
