/**
 * "Who works there": where a company's engineers tend to come from.
 *
 * This is the section most tempting to fake and the one where faking does the
 * most harm: "mostly IIT grads" is a claim about people, and an unsupported
 * one tells a candidate whether to bother applying. So:
 *
 *   - Every statement is a QUOTE from a cited page (campus-hiring news,
 *     placement reports, an engineer's own post), verified in code.
 *   - Confidence is computed, not asked for. One source is `low` — an
 *     anecdote. `medium` needs quotes from at least two independent sites.
 *     There is no `high`: nothing public supports one.
 *   - With no quote that survives, the section says "Not enough public
 *     evidence to say" and stops. Silence is the honest default.
 *
 * Cached per company for 30 days, shared across users.
 */

import { z } from 'zod';
import { readResearch, researchKey, writeResearch } from '@/lib/research/cache';
import { pageText, reasonForOutcome, runSearch, type RunSearchOutcome } from '@/lib/research/search';
import { researchTarget } from '@/lib/research/target';
import type { SearchResult } from '@/lib/research/types';
import {
    dedupeResults,
    hostOf,
    mentionsCompany,
    numberedResults,
    numbersSupported,
    pagesAsResults,
    quotedIn,
    resolvePick,
    toCachedPage,
} from '@/lib/research/verify';
import type { ScoutSection } from '@/lib/scout/section';
import type { CitedFact, TalentData } from '@/lib/scout/types';

export const NOT_ENOUGH_EVIDENCE = 'Not enough public evidence to say';

const ExtractSchema = z.object({
    statements: z.array(z.object({
        resultIndex: z.number().int(),
        /** e.g. "Campus hiring", "Team background". */
        label: z.string().min(1).max(60),
        /** A sentence copied verbatim from the result. */
        quote: z.string().min(10).max(300),
    })).max(8),
    /** One cautious sentence summarising ONLY the quotes, or null. */
    note: z.string().max(280).nullable(),
});

const SYSTEM = `You look for evidence about where a company's engineers were hired from: campus hiring at specific colleges (IIT, NIT, BITS, IIIT, top universities), placement reports, or engineers describing their team's background.

Rules:
- Only statements about the named company, copied VERBATIM from a result, cited by result number.
- Never generalise from one person's post to "most engineers". A single post is one data point.
- Do not infer anything from someone's name, photo or location.
- note: one cautious sentence that says only what the quotes say ("Placement reports show campus hiring at IIT Bombay and BITS Pilani"), or null.
- If no result has such a statement, return empty statements and a null note.`;

export function assessTalent(
    company: string,
    results: readonly SearchResult[],
    extracted: z.infer<typeof ExtractSchema>,
    fetchedAt: string,
): { data: TalentData | null; pagesUsed: SearchResult[]; dropped: number } {
    const facts: CitedFact[] = [];
    const used = new Map<string, SearchResult>();
    let dropped = 0;

    for (const statement of extracted.statements) {
        const result = resolvePick(results, statement.resultIndex);
        if (!result) { dropped += 1; continue; }
        const page = pageText(result);
        const ok = mentionsCompany(`${result.title}\n${page}`, company)
            && quotedIn(statement.quote, page)
            && numbersSupported([statement.quote, statement.label], page);
        if (!ok) { dropped += 1; continue; }
        facts.push({
            label: statement.label,
            value: statement.quote,
            sourceUrl: result.url,
            sourceTitle: result.title,
            asOf: result.publishedDate ?? fetchedAt,
        });
        used.set(result.url, result);
    }

    if (facts.length === 0) return { data: null, pagesUsed: [], dropped };

    const independentSites = new Set(facts.map((fact) => hostOf(fact.sourceUrl))).size;
    const confidence: TalentData['confidence'] = independentSites >= 2 ? 'medium' : 'low';
    const quotes = facts.map((fact) => fact.value).join('\n');
    const note = extracted.note && numbersSupported([extracted.note], quotes) ? extracted.note.trim() : null;

    return { data: { note, confidence, facts }, pagesUsed: [...used.values()], dropped };
}

export const talentSection: ScoutSection<'talent'> = async (ctx) => {
    const target = researchTarget(ctx.sections);
    if (!target) return { status: 'unavailable', reason: 'No company is named in this link' };

    const key = researchKey('talent', target.company);
    const cached = await readResearch<TalentData | null>(ctx.step, key);
    if (cached) {
        const pages = pagesAsResults(cached.pages);
        const facts = (cached.payload?.facts ?? []).filter((fact) => {
            const page = pages.find((result) => result.url === fact.sourceUrl);
            return Boolean(page && ctx.step.sources.has(fact.sourceUrl) && quotedIn(fact.value, pageText(page)));
        });
        if (!cached.payload || facts.length === 0) return { status: 'unavailable', reason: NOT_ENOUGH_EVIDENCE };
        const independent = new Set(facts.map((fact) => hostOf(fact.sourceUrl))).size;
        return {
            status: 'ok',
            data: { note: cached.payload.note, confidence: independent >= 2 ? 'medium' : 'low', facts },
        };
    }

    const outcomes: RunSearchOutcome[] = [];
    outcomes.push(await runSearch(ctx.step, {
        query: `${target.company} campus hiring engineers IIT NIT BITS placement`,
        maxResults: 6,
        includeRawContent: true,
    }));
    if (outcomes[0].kind === 'ok') {
        outcomes.push(await runSearch(ctx.step, {
            query: `${target.company} engineering team background colleges alumni where engineers come from`,
            includeDomains: ['reddit.com', 'teamblind.com', 'linkedin.com', 'medium.com', 'quora.com'],
            maxResults: 5,
            includeRawContent: true,
        }));
    }

    const results = dedupeResults(outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? outcome.results : [])));
    const failure = outcomes.find((outcome) => outcome.kind !== 'ok');
    if (results.length === 0 && failure) {
        return { status: 'unavailable', reason: reasonForOutcome(failure) };
    }
    if (results.length === 0) {
        await writeResearch({ key, kind: 'talent', value: null, pages: [], empty: true, step: ctx.step });
        return { status: 'unavailable', reason: NOT_ENOUGH_EVIDENCE };
    }

    const { data } = await ctx.step.ai({
        task: 'scoutResearchExtract',
        schema: ExtractSchema,
        system: SYSTEM,
        prompt: `Company: ${target.company}\n\nResults:\n${numberedResults(results)}`,
    });
    const assessed = assessTalent(target.company, results, data, new Date().toISOString());
    ctx.step.log('talent statements verified', { kept: assessed.data?.facts.length ?? 0, dropped: assessed.dropped });

    await writeResearch({
        key,
        kind: 'talent',
        value: assessed.data,
        pages: assessed.pagesUsed.map(toCachedPage),
        empty: assessed.data === null,
        step: ctx.step,
    });

    if (!assessed.data) return { status: 'unavailable', reason: NOT_ENOUGH_EVIDENCE };
    return { status: 'ok', data: assessed.data };
};
