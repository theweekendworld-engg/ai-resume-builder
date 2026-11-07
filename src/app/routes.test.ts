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

import { isActive, NAV_ROUTES, SETTINGS_ROUTE } from '@/components/app/navRoutes';

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

/**
 * The sidebar's labels as URLs (e2e QA 2026-11-07, finding 8): /jobs, /goals
 * and /resumes redirect to the real routes, which keep their names because
 * Telegram messages and deep links point at them. Read from `next.config.ts`
 * as text, the same way the links above are read, so the config is never
 * executed by a test.
 */
describe('route aliases in next.config.ts', () => {
    const routes = realRoutes();
    const config = readFileSync(join(SRC_DIR, '..', 'next.config.ts'), 'utf8');
    const aliases = [...config.matchAll(/\{\s*source:\s*'([^']+)',\s*destination:\s*'([^']+)'\s*\}/g)].map(
        ([, source, destination]) => ({ source, destination }),
    );

    test('the sidebar names resolve', () => {
        expect(aliases).toEqual(
            expect.arrayContaining([
                { source: '/jobs', destination: '/scout' },
                { source: '/goals', destination: '/home' },
                { source: '/resumes', destination: '/dashboard' },
            ]),
        );
        expect(config).toMatch(/redirects\(\)[\s\S]*permanent: true/);
    });

    test.each([
        ['/jobs'],
        ['/goals'],
        ['/resumes'],
    ])('%s is an alias, not a page', (source) => {
        // An alias that shadows a real page would make the page unreachable.
        expect(routes.some((r) => matches(source, r))).toBe(false);
    });

    test('every alias lands on a real page', () => {
        expect(aliases.length).toBeGreaterThan(0);
        for (const { destination } of aliases) {
            expect(routes.some((r) => matches(destination, r)), destination).toBe(true);
        }
    });
});

/**
 * The sidebar's active state matches the route, never the label, and exactly
 * one destination is lit on every page a destination owns.
 */
describe('sidebar destinations', () => {
    const routes = realRoutes();
    const all = [...Object.values(NAV_ROUTES), SETTINGS_ROUTE];

    test.each(all.map((d) => [d.label, d.href]))('%s (%s) is a real page', (_label, href) => {
        expect(routes.some((r) => matches(href, r))).toBe(true);
    });

    test.each([
        ['/overview', 'Home'],
        ['/home', 'Goals'],
        ['/scout', 'Jobs'],
        ['/scout/run_123', 'Jobs'],
        ['/watch', 'Job watch'],
        ['/dashboard', 'Resumes'],
        ['/editor/abc', 'Resumes'],
        ['/build', 'Resumes'],
        ['/log/review/2026-10', 'Work Log'],
        ['/packets/new', 'Packets'],
        ['/settings/email', 'Settings'],
        ['/account/security', 'Settings'],
        ['/chat', 'Chat'],
    ])('%s lights %s and nothing else', (pathname, label) => {
        const lit = all.filter((d) => isActive(pathname, d.href)).map((d) => d.label);
        expect(lit).toEqual([label]);
    });

    test('a prefix that is not a path segment does not light a destination', () => {
        // `/homework` is not Goals, `/scouting` is not Jobs.
        expect(isActive('/homework', NAV_ROUTES.home.href)).toBe(false);
        expect(isActive('/scouting', NAV_ROUTES.scout.href)).toBe(false);
    });

    test('each label URL redirects to the destination with that label', () => {
        const config = readFileSync(join(SRC_DIR, '..', 'next.config.ts'), 'utf8');
        const aliases = [...config.matchAll(/\{\s*source:\s*'([^']+)',\s*destination:\s*'([^']+)'\s*\}/g)];
        for (const [, source, destination] of aliases) {
            const target = Object.values(NAV_ROUTES).find((d) => d.href === destination);
            // /jobs → the destination labelled "Jobs", and so on.
            expect(target?.label.toLowerCase()).toBe(source.slice(1));
        }
    });
});
