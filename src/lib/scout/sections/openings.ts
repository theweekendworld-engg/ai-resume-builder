/**
 * Section: open roles at the companies a post mentions.
 *
 * Reads the boards Radar already ingests (`JobSource` / `JobPosting`). No
 * model and no new fetching: a funding post about a company whose board we do
 * not watch gets a plain note saying so, not a guess. Board discovery from a
 * bare company name is deliberately not attempted — a board token guessed
 * from a name is exactly the "source that can never be fetched" that
 * `radar/discovery.ts` refuses to register.
 *
 * Ranking is by the user's own stated preferences (target roles, target
 * locations), then recency. With no preferences stated, it is recency alone,
 * which is the honest ordering when we know nothing.
 */

import { prisma } from '@/lib/prisma';
import { canonicalCompanyKey, longestNameToken } from '@/lib/enrichment/companyName';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import type { ScoutSection } from '@/lib/scout/section';
import { dataOf } from '@/lib/scout/section';
import type { OpeningsData } from '@/lib/scout/types';

export const MAX_COMPANIES = 3;
export const MAX_OPENINGS_PER_COMPANY = 8;

type PostingRow = { title: string; location: string | null; absoluteUrl: string; postedAt: Date | null };

function tokens(value: string): string[] {
    return value.toLowerCase().split(/[^a-z0-9+#]+/).filter((token) => token.length >= 2);
}

/**
 * Score a posting against preferences. Pure, exported for tests.
 * A title sharing most of a target role's words scores high; a location
 * containing a target location scores lower (location is a filter people
 * relax more readily than role).
 */
export function scorePosting(
    posting: Pick<PostingRow, 'title' | 'location' | 'postedAt'>,
    prefs: { targetRoles: string[]; targetLocations: string[] },
    now: Date = new Date(),
): number {
    let score = 0;
    const titleTokens = new Set(tokens(posting.title));
    for (const role of prefs.targetRoles) {
        const roleTokens = tokens(role);
        if (roleTokens.length === 0) continue;
        const overlap = roleTokens.filter((token) => titleTokens.has(token)).length / roleTokens.length;
        score = Math.max(score, overlap * 10);
    }
    const location = (posting.location ?? '').toLowerCase();
    if (prefs.targetLocations.some((target) => {
        const t = target.toLowerCase().trim();
        return t && (location.includes(t) || (t.includes('remote') && location.includes('remote')));
    })) {
        score += 4;
    }
    if (posting.postedAt) {
        const ageDays = (now.getTime() - posting.postedAt.getTime()) / 86_400_000;
        score += Math.max(0, 2 - ageDays / 30); // up to +2, fading over two months
    }
    return score;
}

async function sourcesFor(company: string) {
    const key = canonicalCompanyKey(company);
    const token = longestNameToken(key);
    if (!token) return [];
    const candidates = await prisma.jobSource.findMany({
        where: { companyName: { contains: token, mode: 'insensitive' } },
        select: { id: true, companyName: true, status: true },
        take: 50,
    });
    return candidates.filter((source) => canonicalCompanyKey(source.companyName) === key);
}

export const openingsSection: ScoutSection<'openings'> = async (ctx) => {
    const classify = dataOf(ctx.sections, 'classify');
    const companies = (classify?.companies ?? []).slice(0, MAX_COMPANIES);
    if (companies.length === 0) {
        return { status: 'unavailable', reason: 'The post did not name a company to look up.' };
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId: ctx.userId }, select: { preferences: true } });
    const prefs = parseUserGenerationPreferences(profile?.preferences);
    const now = new Date();

    const result: OpeningsData['companies'] = [];
    for (const name of companies) {
        const sources = await sourcesFor(name);
        if (sources.length === 0) {
            result.push({
                name,
                openings: [],
                tracked: false,
                note: `Patronus does not watch ${name}'s job board yet, so there are no openings to show. Share one of their job links and the board is picked up from it.`,
            });
            continue;
        }

        const postings: PostingRow[] = await prisma.jobPosting.findMany({
            where: { sourceId: { in: sources.map((source) => source.id) }, closedAt: null },
            orderBy: [{ postedAt: 'desc' }],
            take: 300,
            select: { title: true, location: true, absoluteUrl: true, postedAt: true },
        });

        const ranked = postings
            .map((posting) => ({ posting, score: scorePosting(posting, prefs, now) }))
            .sort((a, b) => b.score - a.score || (b.posting.postedAt?.getTime() ?? 0) - (a.posting.postedAt?.getTime() ?? 0))
            .slice(0, MAX_OPENINGS_PER_COMPANY)
            .map(({ posting }) => ({
                title: posting.title,
                location: posting.location,
                url: posting.absoluteUrl,
                postedAt: posting.postedAt?.toISOString() ?? null,
            }));

        const tracked = sources.some((source) => source.status === 'active');
        result.push({
            name,
            openings: ranked,
            tracked,
            note: ranked.length === 0
                ? tracked
                    ? `${name}'s board currently lists no open roles.`
                    : `${name}'s board has stopped answering, so openings may be out of date.`
                : null,
        });
        // Postings are our own rows; cite each as a source so the links are
        // recognised as ones the run actually has.
        for (const opening of ranked) {
            ctx.step.sources.add({ url: opening.url, title: `${opening.title} · ${name}`, text: opening.title, publishedAt: opening.postedAt });
        }
    }

    const anyOpenings = result.some((company) => company.openings.length > 0);
    return anyOpenings
        ? { status: 'ok', data: { companies: result } }
        : { status: 'unavailable', reason: result.map((company) => company.note).filter(Boolean).join(' '), data: { companies: result } };
};
