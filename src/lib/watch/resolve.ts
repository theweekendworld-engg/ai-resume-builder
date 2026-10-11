/**
 * Company name → the public job board that company publishes (PRD 12 §3).
 *
 * `radar/discovery.ts` refuses to guess a board token from a name, and for
 * Radar that is right: a guessed token nobody asked for is a source that 404s
 * five times and retires. The job watch is different in one way that matters:
 * a person named this company and is looking at the answer. So we probe, but
 * we only accept what we can verify, and we show the user what we found.
 *
 * What counts as verified, per provider:
 *
 *   Greenhouse       the board's own `name` must be the company's name
 *   SmartRecruiters  a posting's `company.name` must be the company's name,
 *                    and the board must list something (it answers 200 with
 *                    an empty list for ANY name)
 *   Ashby, Lever     no name in the response, so only the exact slug of the
 *                    whole name is tried — never a shortened guess
 *
 * A careers link the user pastes beats all of this: `boardFromUrl` reads the
 * token out of it, and one fetch confirms the board answers.
 */

import { prisma } from '@/lib/prisma';
import { BOT_USER_AGENT, adapterFor, type BoardProvider } from '@/lib/radar/boards';
import { boardFromUrl, registerBoard, type DiscoveredBoard } from '@/lib/radar/discovery';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';

const PROBE_TIMEOUT_MS = 6_000;

/**
 * Words a company's slug usually drops: "Zeta Technologies" → zeta. Only
 * words that never tell two companies apart: "Global", "Group", "Capital"
 * and the like stay, because "Zeta Global" is not Zeta.
 */
const GENERIC_TAIL = /\b(?:technologies|technology|labs|software|solutions|india|pvt|private|hq)\b/g;

export type SlugCandidates = {
    /** The whole name, joined and hyphenated. Safe for every provider. */
    exact: string[];
    /** With generic tail words dropped. Only for providers that echo a name back. */
    loose: string[];
};

export function slugCandidates(companyName: string): SlugCandidates {
    const key = canonicalCompanyKey(companyName).replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key) return { exact: [], loose: [] };
    const forms = (value: string) => {
        const words = value.split(' ').filter(Boolean);
        return words.length ? [words.join(''), words.join('-')] : [];
    };
    const exact = [...new Set(forms(key))];
    const stripped = key.replace(GENERIC_TAIL, ' ').replace(/\s+/g, ' ').trim();
    const loose = [...new Set(forms(stripped))].filter((slug) => slug.length >= 3 && !exact.includes(slug));
    return { exact, loose };
}

/**
 * Does a name a provider returned mean the company the user typed?
 * "Groww" ≈ "Groww", "SWIGGY" ≈ "Swiggy", "Stripe" ≈ "Stripe, Inc.".
 * Deliberately not fuzzy: "Zeta" must not verify "Zeta Global".
 */
export function sameCompanyName(returned: string, typed: string): boolean {
    const strip = (value: string) => canonicalCompanyKey(value).replace(GENERIC_TAIL, ' ').replace(/[^a-z0-9]/g, '');
    const a = strip(returned);
    const b = strip(typed);
    return Boolean(a) && a === b;
}

export type ProbeHit = DiscoveredBoard & {
    /** Open postings the probe saw, when the endpoint says. */
    openCount: number | null;
    /** The name the provider returned, when it returns one. */
    providerName: string | null;
};

type Fetch = typeof fetch;

async function getJson(url: string, fetchImpl: Fetch): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': BOT_USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
        if (!res.ok) return { status: res.status, body: null };
        return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
        return { status: 0, body: null };
    } finally {
        clearTimeout(timer);
    }
}

async function probeGreenhouse(slug: string, typed: string, fetchImpl: Fetch): Promise<ProbeHit | null> {
    const { body } = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, fetchImpl);
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !sameCompanyName(name, typed)) return null;
    return { provider: 'greenhouse', boardToken: slug, openCount: null, providerName: name };
}

