/**
 * Scout's network section: who to talk to about this role.
 *
 * No model. Everything is a lookup or a constructed URL:
 *
 *   poster       — the person who wrote a hiring post. The warmest possible
 *                  lead: they asked to be contacted.
 *   first_degree — the user's own connections at the company, from their
 *                  LinkedIn export (`Contact`). Recruiters and managers first.
 *   search links — LinkedIn people searches built by code, for what an export
 *                  cannot answer: 2nd-degree reach, alumni of the user's
 *                  schools, and ex-colleagues from their past employers.
 *
 * ── Why "ex-colleague" is a search link, not a contact tier ────────────────
 *
 * The export gives each connection's CURRENT company only. "Worked with you at
 * Flipkart, now at Stripe" needs their history, which the export does not
 * contain and which we will not scrape. A keyword search for both companies is
 * the honest version: LinkedIn matches past experience text, and the user
 * sees real profiles rather than our guess.
 */

import { prisma } from '@/lib/prisma';
import { canonicalCompanyKey, longestNameToken, normalizeCompanyName } from '@/lib/enrichment/companyName';
import { dataOf, type ScoutSection } from '@/lib/scout/section';
import type { NetworkData, NetworkTarget } from '@/lib/scout/types';
import { findPeopleOnWeb, type PeopleSearchStep } from '@/lib/research/people';

const MAX_TARGETS = 8;
/** People found by search, on top of the user's own connections. */
const MAX_FOUND = 4;
const PEOPLE_SEARCH = 'https://www.linkedin.com/search/results/people/';

/** A LinkedIn people-search URL. `network`: F = 1st, S = 2nd, O = 3rd+. */
export function peopleSearchUrl(keywords: string, network?: ('F' | 'S' | 'O')[]): string {
    const params = new URLSearchParams({ keywords: keywords.replace(/\s+/g, ' ').trim(), origin: 'GLOBAL_SEARCH_HEADER' });
    if (network?.length) params.set('network', JSON.stringify(network));
    return `${PEOPLE_SEARCH}?${params.toString()}`;
}

/** Rank inside the first-degree tier: who can actually move an application. */
export function contactRank(position: string | null, roleTerms: readonly string[]): number {
    const p = (position ?? '').toLowerCase();
    if (/\b(?:recruit|talent|sourcer|hiring|people partner|hr\b|human resources)/.test(p)) return 0;
    if (/\b(?:engineering manager|manager|director|head of|vp|vice president|cto|lead)\b/.test(p)) return 1;
    if (roleTerms.some((term) => p.includes(term))) return 2;
    return 3;
}

const RANK_LABEL = ['recruiting', 'can refer or hire', 'same function', 'connection'];

function roleTermsOf(role: string): string[] {
    return role
        .toLowerCase()
        .replace(/[^a-z\s]+/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length >= 4 && !['senior', 'junior', 'staff', 'principal', 'lead', 'with'].includes(term));
}

function monthYear(date: Date | null): string | null {
    if (!date) return null;
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Does a contact's stored company name mean the target company?
 * Exact on the canonical key, or a subsidiary written as the parent plus a
 * suffix ("Amazon Web Services" for "Amazon").
 */
export function sameCompany(contactCompany: string | null, target: string): boolean {
    if (!contactCompany) return false;
    const a = canonicalCompanyKey(contactCompany);
    const b = canonicalCompanyKey(target);
    if (!a || !b) return false;
    return a === b || a.startsWith(`${b} `);
}

export type NetworkRecord = {
    pastCompanies: string[];
    schools: string[];
};

async function loadNetworkRecord(userId: string): Promise<NetworkRecord> {
    const [experiences, education] = await Promise.all([
        prisma.userExperience.findMany({ where: { userId }, select: { company: true } }),
        prisma.userEducation.findMany({ where: { userId }, select: { institution: true } }),
    ]);
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    return {
        pastCompanies: unique(experiences.map((row) => row.company)),
        schools: unique(education.map((row) => row.institution)),
    };
}

export const networkSection: ScoutSection<'network'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    const classify = dataOf(ctx.sections, 'classify');
    const jd = dataOf(ctx.sections, 'jd');

    const company = (jd?.company || classify?.companies[0] || ingest?.companyName || '').trim();
    const role = (jd?.role || classify?.roleTitle || '').trim();
    if (!company) return { status: 'unavailable', reason: 'No company could be identified to look for people at' };

    const data = await findPeople({
        userId: ctx.userId,
        company,
        role,
        domain: jd?.domain ?? null,
        poster: classify?.kind === 'hiring_post' && ingest?.author ? { name: ingest.author, url: ingest.authorUrl } : null,
        web: ctx.step,
    });
    return { status: 'ok', data };
};

/**
 * Who to talk to about a role at a company. Shared by Scout and the job
 * watch's morning message, so both name the same people in the same order.
 */
