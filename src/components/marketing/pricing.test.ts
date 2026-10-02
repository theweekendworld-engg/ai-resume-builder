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
import { pricingHighlights } from './Pricing';
import { PAYOFFS } from './Features';
import { POLICY_LINKS, START_FREE_HREF } from './links';

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
 * Every component rendered on the marketing home page, plus the pieces the
 * public policy pages render. `Pricing.tsx` is back on the page (2026-09-27):
 * prices are public, paid columns say "Opening soon".
 *
 * Keep this list in step with `src/app/(marketing)/page.tsx`. A section that
 * renders to a logged-out visitor and is missing from here is a section that
 * can quietly reintroduce every claim these tests exist to prevent.
 */
const PAGE_SOURCES = [
    'Hero.tsx',
    'ChatDemo.tsx',
    'Channels.tsx',
    'EvidenceTicker.tsx',
    'TheProblem.tsx',
    'HowItWorks.tsx',
    'Guarantees.tsx',
    'Features.tsx',
    'Provenance.tsx',
    'Faq.tsx',
    'Contact.tsx',
    'Pricing.tsx',
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

describe('marketing does not advertise what a new user cannot use (audit 2026-09-27)', () => {
    test('no WhatsApp and no Chrome Web Store until they are live', () => {
        expect(PAGE_SOURCES).not.toMatch(/whatsapp/i);
        expect(PAGE_SOURCES).not.toMatch(/chrome web store|chromewebstore|chrome\.google\.com\/webstore/i);
    });

    test('the false GitHub auto-drafting claims are gone', () => {
        expect(PAGE_SOURCES).not.toMatch(/merged pull requests come back as drafted wins/i);
        expect(PAGE_SOURCES).not.toMatch(/drafted from your own merged pull requests/i);
        expect(PAGE_SOURCES).not.toMatch(/it drafts from your actual work/i);
    });

    test('"pricing by request" is gone now that prices are public', () => {
        expect(PAGE_SOURCES).not.toMatch(/not publishing a price list/i);
        expect(PAGE_SOURCES).not.toMatch(/by request/i);
    });

    test('features that are off for new users are marked coming soon', () => {
        const soon = new Set(PAYOFFS.filter((item) => item.soon).map((item) => item.title));
        for (const title of ['Review and promotion packets', 'Level readiness', 'A weekly ritual that maintains itself']) {
            expect(soon.has(title)).toBe(true);
        }
        // The live ones really are live today.
        expect(soon.has('A resume assembled from evidence')).toBe(false);
    });

    test('pricing highlights label every unlaunched capability', () => {
        const all = Object.values(pricingHighlights()).flat();
        for (const pattern of [/packet/i, /readiness/i, /month in review/i, /autofill/i, /analysed for fit/i]) {
            const item = all.find((entry) => pattern.test(entry.text));
            expect(item?.soon).toBe(true);
        }
        expect(all.some((entry) => /github/i.test(entry.text) && !entry.soon)).toBe(false);
    });

    test('limits in the pricing copy come from the catalog, not literals', () => {
        const src = read('Pricing.tsx');
        expect(src).toContain('meteredLimit');
        expect(src).toContain('freeResumeCap');
        expect(src).not.toMatch(/'\d+ tailored resumes/);
    });

    test('no raw plan-tier identifiers are shown', () => {
        expect(PAGE_SOURCES).not.toMatch(/\balways_on\b|Tier\./);
    });

    test('"Start free" never drops a new user onto the builder', () => {
        expect(PAGE_SOURCES).not.toMatch(/redirect_url=\/build/);
        expect(START_FREE_HREF.startsWith('/sign-up')).toBe(true);
    });

    test('the footer links every policy page a payment review looks for', () => {
        const hrefs: string[] = POLICY_LINKS.map((link) => link.href);
        for (const path of ['/pricing', '/terms', '/privacy', '/refund-policy', '/shipping-policy', '/contact']) {
            expect(hrefs).toContain(path);
        }
        expect(read('Footer.tsx')).toContain('POLICY_LINKS');
    });

    test('there is one support address', () => {
        const legal = ['terms', 'privacy', 'refund-policy', 'shipping-policy', 'contact']
            .map((page) => readFileSync(join(MARKETING_DIR, '..', '..', 'app', '(marketing)', page, 'page.tsx'), 'utf8'))
            .join('\n');
        expect(legal).not.toMatch(/support@patronus\.app/);
        expect(PAGE_SOURCES).not.toMatch(/support@patronus\.app/);
    });
});
