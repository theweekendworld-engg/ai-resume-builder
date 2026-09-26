/**
 * Compensation from public sources.
 *
 * Two kinds of number, never blended:
 *
 *   - QUOTED figures from levels.fyi, AmbitionBox, Glassdoor, 6figr, Blind and
 *     Reddit. Each is the string the page printed ("₹38L – ₹52L", "$212K"),
 *     with the page it came from. No averaging, no currency conversion, no
 *     "typical" — those would be numbers no source stated, which is exactly
 *     what the no-fabrication invariant forbids.
 *   - The OBSERVED band, from postings Radar ingested, under Radar's own rules:
 *     `MIN_OBSERVATIONS` and a 180-day window, with n, window and geography in
 *     the sentence. Below the floor it is null and the page says so.
 *
 * Cached per (company, family, level, geo) for 14 days, shared across users.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { bandProvenance, computeBand, MIN_OBSERVATIONS, type BandObservation } from '@/lib/radar/band';
import { isBandableSeniority } from '@/lib/radar/role';
import { readResearch, researchKey, writeResearch } from '@/lib/research/cache';
import { pageText, reasonForOutcome, runSearch, type RunSearchOutcome } from '@/lib/research/search';
import { cityOf, researchTarget, type ResearchTarget } from '@/lib/research/target';
import type { SearchResult } from '@/lib/research/types';
import {
    dedupeResults,
    mentionsCompany,
    numberedResults,
    numbersSupported,
    pagesAsResults,
    quotedIn,
    resolvePick,
    toCachedPage,
} from '@/lib/research/verify';
import type { ScoutSection } from '@/lib/scout/section';
import type { CompData, CompFigure } from '@/lib/scout/types';

export const COMP_CAVEAT =
    'Self-reported and aggregated figures from public sites, quoted as each site states them. They are not offers, and sites disagree; treat them as a range to ask about, not a number to expect.';

/** Radar's window (CLAUDE.md "Career Radar": 180 days). */
export const BAND_WINDOW_DAYS = 180;

const SALARY_DOMAINS = [
    'levels.fyi',
    'ambitionbox.com',
    'glassdoor.com',
    'glassdoor.co.in',
    '6figr.com',
    'teamblind.com',
];

const MAX_FIGURES = 8;

/**
 * Bump when verification gets stricter: cached figures were checked under the
 * old rules and must not survive the change. v2 (2026-09-25) added the salary-
 * page filter and the context quote after live runs shipped a Glassdoor
 * jobs-listing estimate ("₹6L - ₹8L") as the pay for a 5-years backend role.
 */
const VERIFY_VERSION = 'v2';

/**
 * Is this a page whose figures describe PAY FOR A ROLE, rather than something
 * that merely prints a number near a job title?
 *
 * Glassdoor's jobs-listing pages carry an "estimated salary" per LISTING, for
 * whatever listing happens to be first. Those are the numbers that looked
 * plausible, cited a real page, passed the numeric guard, and were wrong. The
 * guard proves a number is on the page; only the page's KIND says what it is.
 */
export function isSalaryPage(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    if (host.startsWith('glassdoor.')) return /\/salar(y|ies)\//.test(path) || /-salaries-/.test(path);
    if (host === 'ambitionbox.com') return path.includes('/salaries/') || path.includes('-salaries');
    if (host === 'levels.fyi') return path.includes('/salaries') || path.startsWith('/t/') || path.includes('/companies/');
    if (host === '6figr.com') return path.includes('salary') || path.includes('/company/');
    // One person's number, labelled as such: the thread IS the context.
    if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'teamblind.com') return true;
    return false;
}

const PAY_WORD = /\b(salary|salaries|pay|paid|compensation|comp|ctc|lpa|tc|base|package|stipend|per (year|annum|month)|\/yr|a year|offer)\b/i;
const ROLE_WORD = /\b(engineer|engineering|developer|sde|swe|programmer|architect|l[3-8]|e[3-7]|ic[1-6]|staff|principal|senior|sr\.?|junior|jr\.?|lead)\b/i;
/** Level tokens that, if a label claims them, its quote must contain. */
const LEVEL_TOKENS = /\b(i{1,3}|iv|[1-4]|l[3-8]|e[3-7]|ic[1-6]|senior|sr|staff|principal|junior|jr|lead)\b/gi;

/**
 * The quote around a figure must tie the number to a role: on the page, with
 * the value inside it, a pay word and a role word nearby. And every level the
 * LABEL claims must be in the quote — a label saying "SDE II" over a quote that
 * says "Software Engineer" is the model upgrading the evidence.
 */