export async function findPeople(params: {
    userId: string;
    company: string;
    role: string;
    domain?: string | null;
    /** The author of a hiring post, when there is one. */
    poster?: { name: string; url: string | null } | null;
    /** The posting's department or team, which sharpens the manager search. */
    team?: string | null;
    /**
     * Search for recruiters and hiring managers on public profiles. Omitted:
     * the user's own connections and search links only, no web calls.
     */
    web?: PeopleSearchStep | null;
}): Promise<NetworkData> {
    const { company, role } = params;
    const targets: NetworkTarget[] = [];

    // 1. The poster, on hiring posts. They asked to be contacted.
    if (params.poster) {
        targets.push({
            contactId: null,
            fullName: params.poster.name,
            position: null,
            company,
            profileUrl: params.poster.url,
            tier: 'poster',
            why: 'Wrote this hiring post, so a direct message is expected',
        });
    }

    // 2. First-degree connections at the company. SQL prefilter on the most
    //    distinctive token, exact comparison in JS (see `longestNameToken`).
    const [contactCount, record] = await Promise.all([
        prisma.contact.count({ where: { userId: params.userId } }),
        loadNetworkRecord(params.userId),
    ]);
    const token = longestNameToken(normalizeCompanyName(company));
    if (contactCount > 0 && token.length >= 2) {
        const candidates = await prisma.contact.findMany({
            where: { userId: params.userId, normalizedCompany: { contains: token } },
            select: { id: true, fullName: true, position: true, company: true, profileUrl: true, connectedOn: true },
            take: 200,
        });
        const terms = roleTermsOf(role);
        const matches = candidates
            .filter((contact) => sameCompany(contact.company, company))
            .map((contact) => ({ contact, rank: contactRank(contact.position, terms) }))
            .sort((a, b) => a.rank - b.rank || a.contact.fullName.localeCompare(b.contact.fullName));

        for (const { contact, rank } of matches) {
            if (targets.length >= MAX_TARGETS) break;
            const since = monthYear(contact.connectedOn);
            const position = contact.position ? `${contact.position} at ${contact.company}` : `At ${contact.company}`;
            targets.push({
                contactId: contact.id,
                fullName: contact.fullName,
                position: contact.position,
                company: contact.company,
                profileUrl: contact.profileUrl,
                tier: 'first_degree',
                why: `1st-degree · ${position}${since ? ` · connected ${since}` : ''} · ${RANK_LABEL[rank]}`,
            });
        }
    }

    // 3. Recruiters and hiring managers on public profiles, each citing the
    //    page the search returned. Never someone already listed above.
    if (params.web) {
        const found = await findPeopleOnWeb({ step: params.web, company, role, team: params.team ?? null }).catch(() => []);
        const listed = new Set(targets.map((t) => (t.profileUrl ?? '').toLowerCase().replace(/\/$/, '')).filter(Boolean));
        const listedNames = new Set(targets.map((t) => t.fullName.toLowerCase()));
        for (const person of found) {
            if (targets.filter((t) => t.tier === 'found').length >= MAX_FOUND) break;
            if (listed.has(person.profileUrl.toLowerCase().replace(/\/$/, '')) || listedNames.has(person.fullName.toLowerCase())) continue;
            targets.push({
                contactId: null,
                fullName: person.fullName,
                position: person.headline,
                company,
                profileUrl: person.profileUrl,
                tier: 'found',
                role: person.role,
                why: `${person.role === 'recruiter' ? 'Recruits' : 'Could be the hiring manager'} at ${company} · public profile found by search, ${person.foundAt}`,
                citation: { url: person.profileUrl, title: person.sourceTitle, foundAt: person.foundAt },
            });
        }
    }

    // 4. Searches, built by code. Always safe: they are links to LinkedIn,
    //    run in the user's own logged-in session.
    const searchLinks: NetworkData['searchLinks'] = [
        { label: `Recruiters at ${company}`, url: peopleSearchUrl(`${company} recruiter`) },
        {
            label: role ? `Hiring managers for ${role} at ${company}` : `Engineering managers at ${company}`,
            url: peopleSearchUrl(`${company} ${params.domain && params.domain.length < 40 ? `${params.domain} ` : ''}engineering manager`),
        },
        { label: `Your 2nd-degree network at ${company}`, url: peopleSearchUrl(company, ['S']) },
    ];
    for (const school of record.schools.slice(0, 2)) {
        searchLinks.push({ label: `${school} alumni at ${company}`, url: peopleSearchUrl(`${school} ${company}`) });
    }
    for (const past of record.pastCompanies.filter((name) => !sameCompany(name, company)).slice(0, 2)) {
        searchLinks.push({ label: `Ex-${past} people now at ${company}`, url: peopleSearchUrl(`${company} ${past}`) });
    }

    return {
        targets,
        searchLinks,
        hasContactsImported: contactCount > 0,
    };
}
