/**
 * The extension and the web app share one palette, and this proves it.
 *
 * ── Why a test and not a comment ────────────────────────────────────────────
 *
 * `extension/src/shared/ui/tokens.css` carried the comment "kept in sync with
 * the web app's tailwind theme so the extension feels like the same product"
 * above a set of values that had never matched it. `--primary` was generic
 * Tailwind blue-500 rather than the Patronus blue; `--success` was a different
 * hue AND measured about 2.5:1 on white, against the 4.5:1 floor this project
 * sets for itself. Half the app's tokens were missing entirely, and the two
 * files used different NAMES for the ones they shared, so nobody could have
 * spotted it by reading them side by side.
 *
 * A comment cannot fail. This can.
 *
 * The parse is deliberately dumb — a regex over `--token: value;` inside a
 * named block. Neither file uses nesting or interpolation, and a real CSS
 * parser would be a dependency bought to catch nothing.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const APP_CSS = join(ROOT, 'src', 'app', 'globals.css');
const EXT_CSS = join(ROOT, 'extension', 'src', 'shared', 'ui', 'tokens.css');

/**
 * Remove `@media` blocks before parsing.
 *
 * `globals.css` redefines `.dark` inside `@media print` to force black on
 * white for a printed review packet. Read as theme, those seven values look
 * like catastrophic drift — which is exactly what the first run of this test
 * reported. Print is not a theme.
 *
 * `@layer` blocks are deliberately NOT stripped: the extension declares its
 * tokens inside `@layer base`, and that is where its real values live.
 */
function stripMediaBlocks(css: string): string {
    let out = '';
    let i = 0;
    while (i < css.length) {
        const at = css.indexOf('@media', i);
        if (at === -1) {
            out += css.slice(i);
            break;
        }
        out += css.slice(i, at);
        const open = css.indexOf('{', at);
        if (open === -1) break;
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth += 1;
            else if (css[j] === '}') depth -= 1;
            j += 1;
        }
        i = j;
    }
    return out;
}

/**
 * Every `--token: value` declared under a selector containing `needle`.
 *
 * Blocks are found by scanning from the selector to its closing brace, so the
 * app's `:root, .light { … }` and the extension's indented copy inside
 * `@layer base` both resolve.
 */
function tokensIn(rawCss: string, needle: string): Map<string, string> {
    const css = stripMediaBlocks(rawCss);
    const out = new Map<string, string>();
    // The needle is grouped: an ungrouped alternation binds looser than the
    // surrounding pattern, so the trailing `\{` became optional and the depth
    // scan ran straight past the block into `@theme inline`.
    const selector = new RegExp(`(^|\\n)[^\\n{}]*(?:${needle})[^\\n{}]*\\{`, 'g');

    for (const match of css.matchAll(selector)) {
        const start = (match.index ?? 0) + match[0].length;
        let depth = 1;
        let i = start;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth += 1;
            else if (css[i] === '}') depth -= 1;
            i += 1;
        }
        const body = css.slice(start, i - 1);
        for (const decl of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
            out.set(decl[1], decl[2].trim().replace(/\s+/g, ' '));
        }
    }
    return out;
}

const appCss = readFileSync(APP_CSS, 'utf8');
const extCss = readFileSync(EXT_CSS, 'utf8');

/**
 * Tokens the app declares that the extension has no use for.
 *
 * Keep this list short and justified. Anything added here is a place the two
 * products are allowed to look different, which should be rare and deliberate.
 */
const APP_ONLY = new Set<string>([
    // The signature glow is a marketing and reward-moment treatment. A 400px
    // side panel is a work surface end to end (design/00 §1, Problem 2).
    'glow',
]);

/** Colour tokens only — motion and radius are checked separately. */
function isColourToken(name: string): boolean {
    return !['radius'].includes(name) && !name.startsWith('duration-') && !name.startsWith('ease-');
}

