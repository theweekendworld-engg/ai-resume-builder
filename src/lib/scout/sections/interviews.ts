/**
 * Interview experiences: links, not summaries of links.
 *
 * The deliverable is the list of real, recent write-ups and videos for this
 * company and role — Reddit, LeetCode Discuss, YouTube, GeeksforGeeks,
 * Glassdoor, Medium — each with why it is relevant. The model's job is only to
 * PICK from numbered search results and say why; code maps each pick back to
 * the result it indexes, so a link Scout shows is a link a search returned.
 * A URL the model invented has no index, and so has no way in.
 *
 * Snippets must be substrings of the page (else we show the page's own first
 * lines). Themes ("two DSA rounds, one LLD") must appear in at least one kept
 * page. Cached per (company, family, level) for 14 days.
 */

import { z } from 'zod';
import { readResearch, researchKey, writeResearch } from '@/lib/research/cache';
import { pageText, reasonForOutcome, runSearch, type RunSearchOutcome } from '@/lib/research/search';
import { researchTarget } from '@/lib/research/target';
import type { SearchResult } from '@/lib/research/types';
import {
    dedupeResults,
    hostOf,
    looseNormalize,
    mentionsCompany,
    numberedResults,
    numbersSupported,
    pagesAsResults,
    quotedIn,
    resolvePick,
    toCachedPage,
} from '@/lib/research/verify';
import type { ScoutSection } from '@/lib/scout/section';
import type { InterviewLink, InterviewSourceKind, InterviewsData } from '@/lib/scout/types';

/** ~18 months: older write-ups describe a process that has usually changed. */
const MAX_LINKS = 8;
const SNIPPET_MAX = 240;

const WRITEUP_DOMAINS = ['reddit.com', 'leetcode.com', 'geeksforgeeks.org', 'glassdoor.com', 'glassdoor.co.in', 'medium.com'];

/**
 * The role as people write it in interview posts. Postings append the team
 * ("Software Dev Engineer II, Alexa Connections", "Software Eng - Content
 * Management Systems"); nobody titles a Reddit thread that way, and the full
 * string matched two write-ups where the short one finds the rest.
 */
export function searchRole(role: string): string {
    const head = role.split(/\s[-–—|]\s|,|\(|:/)[0] ?? role;
    const short = head.replace(/\s+/g, ' ').trim();
    return short.length >= 3 ? short : role.trim();
}

export function sourceKindOf(url: string): InterviewSourceKind {
    const host = hostOf(url);
    if (host.endsWith('reddit.com')) return 'reddit';
    if (host.endsWith('leetcode.com')) return 'leetcode';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('glassdoor.')) return 'glassdoor';
    if (host.endsWith('geeksforgeeks.org')) return 'geeksforgeeks';
    if (host.endsWith('teamblind.com')) return 'blind';
    if (host.endsWith('medium.com')) return 'medium';
    return 'other';
}

const ExtractSchema = z.object({
    picks: z.array(z.object({
        resultIndex: z.number().int(),
        /** e.g. "SDE II onsite, Bengaluru, 2026 — 4 rounds". From the result only. */
        relevance: z.string().min(1).max(160),
        /** A sentence copied from the result that shows what the interview was like. */
        snippet: z.string().max(400),
    })).max(12),
    /** Recurring rounds/topics, each stated in at least one picked result. */
    themes: z.array(z.string().min(2).max(80)).max(6),
});

const SYSTEM = `You pick interview-experience write-ups and videos from numbered search results.

Rules:
- Pick only results that describe an actual interview at the named company (rounds, questions, process, outcome). Skip job listings, generic prep guides, course ads, and other companies.
- Prefer the named role and level, and recent posts.
- Answer with result NUMBERS. Never write a URL.
- relevance: what the result covers (role, level, location, year, number of rounds) using only what the result says.
- snippet: copy one sentence from the result verbatim.
- themes: short recurring topics ("DSA: graphs and DP", "low-level design round", "bar raiser"), each stated in at least one result you picked. Empty if none recur.`;

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'round', 'rounds', 'interview', 'question', 'questions', 'from', 'about', 'into', 'that', 'this']);