async function probeSmartRecruiters(slug: string, typed: string, fetchImpl: Fetch): Promise<ProbeHit | null> {
    const { body } = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`, fetchImpl);
    const parsed = body as { totalFound?: number; content?: Array<{ company?: { name?: string } }> } | null;
    const name = parsed?.content?.[0]?.company?.name;
    if (!parsed?.totalFound || typeof name !== 'string' || !sameCompanyName(name, typed)) return null;
    return { provider: 'smartrecruiters', boardToken: slug, openCount: parsed.totalFound, providerName: name };
}

async function probeAshby(slug: string, fetchImpl: Fetch): Promise<ProbeHit | null> {
    const { body } = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, fetchImpl);
    const jobs = (body as { jobs?: unknown[] } | null)?.jobs;
    if (!Array.isArray(jobs)) return null;
    return { provider: 'ashby', boardToken: slug, openCount: jobs.length, providerName: null };
}

async function probeLever(slug: string, fetchImpl: Fetch): Promise<ProbeHit | null> {
    const { body } = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, fetchImpl);
    if (!Array.isArray(body)) return null;
    return { provider: 'lever', boardToken: slug, openCount: body.length, providerName: null };
}

/** Name-verified providers first: a hit there is the strongest evidence. */
const PROVIDER_RANK: Record<BoardProvider, number> = { greenhouse: 0, smartrecruiters: 1, ashby: 2, lever: 3 };

/**
 * Probe every provider for a company name and pick the best verified hit.
 * Among hits, a board with open roles beats an empty one, then provider rank.
 */
export async function probeCompany(companyName: string, fetchImpl: Fetch = fetch): Promise<ProbeHit | null> {
    const { exact, loose } = slugCandidates(companyName);
    if (exact.length === 0) return null;
    const verifiedSlugs = [...exact, ...loose];

    const probes: Array<Promise<ProbeHit | null>> = [
        ...verifiedSlugs.map((slug) => probeGreenhouse(slug, companyName, fetchImpl)),
        ...verifiedSlugs.map((slug) => probeSmartRecruiters(slug, companyName, fetchImpl)),
        ...exact.map((slug) => probeAshby(slug, fetchImpl)),
        ...exact.map((slug) => probeLever(slug, fetchImpl)),
    ];
    const hits = (await Promise.all(probes)).filter((hit): hit is ProbeHit => hit !== null);
    if (hits.length === 0) return null;
    hits.sort((a, b) => {
        const aOpen = (a.openCount ?? 1) > 0 ? 0 : 1;
        const bOpen = (b.openCount ?? 1) > 0 ? 0 : 1;
        return aOpen - bOpen || PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider];
    });
    return hits[0];
}

/**
 * `registerBoard` never touches an existing row. But a board we retired after
 * five 404s that has just answered a live probe is back, and leaving it
 * retired would watch nothing.
 */
async function reviveIfRetired(sourceId: string): Promise<void> {
    await prisma.jobSource.updateMany({
        where: { id: sourceId, status: 'inactive' },
        data: { status: 'active', notFoundStreak: 0, lastError: null },
    });
}

export type Resolution =
    | { kind: 'resolved'; sourceId: string; board: DiscoveredBoard; via: 'known' | 'url' | 'probe' }
    | { kind: 'not_found'; reason: string };

/**
 * Find (or register) the board for a company the user wants to watch.
 *
 * Order: a careers link they pasted, then a board we already poll under that
 * company's name, then a probe. Never throws; network trouble is `not_found`
 * with a reason, and the user can retry or paste a link.
 */
export async function resolveCompanyBoard(params: {
    companyName: string;
    careersUrl?: string | null;
    userId: string;
    fetchImpl?: Fetch;
}): Promise<Resolution> {
    const fetchImpl = params.fetchImpl ?? fetch;
    const name = params.companyName.trim();

    if (params.careersUrl) {
        const board = boardFromUrl(params.careersUrl);
        if (!board) {
            return { kind: 'not_found', reason: 'That link is not a Greenhouse, Lever, Ashby or SmartRecruiters job page, so it cannot be watched.' };
        }
        const adapter = adapterFor(board.provider);
        const outcome = adapter ? await adapter.fetchBoard({ boardToken: board.boardToken, fetchImpl }) : null;
        if (!outcome || (outcome.kind !== 'ok' && outcome.kind !== 'not_modified')) {
            return { kind: 'not_found', reason: 'That job board did not answer. Check the link and try again.' };
        }
        const { id } = await registerBoard({ board, companyName: name, discoveredVia: 'watchlist', discoveredByUserId: params.userId });
        await reviveIfRetired(id);
        return { kind: 'resolved', sourceId: id, board, via: 'url' };
    }

    const key = canonicalCompanyKey(name);
    if (!key) return { kind: 'not_found', reason: 'Type the company name as it appears on its careers page.' };

    // A board we already poll, under this company's name. Retired boards are
    // skipped: five 404s is a better signal than a name match.
    const known = await prisma.jobSource.findMany({
        where: { companyName: { contains: key.split(' ')[0], mode: 'insensitive' }, status: { not: 'inactive' } },
        select: { id: true, provider: true, boardToken: true, companyName: true },
        take: 50,
    });
    const exact = known.find((source) => canonicalCompanyKey(source.companyName) === key && adapterFor(source.provider));
    if (exact) {
        return { kind: 'resolved', sourceId: exact.id, board: { provider: exact.provider as BoardProvider, boardToken: exact.boardToken }, via: 'known' };
    }

    const hit = await probeCompany(name, fetchImpl);
    if (!hit) {
        return {
            kind: 'not_found',
            reason: `No public Greenhouse, Lever, Ashby or SmartRecruiters board answered for "${name}". Paste a link to one of their job postings and it will be watched from that.`,
        };
    }
    const { id } = await registerBoard({
        board: { provider: hit.provider, boardToken: hit.boardToken },
        companyName: name,
        discoveredVia: 'watchlist',
        discoveredByUserId: params.userId,
    });
    await reviveIfRetired(id);
    return { kind: 'resolved', sourceId: id, board: { provider: hit.provider, boardToken: hit.boardToken }, via: 'probe' };
}
