/**
 * Every hardcoded internal link must point at a route that exists.
 *
 * The "Generate review packet" button — the primary call to action in the work
 * log rail — pushed `/log/packet/new` for its entire life. The route is
 * `/packets/new`. Clicking it produced a 404, and nothing caught that: the
 * component tests assert the handler fires, not where it lands, and a
 * `router.push` with a wrong string is perfectly well-typed.
 *
 * This is a linker, not a unit test. It reads the App Router tree for the set
 * of real routes, extracts every statically-written internal target, and
 * requires each one to resolve. Anything computed at runtime (template
 * literals, variables) is out of scope and deliberately skipped — the point is
 * to catch typos in constants, cheaply, forever.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = join(import.meta.dir);
const SRC_DIR = join(import.meta.dir, '..');

/** Segments that structure the tree without appearing in the URL. */
function isRouteGroup(segment: string): boolean {
    return segment.startsWith('(') && segment.endsWith(')');
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Real routes, as URL patterns: `/packets/[id]`, `/account/[[...rest]]`, … */
function realRoutes(): string[] {
    return walk(APP_DIR)
        .filter((f) => /\/page\.tsx?$/.test(f))
        .map((f) =>
            f
                .slice(APP_DIR.length)
                .replace(/\/page\.tsx?$/, '')
                .split('/')
                .filter((s) => s && !isRouteGroup(s))
                .join('/'),
        )
        .map((p) => `/${p}`.replace(/\/+$/, '') || '/');
}

/**
 * Does `target` match `route`, accounting for dynamic segments?
 *
 * `[id]` consumes exactly one segment; `[...slug]` one or more; `[[...slug]]`
 * zero or more, which is why `/account` matches `/account/[[...rest]]`.
 */
function matches(target: string, route: string): boolean {
    const t = target.split('/').filter(Boolean);
    const r = route.split('/').filter(Boolean);

    let ti = 0;
    for (let ri = 0; ri < r.length; ri++) {
        const seg = r[ri];
        if (seg.startsWith('[[...')) return true; // optional catch-all: rest is free
        if (seg.startsWith('[...')) return ti < t.length; // needs at least one
        if (ti >= t.length) return false;
        if (!seg.startsWith('[') && seg !== t[ti]) return false;
        ti++;
    }
    return ti === t.length;
}

/**
 * The path part of a link. A query string and a fragment are addressed to the
 * page, not the router, so `/sign-up?redirect_url=/build` and `/#pricing`
 * resolve as `/sign-up` and `/`.
 */
function pathOf(target: string): string {
    const path = target.split(/[?#]/)[0];
    return path === '' ? '/' : path.replace(/(.)\/+$/, '$1');
}

/** Statically-written internal targets, with the file that wrote them. */
function internalLinks(): Array<{ target: string; file: string }> {
    const PATTERN =
        /(?:router\.(?:push|replace|prefetch)\(|href=|redirect\(|permanentRedirect\()\s*['"](\/[^'"{}$\\]*)['"]/g;

    const found: Array<{ target: string; file: string }> = [];
    for (const file of walk(SRC_DIR)) {
        if (!/\.(tsx?|jsx?)$/.test(file)) continue;
        if (/\.(test|spec)\.|__mocks__|__journeys__/.test(file)) continue;

        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(PATTERN)) {
            found.push({ target: pathOf(m[1]), file: file.slice(SRC_DIR.length + 1) });
        }
    }
    return found;
}

/**
 * Not pages, so not in the App Router page tree — but still valid targets.
 * `/api/**` are route handlers; the rest are files served from `public/`.
 */
function isNonPageTarget(target: string): boolean {
    return (
        target.startsWith('/api/') ||
        target === '/' ||
        /\.(png|jpe?g|svg|ico|webp|txt|xml|pdf|json|css|js)$/.test(target)
    );
}

describe('internal links resolve to real routes', () => {
    const routes = realRoutes();

    test('the route table itself was discovered', () => {
        // Guards against the walk silently returning nothing and the whole
        // suite passing vacuously.
        expect(routes.length).toBeGreaterThan(10);
        expect(routes).toContain('/packets/new');
        expect(routes).toContain('/log');
    });

    test('no hardcoded link 404s', () => {
        const dead = internalLinks()
            .filter(({ target }) => !isNonPageTarget(target))
            .filter(({ target }) => !routes.some((r) => matches(target, r)))
            // De-duplicate: one typo repeated in three files is one bug.
            .map(({ target, file }) => `${target}  ← ${file}`);

        expect([...new Set(dead)].sort().join('\n')).toBe('');
    });
});

describe('route matching handles Next.js dynamic segments', () => {
    test.each([
        ['/packets/abc', '/packets/[id]', true],
        ['/packets', '/packets/[id]', false],
        ['/packets/a/b', '/packets/[id]', false],
        // Optional catch-all matches the bare parent — the `/account` case.
        ['/account', '/account/[[...rest]]', true],
        ['/account/security', '/account/[[...rest]]', true],
        // Required catch-all does not.
        ['/docs', '/docs/[...slug]', false],
        ['/docs/a/b', '/docs/[...slug]', true],
        ['/log', '/log', true],
        ['/log/packet/new', '/packets/new', false],
    ])('%s vs %s → %p', (target, route, expected) => {
        expect(matches(target, route)).toBe(expected);
    });
});
