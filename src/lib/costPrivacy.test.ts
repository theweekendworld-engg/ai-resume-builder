import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supplier cost never renders outside /admin.
 *
 * This was asserted once and was wrong: a grep for `costUsd` missed
 * `totalCostUsd` on the dashboard, and users were shown "Cost (USD) $0.23" for
 * months. A claim about the whole tree is exactly the kind that should be a
 * test rather than a memory — the next component to render a cost figure will
 * fail here rather than ship.
 *
 * Cost is a fact about our supplier bill, not about the customer. Showing it on
 * a $5 plan invites the question of why the plan is $5, and exposes a number
 * that moves whenever the model changes.
 */
function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
        else if (full.endsWith('.tsx')) out.push(full);
    }
    return out;
}

const COST_TOKENS = ['costUsd', 'CostUsd', 'Cost (USD)'];

describe('supplier cost is admin-only', () => {
    const files = [...tsxFiles('src/components'), ...tsxFiles('src/app')];

    test('the sweep actually found components (guards a vacuous pass)', () => {
        expect(files.length).toBeGreaterThan(50);
    });

    test('no component outside /admin renders a cost figure', () => {
        const offenders = files
            .filter((file) => !file.includes('admin'))
            .filter((file) => {
                const source = readFileSync(file, 'utf8');
                return COST_TOKENS.some((token) => source.includes(token));
            });
        expect(offenders).toEqual([]);
    });

    test('admin still shows it — this is a boundary, not a ban', () => {
        const adminFiles = files.filter((file) => file.includes('admin'));
        const anyCost = adminFiles.some((file) =>
            COST_TOKENS.some((token) => readFileSync(file, 'utf8').includes(token)),
        );
        expect(anyCost).toBe(true);
    });
});
