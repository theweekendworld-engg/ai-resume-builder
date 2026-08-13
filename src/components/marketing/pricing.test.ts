/**
 * Marketing pricing must not drift from the plan catalog.
 *
 * The landing page used to hardcode its own perk list and never showed a
 * price, while `src/lib/plans.ts` held the real packaging. Two sources of
 * truth for what something costs is the kind of bug that reaches a customer
 * as a support ticket, so these tests fail if the page starts retyping
 * numbers instead of reading them.
 *
 * The second group is the more important one: it asserts that marketing does
 * not advertise capabilities we have not built. `PLAN_COMPARISON` — the
 * authenticated change-plan surface — currently lists Career Radar, which has
 * no implementation. That is a separate problem, but it must not leak onto the
 * page a logged-out visitor reads while deciding whether to trust us.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAREER_PLAN, FREE_PLAN, SEARCH_PLAN } from '@/lib/plans';

const MARKETING_DIR = import.meta.dir;

/**
 * Read a component with its comments removed.
 *
 * The scans below look for CLAIMS SHOWN TO A USER. A doc comment that explains
 * why the old "apply in minutes" positioning was dropped is the opposite of a
 * regression, and matching it would punish exactly the comment that documents
 * the decision — so comments are stripped before matching.
 */
function read(file: string): string {
    return readFileSync(join(MARKETING_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every component rendered on the marketing home page.
 *
 * `Pricing.tsx` is deliberately NOT in this list any more. It is no longer on
 * the page — the Stripe Prices behind Career and Search do not exist yet, so
 * `<Contact />` stands in its place until they do. The component and the
 * catalog tests below survive because it is coming back; scanning it for
 * unearned claims when nobody can read it would be scanning dead code.
 *
 * Keep this list in step with `src/app/(marketing)/page.tsx`. A section that
 * renders to a logged-out visitor and is missing from here is a section that
 * can quietly reintroduce every claim these tests exist to prevent.
 */
const PAGE_SOURCES = [
    'Hero.tsx',
    'EvidenceTicker.tsx',
    'TheProblem.tsx',
    'HowItWorks.tsx',
    'Guarantees.tsx',
    'Features.tsx',
    'Provenance.tsx',
    'Faq.tsx',
    'Contact.tsx',
    'ClosingCta.tsx',
    'Navbar.tsx',
    'Footer.tsx',
].map(read).join('\n');

describe('prices come from the catalog, not from retyped strings', () => {
    test('Pricing imports the catalog', () => {
        const src = read('Pricing.tsx');
        expect(src).toContain("from '@/lib/plans'");
        expect(src).toMatch(/CAREER_PLAN|PLAN_CATALOG/);
    });

    test('no price literal is hardcoded anywhere on the page', () => {
        // A dollar amount written by hand is exactly the drift this prevents.
        // Catalog labels like "$99/year" must arrive via `plan.prices`.
        const literals = PAGE_SOURCES.match(/\$\d+(?:\.\d+)?\s*\/\s*(?:year|month|mo|yr)/gi) ?? [];
        expect(literals).toEqual([]);
    });

    test('the catalog still has the prices the page relies on', () => {
        // If someone removes a price, the page silently loses a column's
        // headline — better to fail here.
        expect(CAREER_PLAN.prices.length).toBeGreaterThan(0);
        expect(SEARCH_PLAN.prices.length).toBeGreaterThan(0);
        expect(FREE_PLAN.prices).toEqual([]);
    });

    test('Career has a recommended price, which the page renders as the headline', () => {
        expect(CAREER_PLAN.prices.some((p) => p.recommended)).toBe(true);
    });
});

describe('marketing claims only what is built', () => {
    test.each([
        ['Career Radar', /career radar/i],
        ['Missions', /\bmissions?\b/i],
        // Capture sources declared in the schema enum but with no adapter.
        ['Linear capture', /\blinear\b/i],
        ['Jira capture', /\bjira\b/i],
        ['Slack capture', /\bslack\b/i],
    ])('does not advertise %s', (_label, pattern) => {
        expect(PAGE_SOURCES).not.toMatch(pattern);
    });

    test('does not invent social proof', () => {
        // No user counts, no star ratings, no logos we have not earned.
        expect(PAGE_SOURCES).not.toMatch(/\d[\d,]*\+?\s*(users|customers|professionals|engineers)\b/i);
        expect(PAGE_SOURCES).not.toMatch(/trusted by/i);
        expect(PAGE_SOURCES).not.toMatch(/\d(?:\.\d)?\s*\/\s*5\s*stars?/i);
    });

    test('the old job-search positioning is gone', () => {
        // Strategy v3 repositioned away from "apply in minutes".
        expect(PAGE_SOURCES).not.toMatch(/apply in minutes/i);
        expect(PAGE_SOURCES).not.toMatch(/land more interviews/i);
    });
});
