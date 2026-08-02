/**
 * The numeric guard, executed under Node's V8 — not Bun's JavaScriptCore.
 *
 * WHY THIS FILE EXISTS
 *
 * Every other test in this repo runs on Bun, and Bun is not the runtime that
 * serves requests. Next runs on Node. The two disagree about regular
 * expressions in `u` mode: JavaScriptCore accepts the identity escape `\€`,
 * V8 rejects it as a SyntaxError at construction time.
 *
 * The guard built its currency pattern by prefixing a backslash to every
 * symbol. That is valid on JSC and fatal on V8, so it passed 1,278 unit tests
 * and then threw on the first real request. Because the guard is fail-closed,
 * a thrown pattern is indistinguishable from "unverifiable claim" — the whole
 * AI win path returned an error and no amount of Bun-side testing would ever
 * have said why.
 *
 * A test that runs on Bun cannot catch a bug that only Node has. So this file
 * bundles the guard for Node and runs it in a real `node` subprocess. It is
 * deliberately not a unit test of behaviour — `guard.test.ts` owns that. What
 * it asserts is narrower and unavailable anywhere else: *the module loads and
 * its patterns compile on the engine that will actually run them.*
 *
 * Extend the CASES below when the guard grows a pattern built from data rather
 * than written as a literal — those are the ones that can differ per engine.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Inputs chosen to force construction of every DATA-BUILT pattern in the
 * guard. A literal regex is identical on both engines; a pattern assembled
 * from a table at call time is the one that can be malformed.
 */
const CASES = [
    { text: 'cut spend by €450k', why: 'currency symbols — the table that broke' },
    { text: 'saved $1.2m in cloud costs', why: 'currency + scale suffix' },
    { text: 'went from ₹80,000 to ₹12,000', why: 'non-latin currency symbol' },
    { text: 'p95 dropped from 4.2s to 900ms', why: 'duration units' },
    { text: 'reduced errors by 37%', why: 'percentage' },
    { text: 'halved the queue and doubled throughput', why: 'written quantities' },
    { text: 'shrank the image from 1.4GB to 320MB', why: 'byte units' },
];

const HARNESS = `
import { extractQuantities } from './guard.mjs';
const cases = ${JSON.stringify(CASES.map((c) => c.text))};
const out = cases.map((text) => {
  try {
    return { text, ok: true, n: extractQuantities(text).length };
  } catch (e) {
    return { text, ok: false, error: String(e && e.message || e) };
  }
});
process.stdout.write(JSON.stringify(out));
`;

type Row = { text: string; ok: boolean; n?: number; error?: string };

async function runGuardUnderNode(): Promise<Row[]> {
    const dir = await mkdtemp(join(tmpdir(), 'guard-node-'));
    try {
        // Bundle to plain ESM so `node` can load TypeScript that imports from
        // '@/...'. Bundling (not transpiling) also resolves the alias.
        const build = await Bun.build({
            entrypoints: [join(import.meta.dir, 'guard.ts')],
            target: 'node',
            format: 'esm',
        });
        if (!build.success) {
            throw new Error(`bundling guard.ts failed: ${build.logs.join('\n')}`);
        }

        await writeFile(join(dir, 'guard.mjs'), await build.outputs[0].text());
        await writeFile(join(dir, 'run.mjs'), HARNESS);

        const proc = Bun.spawn(['node', join(dir, 'run.mjs')], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        if (code !== 0) {
            throw new Error(`node exited ${code}: ${stderr.slice(0, 800)}`);
        }
        return JSON.parse(stdout) as Row[];
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

describe('numeric guard under Node/V8', () => {
    test(
        'every data-built pattern compiles on the engine that serves requests',
        async () => {
            const rows = await runGuardUnderNode();
            const failed = rows.filter((r) => !r.ok);

            // Name the offending input and V8's message, so the next person
            // sees "Invalid escape" rather than a bare count mismatch.
            expect(
                failed.map((r) => `${r.text} → ${r.error}`).join('\n'),
            ).toBe('');
            expect(rows).toHaveLength(CASES.length);
        },
        30_000,
    );

    test('the currency table itself round-trips through V8', async () => {
        const rows = await runGuardUnderNode();
        const currency = rows.filter((r) => /[$€₹]/.test(r.text));

        expect(currency).not.toHaveLength(0);
        // Not just "didn't throw" — it has to still extract the quantity.
        currency.forEach((r) => {
            expect(r.ok).toBe(true);
            expect(r.n).toBeGreaterThan(0);
        });
    }, 30_000);
});