export function contextSupports(figure: { value: string; label: string; context: string }, page: string): boolean {
    const context = figure.context.trim();
    if (context.length < 12 || context.length > 400) return false;
    if (!quotedIn(context, page)) return false;
    if (!quotedIn(figure.value, context)) return false;
    if (!PAY_WORD.test(context) || !ROLE_WORD.test(context)) return false;
    const claimed = figure.label.match(LEVEL_TOKENS) ?? [];
    const contextLower = context.toLowerCase();
    return claimed.every((token) => new RegExp(`\\b${token.toLowerCase().replace('.', '\\.')}\\b`).test(contextLower));
}

// ─────────────────────────────────────────────────────── observed band

export type ObservedBandLoader = (target: ResearchTarget) => Promise<CompData['observedBand']>;

function formatAmount(amount: number, currency: string): string {
    return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

/** Radar's band for this cell, or null below the honesty floor. */
export const loadObservedBand: ObservedBandLoader = async (target) => {
    if (target.family === 'unknown' || !isBandableSeniority(target.seniority) || !target.geoBucket) return null;
    const since = new Date(Date.now() - BAND_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.jobPosting.findMany({
        where: {
            roleFamily: target.family,
            seniority: target.seniority,
            geoBucket: target.geoBucket,
            compBandEligible: true,
            postedAt: { gte: since },
        },
        select: { compAnnualLow: true, compAnnualHigh: true, compCurrency: true, postedAt: true },
        take: 2_000,
    });
    const observations: BandObservation[] = rows.flatMap((row) =>
        row.compAnnualLow !== null && row.compAnnualHigh !== null && row.compCurrency
            ? [{ annualLow: row.compAnnualLow, annualHigh: row.compAnnualHigh, currency: row.compCurrency, postedAt: row.postedAt ?? new Date() }]
            : [],
    );
    if (observations.length < MIN_OBSERVATIONS) return null;
    const result = computeBand(observations);
    if (!result.ok) return null;
    const band = result.band;
    return {
        n: band.n,
        statement: `${formatAmount(band.low, band.currency)}–${formatAmount(band.high, band.currency)} a year, median ${formatAmount(band.median, band.currency)}, for ${target.seniority.replace('_', ' ')} ${target.family.replace('_', ' ')} roles in ${target.geoBucket}. ${bandProvenance(band)} Published ranges from employers' postings, across companies.`,
    };
};

let bandLoader: ObservedBandLoader = loadObservedBand;

export const __testing = {
    setBandLoader(next: ObservedBandLoader | null) {
        bandLoader = next ?? loadObservedBand;
    },
};

// ─────────────────────────────────────────────────────────── extraction

const ExtractSchema = z.object({
    figures: z.array(z.object({
        resultIndex: z.number().int(),
        /** What the figure is: role, level, component, place. */
        label: z.string().min(1).max(100),
        /** Copied exactly as printed. */
        value: z.string().min(1).max(80),
        /** The sentence or table row around the value, copied exactly. */
        context: z.string().min(1).max(400),
    })).max(12),
});

const SYSTEM = `You extract salary figures from numbered web search results.

Rules:
- Only figures for the named company. Prefer the named role and level; include adjacent levels only if labelled clearly (e.g. "SDE I", "SDE III").
- Each figure cites ONE result by number and copies the value EXACTLY as printed ("₹38L - ₹52L", "$212K", "45 LPA"). Never convert currencies, compute averages, annualise, or combine figures.
- label says what it is: role/level, component (base, total compensation, stock, bonus), and place if stated. e.g. "SDE II total compensation, Bengaluru".
- A Reddit or Blind figure is one person's number: label it "reported offer" or "reported pay".
- context: copy EXACTLY the sentence or table row that contains the value and names the role or level it is for. If the page does not tie the number to a role, skip the figure.
- Skip salary estimates attached to individual job listings: they describe that listing, not the role.
- Never put a level in the label (II, Senior, L5) that the context does not state.
- If nothing is stated plainly, return an empty list.`;

export function verifyFigures(
    company: string,
    results: readonly SearchResult[],
    extracted: z.infer<typeof ExtractSchema>,
    fetchedAt: string,
): { figures: CompFigure[]; dropped: number; pagesUsed: SearchResult[] } {
    const figures: CompFigure[] = [];
    const used = new Map<string, SearchResult>();
    let dropped = 0;
    for (const figure of extracted.figures) {
        const result = resolvePick(results, figure.resultIndex);
        if (!result) { dropped += 1; continue; }
        const page = pageText(result);
        const ok = /\d/.test(figure.value)
            && isSalaryPage(result.url)
            && mentionsCompany(`${result.title}\n${page}`, company)
            && quotedIn(figure.value, page)
            && contextSupports(figure, page)
            && numbersSupported([figure.value, figure.label], page);
        if (!ok) { dropped += 1; continue; }
        if (figures.some((existing) => existing.value === figure.value && existing.sourceUrl === result.url)) continue;
        figures.push({
            label: figure.label,
            value: figure.value,
            context: figure.context.trim(),
            sourceUrl: result.url,
            sourceTitle: result.title,
            asOf: result.publishedDate ?? fetchedAt,
        });
        used.set(result.url, result);
        if (figures.length >= MAX_FIGURES) break;
    }
    return { figures, dropped, pagesUsed: [...used.values()] };
}

// ─────────────────────────────────────────────────────────────── section

export const compSection: ScoutSection<'comp'> = async (ctx) => {
    const target = researchTarget(ctx.sections);
    if (!target) return { status: 'unavailable', reason: 'No company is named in this link' };

    const observedBand = await bandLoader(target).catch((error: unknown) => {
        ctx.step.log('observed band failed', { error: String(error) });
        return null;
    });

    const key = researchKey('comp', target.company, target.family, target.seniority, target.geoBucket, VERIFY_VERSION);
    const fetchedAt = new Date().toISOString();
    let figures: CompFigure[] = [];
    let reason: string | null = null;

    const cached = await readResearch<{ figures: CompFigure[] }>(ctx.step, key);
    if (cached) {
        const pages = pagesAsResults(cached.pages);
        figures = (cached.payload?.figures ?? []).filter((figure) => {
            const page = pages.find((result) => result.url === figure.sourceUrl);
            return Boolean(
                page
                && ctx.step.sources.has(figure.sourceUrl)
                && isSalaryPage(figure.sourceUrl)
                && quotedIn(figure.value, pageText(page))
                && figure.context
                && contextSupports({ value: figure.value, label: figure.label, context: figure.context }, pageText(page)),
            );
        });
    } else {
        const role = target.role ?? 'software engineer';
        const city = cityOf(target.location);
        const outcomes: RunSearchOutcome[] = [];
        outcomes.push(await runSearch(ctx.step, {
            query: `${target.company} ${role} salaries${city ? ` in ${city}` : ''} per level total compensation`,
            includeDomains: SALARY_DOMAINS,
            maxResults: 6,
            includeRawContent: true,
        }));
        if (outcomes[0].kind === 'ok') {
            outcomes.push(await runSearch(ctx.step, {
                query: `${target.company} ${role} offer compensation TC`,
                includeDomains: ['reddit.com', 'teamblind.com'],
                // No date filter: it drops undated forum posts (see interviews.ts).
                maxResults: 5,
                includeRawContent: true,
            }));
        }
        const results = dedupeResults(outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? outcome.results : [])));
        const failure = outcomes.find((outcome) => outcome.kind !== 'ok');

        if (results.length === 0 && failure) {
            reason = reasonForOutcome(failure);
        } else if (results.length > 0) {
            const { data } = await ctx.step.ai({
                task: 'scoutResearchExtract',
                schema: ExtractSchema,
                system: SYSTEM,
                prompt: `Company: ${target.company}\nRole: ${role}${city ? `\nLocation: ${city}` : ''}\n\nResults:\n${numberedResults(results)}`,
            });
            const verified = verifyFigures(target.company, results, data, fetchedAt);
            ctx.step.log('comp figures verified', { kept: verified.figures.length, dropped: verified.dropped });
            figures = verified.figures;
            await writeResearch({
                key,
                kind: 'comp',
                value: { figures },
                pages: verified.pagesUsed.map(toCachedPage),
                empty: figures.length === 0,
                step: ctx.step,
            });
        } else {
            await writeResearch({ key, kind: 'comp', value: { figures: [] }, pages: [], empty: true, step: ctx.step });
        }
    }

    const data: CompData = { figures, observedBand, caveat: COMP_CAVEAT };
    if (reason) {
        return observedBand ? { status: 'unavailable', reason, data } : { status: 'unavailable', reason };
    }
    if (figures.length === 0 && !observedBand) {
        return {
            status: 'unavailable',
            reason: `No public pay figures found for ${target.role ?? 'this role'} at ${target.company}, and fewer than ${MIN_OBSERVATIONS} observed postings to band.`,
            data,
        };
    }
    return { status: 'ok', data };
};
