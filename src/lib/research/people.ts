/**
 * Recruiters and hiring managers at a company, from public search results
 * (docs/prd/12-job-watch.md §6, docs/impl/06-scout-agent.md §4).
 *
 * No model. A person is only ever a search result the run actually fetched:
 * a public `linkedin.com/in/…` profile whose own page TITLE names them, their
 * headline and the company. Code reads the title; nothing is inferred.
 *
 *   "Priya Rao - Technical Recruiter - Stripe | LinkedIn"     accepted
 *   "Priya Rao – Senior Recruiter at Stripe | LinkedIn"       accepted
 *   "Priya Rao - Recruiter - Razorpay | LinkedIn" (+ "ex-Stripe" in the
 *    snippet)                                                  rejected
 *
 * The title is LinkedIn's rendering of the CURRENT position, which is why the
 * company must be there and not merely in the snippet: a snippet mentioning
 * Stripe is as often a former employer as the present one. Every accepted
 * person carries the page as its citation and the date it was read, because
 * people move and a profile indexed in March may be stale by October.
 *
 * Cached per company, role family and team for 14 days, shared across users:
 * the key is public facts only, never anything about who asked.
 */

import type { StepContext } from '@/lib/agent/run';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';
import { classifyFamily } from '@/lib/radar/role';
import { readResearch, researchKey, writeResearch, type CachedPage } from '@/lib/research/cache';
import { runSearch } from '@/lib/research/search';
import type { SearchResult } from '@/lib/research/types';

export type FoundPerson = {
    fullName: string;
    /** The headline from the profile title, e.g. "Senior Technical Recruiter". */
    headline: string;
    profileUrl: string;
    /** Who they are for this role. */
    role: 'recruiter' | 'hiring_manager';
    /** The page title as the search returned it: the citation. */
    sourceTitle: string;
    /** ISO date the page was read. */
    foundAt: string;
};

const MAX_PER_ROLE = 3;
const RECRUITER = /\b(?:recruit\w*|talent acquisition|talent partner|sourcer|hiring partner|people partner)\b/i;
const MANAGER = /\b(?:engineering manager|manager|head of|director|vp|vice president|lead)\b/i;

/** `linkedin.com/in/<slug>` on any LinkedIn subdomain, nothing else. */
export function isProfileUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+\/?$/i.test(url.pathname);
    } catch {
        return false;
    }
}