/** Loose support: most of a theme's meaningful words appear on one kept page. */
export function themeSupported(theme: string, pages: readonly string[]): boolean {
    const tokens = looseNormalize(theme).split(/[^a-z0-9+#]+/).filter((token) => token.length >= 3 && !STOPWORDS.has(token));
    if (tokens.length === 0) return false;
    return pages.some((page) => {
        const text = looseNormalize(page);
        const hits = tokens.filter((token) => text.includes(token)).length;
        return hits / tokens.length >= 0.6;
    });
}

export function verifyPicks(
    company: string,
    results: readonly SearchResult[],
    extracted: z.infer<typeof ExtractSchema>,
): { links: InterviewLink[]; themes: string[]; dropped: number; pagesUsed: SearchResult[] } {
    const links: InterviewLink[] = [];
    const used = new Map<string, SearchResult>();
    let dropped = 0;

    for (const pick of extracted.picks) {
        const result = resolvePick(results, pick.resultIndex);
        if (!result || used.has(result.url)) { dropped += result ? 0 : 1; continue; }
        const page = pageText(result);
        if (!mentionsCompany(`${result.title}\n${page}`, company)) { dropped += 1; continue; }

        const snippet = pick.snippet && quotedIn(pick.snippet, page)
            ? pick.snippet.trim().slice(0, SNIPPET_MAX)
            : result.content.replace(/\s+/g, ' ').trim().slice(0, 200);
        // Relevance is the model's words: its numbers ("4 rounds", "2026") must
        // be on the page, or it gets the neutral fallback.
        const relevance = numbersSupported([pick.relevance], `${result.title}\n${page}`)
            ? pick.relevance
            : `Interview experience at ${company}`;

        links.push({
            url: result.url,
            title: result.title,
            source: sourceKindOf(result.url),
            publishedAt: result.publishedDate,
            snippet,
            relevance,
        });
        used.set(result.url, result);
        if (links.length >= MAX_LINKS) break;
    }

    const keptPages = [...used.values()].map((result) => `${result.title}\n${pageText(result)}`);
    const themes = [...new Set(extracted.themes.map((theme) => theme.trim()))]
        .filter((theme) => themeSupported(theme, keptPages) && numbersSupported([theme], keptPages.join('\n')));

    return { links, themes, dropped, pagesUsed: [...used.values()] };
}

export const interviewsSection: ScoutSection<'interviews'> = async (ctx) => {
    const target = researchTarget(ctx.sections);
    if (!target) return { status: 'unavailable', reason: 'No company is named in this link' };

    // v2: v1 entries were written under the date filter and are empty for
    // companies that have plenty of write-ups.
    const key = researchKey('interviews', target.company, target.family, target.seniority, 'v2');
    const cached = await readResearch<InterviewsData>(ctx.step, key);
    if (cached) {
        const pages = pagesAsResults(cached.pages);
        const links = (cached.payload?.links ?? []).filter((link) => ctx.step.sources.has(link.url));
        const themes = (cached.payload?.themes ?? []).filter((theme) => themeSupported(theme, pages.map(pageText)));
        if (links.length === 0) {
            return { status: 'unavailable', reason: `No recent interview write-ups found for ${target.company}`, data: { links, themes } };
        }
        return { status: 'ok', data: { links, themes } };
    }

    const role = target.role ?? 'software engineer';
    const outcomes: RunSearchOutcome[] = [];
    const shortRole = searchRole(role);
    outcomes.push(await runSearch(ctx.step, {
        query: `${target.company} ${shortRole} interview experience rounds`,
        includeDomains: WRITEUP_DOMAINS,
        // NO date filter, deliberately. Tavily's start_date drops every page
        // without a published date, and forum posts (Reddit, LeetCode,
        // Glassdoor, Medium) almost never carry one: verified 2026-09-26, the
        // same Amazon SDE II query returned 0 results with the filter and 10
        // relevant write-ups without it. Recency is the model's to prefer,
        // from the dates and titles it can see.
        maxResults: 10,
        includeRawContent: false,
    }));
    if (outcomes[0].kind === 'ok') {
        outcomes.push(await runSearch(ctx.step, {
            query: `${target.company} ${shortRole} interview experience`,
            includeDomains: ['youtube.com'],
            // No date filter: video results often carry no published date, and
            // Tavily's filter drops undated pages, which emptied this search.
            // Recency still ranks in the model's pick via the date it can see.
            maxResults: 6,
        }));
    }

    const results = dedupeResults(outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? outcome.results : [])));
    const failure = outcomes.find((outcome) => outcome.kind !== 'ok');
    if (results.length === 0 && failure) {
        return { status: 'unavailable', reason: reasonForOutcome(failure) };
    }
    if (results.length === 0) {
        await writeResearch({ key, kind: 'interviews', value: { links: [], themes: [] }, pages: [], empty: true, step: ctx.step });
        return { status: 'unavailable', reason: `No recent interview write-ups found for ${target.company}` };
    }

    const { data } = await ctx.step.ai({
        task: 'scoutResearchExtract',
        schema: ExtractSchema,
        system: SYSTEM,
        prompt: `Company: ${target.company}\nRole: ${role}\n\nResults:\n${numberedResults(results, 900)}`,
    });
    const verified = verifyPicks(target.company, results, data);
    ctx.step.log('interview links verified', { kept: verified.links.length, dropped: verified.dropped });

    const value: InterviewsData = { links: verified.links, themes: verified.themes };
    await writeResearch({
        key,
        kind: 'interviews',
        value,
        pages: verified.pagesUsed.map(toCachedPage),
        empty: verified.links.length === 0,
        step: ctx.step,
    });

    if (verified.links.length === 0) {
        return { status: 'unavailable', reason: `No recent interview write-ups found for ${target.company}`, data: value };
    }
    return { status: 'ok', data: value };
};
