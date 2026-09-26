/**
 * Nobody reaches admin who is not on the allow-list.
 *
 * ── Why a linter and not a unit test ────────────────────────────────────────
 *
 * The admin PAGES do not check anything themselves. Each one calls an action
 * and redirects if it throws:
 *
 *     try { data = await getAdminDashboardData(); }
 *     catch { redirect('/dashboard'); }
 *
 * That is sound — the guard lives in the action, which is the right place,
 * because a server action is a public endpoint and a page-level check would
 * not protect it. `FeatureFlagPanel` is a client component posting straight to
 * `setFeatureFlag`; anyone can craft that request, and `requireAdminUserId`
 * is what stops them.
 *
 * But it means the protection is INDIRECT. A future admin page that renders
 * something static, or reads the database itself instead of going through an
 * action, would be wide open and nothing would fail. So this checks the shape
 * rather than the behaviour: every exported action in the admin modules
 * guards, and every admin page's data comes from one of them.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isAdminUserId } from '@/lib/adminAuth';

const SRC = join(import.meta.dir, '..');
const ADMIN_MODULES = ['actions/admin.ts', 'actions/ops.ts', 'actions/agentOps.ts'];

function exportedActions(source: string): { name: string; guarded: boolean }[] {
    const out: { name: string; guarded: boolean }[] = [];
    for (const match of source.matchAll(/export async function (\w+)\s*\([^)]*\)[^{]*\{/g)) {
        // The guard must be in the first statements, not buried after work.
        const body = source.slice(match.index! + match[0].length, match.index! + match[0].length + 400);
        out.push({ name: match[1], guarded: body.includes('requireAdminUserId') });
    }
    return out;
}

describe('every admin action checks the allow-list', () => {
    for (const rel of ADMIN_MODULES) {
        const source = readFileSync(join(SRC, rel), 'utf8');
        for (const action of exportedActions(source)) {
            test(`${rel} · ${action.name}`, () => {
                expect(
                    action.guarded,
                    `${action.name} is exported from ${rel} without calling requireAdminUserId(). ` +
                        'A server action is a public endpoint — the page redirect does not protect it.',
                ).toBe(true);
            });
        }
    }
});

describe('every admin page is fed by a guarded action', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/page\.tsx?$/.test(full)) out.push(full);
        }
        return out;
    }

    const adminDir = join(SRC, 'app', '(app)', 'admin');
    const guardedNames = ADMIN_MODULES.flatMap((rel) =>
        exportedActions(readFileSync(join(SRC, rel), 'utf8'))
            .filter((a) => a.guarded)
            .map((a) => a.name),
    );

    for (const page of walk(adminDir)) {
        const rel = page.slice(SRC.length + 1);
        test(rel, () => {
            const source = readFileSync(page, 'utf8');
            const callsGuarded = guardedNames.some((name) => source.includes(`${name}(`));
            expect(
                callsGuarded,
                `${rel} renders without calling any guarded admin action, so nothing checks ` +
                    'who is asking. Read its data through an action in src/actions/admin.ts.',
            ).toBe(true);
        });
    }
});

describe('the allow-list fails closed', () => {
    const saved = process.env.ADMIN_USER_IDS;
    const restore = () => {
        if (saved === undefined) delete process.env.ADMIN_USER_IDS;
        else process.env.ADMIN_USER_IDS = saved;
    };

    test('unset means nobody, not everybody', () => {
        // The direction that matters. A misconfigured deploy must lock admin
        // shut rather than open it to every signed-in user.
        delete process.env.ADMIN_USER_IDS;
        expect(isAdminUserId('user_anyone')).toBe(false);
        restore();
    });

    test('empty means nobody', () => {
        process.env.ADMIN_USER_IDS = '';
        expect(isAdminUserId('user_anyone')).toBe(false);
        restore();
    });

    test('a signed-out caller is never an admin', () => {
        process.env.ADMIN_USER_IDS = 'user_a';
        expect(isAdminUserId(null)).toBe(false);
        expect(isAdminUserId(undefined)).toBe(false);
        expect(isAdminUserId('')).toBe(false);
        restore();
    });

    test('only the listed ids pass, and matching is exact', () => {
        process.env.ADMIN_USER_IDS = 'user_a, user_b';
        expect(isAdminUserId('user_a')).toBe(true);
        expect(isAdminUserId('user_b')).toBe(true);
        expect(isAdminUserId('user_c')).toBe(false);
        // No prefix or substring escape.
        expect(isAdminUserId('user_ab')).toBe(false);
        expect(isAdminUserId('user_')).toBe(false);
        restore();
    });
});
