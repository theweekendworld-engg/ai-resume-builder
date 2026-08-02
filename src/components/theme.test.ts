/**
 * Theme gates.
 *
 * The authenticated app defaults to LIGHT (design/00 §3.1), but most of this
 * codebase was written when it defaulted to dark. That leaves one specific,
 * recurring defect: a light-weight palette shade — `text-green-400`,
 * `text-yellow-400` — which is calibrated to sit on a dark card and lands
 * around 1.8:1 on a light one. It does not look broken in a diff. It looks
 * broken to a user, and only to the users who never switch to dark.
 *
 * It has now shipped twice: the Clerk widget painted near-white text on a
 * near-white card, and the ATS score readouts in the copilot and the job-target
 * editor rendered green/yellow/red 400s on light cards. Both were found by
 * looking rather than by anything failing, which is why this file exists.
 *
 * The rule is not "no palette colors". It is: a color that only works on one
 * background must say which one.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/app', 'src/components'];
const EXTENSIONS = ['.tsx', '.ts'];

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...walk(full));
            continue;
        }
        if (!EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
        if (entry.includes('.test.')) continue;
        out.push(full);
    }
    return out;
}

const FILES = ROOTS.flatMap(walk);

/**
 * Strip the variants that already declare which background they are for.
 * `dark:text-emerald-400` is a correct, deliberate pairing; the bare form is
 * the bug. Also drops `//` comments so a line explaining the rule cannot
 * trip it.
 */
function withoutQualifiedVariants(source: string): string {
    return source
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\bdark:[\w[\]/.-]+/g, '')
        .replace(/\blight:[\w[\]/.-]+/g, '');
}

/** Weights tuned for a dark ground. On the light default these fail contrast. */
const DARK_ONLY_TEXT = /\btext-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:200|300|400)\b/g;

describe('light mode is the default, so unqualified colors must work on light', () => {
    test('no dark-weight text color without a matching light treatment', () => {
        const offenders: string[] = [];

        for (const file of FILES) {
            const source = withoutQualifiedVariants(readFileSync(file, 'utf8'));
            for (const match of source.matchAll(DARK_ONLY_TEXT)) {
                offenders.push(`${file}: ${match[0]}`);
            }
        }

        // Use a semantic token instead — `text-success`, `text-warning`,
        // `text-destructive`. Those carry a measured contrast ratio in BOTH
        // themes (see the comments beside --success and --warning in
        // globals.css), which a raw shade cannot.
        expect(offenders).toEqual([]);
    });
});

describe('semantic tokens exist for the cases people reach for a palette shade', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8');

    test.each(['success', 'warning', 'destructive'])('--%s is defined for both themes', (token) => {
        // Two definitions: the `:root` light value and the `.dark` override. A
        // token defined once is a token that only works in one theme.
        const occurrences = globals.match(new RegExp(`--${token}:`, 'g')) ?? [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
});
