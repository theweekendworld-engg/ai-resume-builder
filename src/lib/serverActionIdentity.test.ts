/**
 * No server action may let its CALLER say who the user is.
 *
 * A `'use server'` export is a public HTTP endpoint. Found 2026-09-26, live in
 * production: `processChannelGenerate` took `userId` / `externalId` from its
 * input and returned them as the acting user; `calculateATSScore`,
 * `generateTailoredResume` and `compileLatex` passed `tracking.userId` to a
 * `requireAuth(override)` that returned it unchecked. Any signed-in user could
 * generate a resume from another user's record, and model spend could be
 * attributed to anyone.
 *
 * Like `adminGating.test.ts`, this checks shape, not behaviour, because the
 * failure is structural: an identity parameter on a public export. Code that
 * already knows the user (webhooks, workflow steps, the API-key route) belongs
 * in `src/lib` or `src/services`, which are not endpoints.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.') || entry === '__mocks__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

const IDENTITY = /\b(userId|actorUserId|externalId|overrideUserId)\b/;

/** The balanced `z.object( ... )` text of `const <name> = z.object(...)`, or ''. */
function schemaBody(source: string, name: string): string {
    const start = source.search(new RegExp(`const\\s+${name}\\s*=\\s*z\\.object\\(`));
    if (start < 0) return '';
    let i = source.indexOf('(', start) + 1;
    const from = i;
    let depth = 1;
    while (depth > 0 && i < source.length) {
        if (source[i] === '(') depth += 1;
        if (source[i] === ')') depth -= 1;
        i += 1;
    }
    return source.slice(from, i - 1);
}

/** The parameter list of each exported async function, plus any named type it uses. */
function exportedParams(source: string): { name: string; params: string; body: string }[] {
    const out: { name: string; params: string; body: string }[] = [];
    for (const match of source.matchAll(/export async function (\w+)\s*\(/g)) {
        let i = match.index! + match[0].length;
        let depth = 1;
        while (depth > 0 && i < source.length) {
            if (source[i] === '(') depth += 1;
            if (source[i] === ')') depth -= 1;
            i += 1;
        }
        let params = source.slice(match.index! + match[0].length, i - 1);
        for (const typeName of params.match(/:\s*([A-Z]\w+)/g) ?? []) {
            const name = typeName.replace(/[:\s]/g, '');
            // `[^{;=]*` then `=?`: an alias like `= z.infer<...>;` ends at its
            // semicolon, and must not swallow the next declaration's body.
            const decl = source.match(new RegExp(`(?:type|interface)\\s+${name}\\b[^{;=]*=?\\s*\\{([\\s\\S]*?)\\n\\}`));
            if (decl) params += decl[1];
        }
        const body = source.slice(i, i + 600);
        // `input: unknown` parsed by a schema inside the body is the same hole
        // in a different shape: that is how processChannelGenerate took userId.
        for (const schema of body.match(/(\w+Schema)\.safeParse\(/g) ?? []) {
            params += schemaBody(source, schema.replace('.safeParse(', ''));
        }
        out.push({ name: match[1], params, body });
    }
    return out;
}

const serverActionFiles = walk(SRC).filter((file) => /^\s*['"]use server['"]/.test(readFileSync(file, 'utf8')));

describe('server actions take identity from the session only', () => {
    test('the sweep found server action modules (guards a vacuous pass)', () => {
        expect(serverActionFiles.length).toBeGreaterThan(20);
    });

    for (const file of serverActionFiles) {
        const rel = file.slice(SRC.length + 1);
        for (const fn of exportedParams(readFileSync(file, 'utf8'))) {
            // An admin action may look up another user BY DESIGN, behind the allow-list.
            const adminGuarded = fn.body.includes('requireAdminUserId');
            if (adminGuarded) continue;
            test(`${rel} · ${fn.name}`, () => {
                // Comments may explain the authorization ("queries { id, userId }").
                const code = fn.params.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
                expect(
                    IDENTITY.test(code),
                    `${fn.name} in ${rel} accepts a user identity from its caller. A server action is a public ` +
                        'endpoint: take the user from auth(), and move trusted-caller code to src/lib or src/services.',
                ).toBe(false);
            });
        }
    }
});

describe('requireAuth has no override', () => {
    test('it takes no arguments', () => {
        const source = readFileSync(join(SRC, 'lib', 'auth.ts'), 'utf8');
        expect(source).toMatch(/export async function requireAuth\(\)/);
    });
});