/** A plausible human name: 2–5 words of letters, no digits, no "LinkedIn". */
function plausibleName(value: string): boolean {
    const words = value.trim().split(/\s+/);
    return words.length >= 2 && words.length <= 5 && value.length <= 60 && !/\d|linkedin|jobs|hiring/i.test(value)
        && words.every((word) => /^[\p{L}][\p{L}.'’-]*$/u.test(word));
}

/** Does this segment of a title name the company? "Stripe", "Stripe, Inc.", "at Stripe". */
function namesCompany(segment: string, companyKey: string): boolean {
    // Exact: "Zeta Global" is not Zeta, and a subsidiary is a different team
    // to ask about a job at the parent.
    return canonicalCompanyKey(segment.replace(/^.*\bat\s+/i, '')) === companyKey;
}

/**
 * Read one search result into a person, or null. Pure; exported for tests.
 * `role` is decided by the headline, never by which query found the page.
 */
export function personFromResult(result: Pick<SearchResult, 'url' | 'title'>, company: string, foundAt: string): FoundPerson | null {
    if (!isProfileUrl(result.url)) return null;
    const companyKey = canonicalCompanyKey(company);
    if (!companyKey) return null;
    const title = result.title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
    const parts = title.split(/\s+[-–—|]\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const [rawName, ...rest] = parts;
    // "Priya Rao, PHR" — credentials after a comma are not part of the name.
    const name = rawName.split(',')[0].trim();
    if (!plausibleName(name)) return null;

    // The company must be named in the title itself: the last segment
    // ("… - Stripe") or the headline ("Recruiter at Stripe").
    const last = rest[rest.length - 1];
    const headlineParts = namesCompany(last, companyKey) && rest.length > 1 ? rest.slice(0, -1) : rest;
    const atCompany = namesCompany(last, companyKey) || rest.some((part) => /\bat\s+/i.test(part) && namesCompany(part, companyKey));
    if (!atCompany) return null;

    const headline = headlineParts.join(' - ').replace(/\s+at\s+.*$/i, '').trim();
    const role = RECRUITER.test(headline) ? 'recruiter' : MANAGER.test(headline) ? 'hiring_manager' : null;
    if (!role) return null;
    return { fullName: name, headline: headline || (role === 'recruiter' ? 'Recruiter' : 'Manager'), profileUrl: result.url, role, sourceTitle: result.title, foundAt };
}

/** Manager titles worth searching for, by the role's family. */
function managerQuery(role: string): string {
    switch (classifyFamily(role)) {
        case 'software_engineering':
        case 'data_ml':
            return '"engineering manager" OR "head of engineering" OR "director of engineering"';
        case 'product':
            return '"head of product" OR "director of product" OR "group product manager"';
        case 'design':
            return '"design manager" OR "head of design"';
        default:
            return '"hiring manager" OR "head of" OR director';
    }
}

/** Words of the role and team that make one manager more relevant than another. */
function relevanceTerms(role: string, team: string | null): string[] {
    return `${role} ${team ?? ''}`.toLowerCase().split(/[^a-z]+/)
        .filter((term) => term.length >= 4 && !['senior', 'staff', 'principal', 'engineer', 'manager', 'lead'].includes(term));
}

export type PeopleSearchStep = Pick<StepContext, 'sources' | 'signal' | 'addCost' | 'log'> & Partial<Pick<StepContext, 'userId' | 'runId'>>;

/**
 * Recruiters and hiring managers at `company` for `role`, from public
 * profiles. Empty when research is off or nothing verifiable came back;
 * never throws (people are an addition to the section, never its failure).
 */
export async function findPeopleOnWeb(params: {
    step: PeopleSearchStep;
    company: string;
    role: string;
    /** The posting's department or team, e.g. "Payments". */
    team?: string | null;
    now?: Date;
}): Promise<FoundPerson[]> {
    const { step, company, role } = params;
    const team = params.team?.trim() || null;
    const key = researchKey('people', company, classifyFamily(role), team);
    try {
        const cached = await readResearch<{ people: FoundPerson[] }>(step, key);
        if (cached) return cached.payload?.people ?? [];
    } catch {
        // A cache outage degrades to a search.
    }

    const foundAt = (params.now ?? new Date()).toISOString().slice(0, 10);
    const searches = [
        `"${company}" (recruiter OR "talent acquisition") site:linkedin.com/in`,
        `"${company}" (${managerQuery(role)})${team ? ` "${team}"` : ''} site:linkedin.com/in`,
    ];
    const results: SearchResult[] = [];
    for (const query of searches) {
        try {
            const outcome = await runSearch(step, { query, includeDomains: ['linkedin.com'], maxResults: 10, depth: 'basic' });
            if (outcome.kind === 'ok') results.push(...outcome.results);
            else if (outcome.kind === 'not_configured') return [];
        } catch (error) {
            step.log('people search failed', { error: String(error) });
        }
    }

    const seen = new Set<string>();
    const people: FoundPerson[] = [];
    for (const result of results) {
        const person = personFromResult(result, company, foundAt);
        if (!person) continue;
        const id = person.profileUrl.toLowerCase().replace(/\/$/, '');
        if (seen.has(id)) continue;
        seen.add(id);
        people.push(person);
    }
    const terms = relevanceTerms(role, team);
    const relevance = (person: FoundPerson) => terms.filter((term) => person.headline.toLowerCase().includes(term)).length;
    const pick = (kind: FoundPerson['role']) => people
        .filter((person) => person.role === kind)
        .sort((a, b) => relevance(b) - relevance(a))
        .slice(0, MAX_PER_ROLE);
    const chosen = [...pick('recruiter'), ...pick('hiring_manager')];

    const pages: CachedPage[] = results
        .filter((result) => chosen.some((person) => person.profileUrl === result.url))
        .map((result) => ({ url: result.url, title: result.title, text: result.content, publishedAt: result.publishedDate }));
    await writeResearch({ key, kind: 'people', value: { people: chosen }, pages, empty: chosen.length === 0, step });
    return chosen;
}