describe.each([
    // Both files write the light block as `:root,\n.light {`, so the selector
    // for it is simply `.light` on its own line.
    ['light', '\\.light'],
    ['dark', '\\.dark'],
])('%s theme', (themeName, needle) => {
    const app = tokensIn(appCss, needle);
    const ext = tokensIn(extCss, needle);

    test('the extension declares every colour token the app does', () => {
        const missing = [...app.keys()]
            .filter(isColourToken)
            .filter((name) => !APP_ONLY.has(name))
            .filter((name) => !ext.has(name));

        expect(
            missing,
            `${themeName}: the extension is missing ${missing.join(', ')} — a component moved ` +
                'between the two codebases would render with a fallback colour or none.',
        ).toEqual([]);
    });

    test('every shared token has the same value', () => {
        const drifted: string[] = [];
        for (const [name, value] of app) {
            if (!isColourToken(name) || APP_ONLY.has(name)) continue;
            const theirs = ext.get(name);
            if (theirs !== undefined && theirs !== value) {
                drifted.push(`--${name}: app "${value}" vs extension "${theirs}"`);
            }
        }
        expect(
            drifted,
            `${themeName}: ${drifted.length} token(s) drifted.\n  ${drifted.join('\n  ')}`,
        ).toEqual([]);
    });

    test('the extension invents no colour token of its own', () => {
        // `--bg` and `--surface` were exactly this: private names for concepts
        // the app already had, which is what made the drift invisible.
        const extra = [...ext.keys()].filter(isColourToken).filter((name) => !app.has(name));
        expect(
            extra,
            `${themeName}: ${extra.join(', ')} exists only in the extension. Use the app's name, ` +
                'or add it to the app so both share it.',
        ).toEqual([]);
    });
});

describe('shape and motion', () => {
    test('the same corner radius', () => {
        const app = tokensIn(appCss, ':root');
        const ext = tokensIn(extCss, ':root');
        expect(ext.get('radius')).toBe(app.get('radius'));
    });

    test('the same motion durations and easings', () => {
        const app = tokensIn(appCss, ':root');
        const ext = tokensIn(extCss, ':root');
        for (const name of [...app.keys()].filter(
            (k) => k.startsWith('duration-') || k.startsWith('ease-'),
        )) {
            expect(ext.get(name), `--${name} differs or is missing in the extension`).toBe(
                app.get(name),
            );
        }
    });
});

describe('the typefaces are the app’s, and they are actually present', () => {
    test('both faces are declared', () => {
        expect(extCss).toContain("font-family: 'Inter'");
        expect(extCss).toContain("font-family: 'Sora'");
    });

    test('they are self-hosted, because MV3 blocks remote fonts', () => {
        // The old stack named 'Inter' with no @font-face at all, so the panel
        // silently fell through to system-ui while the web app rendered Inter.
        expect(extCss).toMatch(/src:\s*url\('\.\/fonts\/Inter-latin\.woff2'\)/);
        expect(extCss).toMatch(/src:\s*url\('\.\/fonts\/Sora-latin\.woff2'\)/);
        expect(extCss).not.toMatch(/@import\s+url\(['"]?https?:/);
    });

    test('the font files exist', () => {
        for (const file of ['Inter-latin.woff2', 'Sora-latin.woff2']) {
            const path = join(ROOT, 'extension', 'src', 'shared', 'ui', 'fonts', file);
            expect(() => readFileSync(path), `${file} is referenced but not committed`).not.toThrow();
        }
    });
});

describe('the tokens actually survive the build', () => {
    /**
     * Tailwind purges rules inside `@layer` whose selectors never appear in the
     * content glob. Nothing in the extension's markup writes `.dark` — it has
     * no theme switcher — so the whole dark block was stripped from every build
     * this extension ever produced. Dark mode looked implemented in source and
     * had never once shipped.
     *
     * Nothing could have caught that by reading the CSS, which is why the check
     * is on the shape of the file rather than on its values.
     */
    function layerRangesOf(css: string): Array<[number, number]> {
        const ranges: Array<[number, number]> = [];
        for (const match of css.matchAll(/@layer\s+[\w\s,]*\{/g)) {
            const open = (match.index ?? 0) + match[0].length;
            let depth = 1;
            let i = open;
            while (i < css.length && depth > 0) {
                if (css[i] === '{') depth += 1;
                else if (css[i] === '}') depth -= 1;
                i += 1;
            }
            ranges.push([match.index ?? 0, i]);
        }
        return ranges;
    }

    test.each(['.light', '.dark'])('the %s token block is not inside @layer', (selector) => {
        const at = extCss.indexOf(`${selector} {`);
        expect(at, `${selector} block not found at all`).toBeGreaterThan(-1);

        const inside = layerRangesOf(extCss).some(([start, end]) => at > start && at < end);
        expect(
            inside,
            `${selector} sits inside an @layer. Tailwind drops layered rules whose selector is ` +
                'absent from the content glob, so this block will not be emitted.',
        ).toBe(false);
    });

    test('the panel follows the browser when nothing sets a class', () => {
        // The web app drives the theme from a next-themes class in
        // localStorage, which a panel in another origin cannot read. Without
        // this the panel is permanently light beside a dark browser.
        expect(extCss).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
        // …and an explicit light choice still wins over the OS.
        expect(extCss).toContain(':root:not(.light)');
    });
});
