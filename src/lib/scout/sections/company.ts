/**
 * Company: size, funding, revenue, growth and observed hiring.
 *
 * Three sources, in the precedence `src/lib/enrichment` already defines:
 *   1. `enrichCompany` — the licensed provider (PDL) plus the hiring signal
 *      computed from postings we own. Never throws; absent key is normal.
 *   2. Web research — funding rounds, revenue, headcount and growth news, as
 *      CITED facts. Each fact names the page it came from, quotes its value
 *      from that page, and passes the numeric guard against that page alone.
 *   3. Nothing. "Unknown" is shown as unknown.
 *
 * Public research is cached per company for 30 days and shared across users.
 * The hiring signal is not cached here (enrichment recomputes it each time;
 * staleness there contradicts the posting ingested this morning).
 */

import { z } from 'zod';
import { enrichCompany, type EnrichCompanyResult } from '@/lib/enrichment/enrich';
import { toWireHiringSignal } from '@/lib/enrichment/hiring';
import { readResearch, researchKey, writeResearch } from '@/lib/research/cache';
import { pageText, reasonForOutcome, runSearch, RESEARCH_OFF_REASON, type RunSearchOutcome } from '@/lib/research/search';
import { researchTarget } from '@/lib/research/target';
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
import type { CitedFact, CompanyData } from '@/lib/scout/types';

const NEWS_DOMAINS = [
    'crunchbase.com',
    'tracxn.com',
    'techcrunch.com',
    'inc42.com',
    'yourstory.com',
    'economictimes.indiatimes.com',
    'entrackr.com',
    'moneycontrol.com',
    'livemint.com',
    'business-standard.com',
    'reuters.com',
    'bloomberg.com',
];

const MAX_FACTS = 8;

type Enricher = typeof enrichCompany;
let enricher: Enricher = enrichCompany;

export const __testing = {
    setEnricher(next: Enricher | null) {
        enricher = next ?? enrichCompany;
    },
};

// ─────────────────────────────────────────────────────────── extraction

const ExtractSchema = z.object({
    facts: z.array(z.object({
        /** 1-based index of the result the fact is on. */
        resultIndex: z.number().int(),
        /** e.g. "Series C", "Total funding", "Revenue FY24", "Employees", "Layoffs". */
        label: z.string().min(1).max(60),
        /** Copied exactly as the page writes it. */
        value: z.string().min(1).max(160),
    })).max(12),
    /** One sentence on trajectory, using only the facts above. Null if they are thin. */
    growthNote: z.string().max(280).nullable(),
});

const SYSTEM = `You extract company facts from numbered web search results.

Rules:
- Only facts about the exact company named. Skip results about a different company with a similar name.
- Each fact cites ONE result by its number. Copy the value EXACTLY as that result writes it ("$45 million", "Series B", "1,001-5,000 employees"). Never convert currencies, round, add up rounds, or estimate.
- Useful labels: latest funding round, total funding, valuation, investors, revenue, profit/loss, employee count, layoffs, acquisitions, expansion, IPO.
- If a result does not state a fact plainly, leave it out. An empty list is a correct answer.
- growthNote: one plain sentence on trajectory built ONLY from the facts you listed, or null. No adjectives like "rapid" unless a fact supports them.`;

function buildPrompt(company: string, results: readonly SearchResult[]): string {
    return `Company: ${company}\n\nResults:\n${numberedResults(results)}`;
}

type VerifiedFacts = { facts: CitedFact[]; growthNote: string | null; dropped: number; pagesUsed: SearchResult[] };

/** Code decides which extracted facts stand. The model's word counts for nothing here. */
export function verifyFacts(
    company: string,
    results: readonly SearchResult[],
    extracted: z.infer<typeof ExtractSchema>,
    fetchedAt: string,
): VerifiedFacts {
    const facts: CitedFact[] = [];
    const used = new Map<string, SearchResult>();
    let dropped = 0;

    for (const fact of extracted.facts) {
        const result = resolvePick(results, fact.resultIndex);
        if (!result) { dropped += 1; continue; }
        const page = pageText(result);
        const ok = mentionsCompany(`${result.title}\n${page}`, company)
            && quotedIn(fact.value, page)
            && numbersSupported([fact.value, fact.label], page);
        if (!ok) { dropped += 1; continue; }
        if (facts.some((existing) => existing.label.toLowerCase() === fact.label.toLowerCase() && existing.value === fact.value)) continue;
        facts.push({
            label: fact.label,
            value: fact.value,
            sourceUrl: result.url,
            sourceTitle: result.title,
            asOf: result.publishedDate ?? fetchedAt,
        });
        used.set(result.url, result);
        if (facts.length >= MAX_FACTS) break;
    }

    // "Written only from kept facts": its numbers must be among those facts'
    // values. A note resting on a dropped fact goes with it.
    const note = extracted.growthNote?.trim() || null;
    const growthNote = note && facts.length > 0 && numbersSupported([note], facts.map((f) => `${f.label}: ${f.value}`).join('\n'))
        ? note
        : null;

    return { facts, growthNote, dropped, pagesUsed: [...used.values()] };
}

// ────────────────────────────────────────────────────────────── mapping

function fromEnrichment(name: string, enrichment: EnrichCompanyResult | null, geography: string) {
    const facts = enrichment?.providerFacts ?? {};
    const provenance: Record<string, string> = {};
    for (const [field, entry] of Object.entries(enrichment?.provenance ?? {})) {
        provenance[field] = entry.source === 'provider' && entry.provider ? `provider:${entry.provider}` : entry.source;
    }
    const hiring = enrichment ? toWireHiringSignal(enrichment.hiring, geography) : null;
    return {
        name,
        website: facts.website ?? null,
        employeeCount: enrichment?.fields.employeeCount ?? null,
        employeeCountRange: facts.employeeCountRange ?? null,
        fundingText: enrichment?.fields.fundingTotal ?? facts.fundingTotalText ?? null,
        latestFundingStage: facts.latestFundingStage ?? null,
        revenueText: enrichment?.fields.revenueEstimateText ?? null,
        industry: facts.industry ?? null,
        headquarters: facts.headquarters ?? null,
        foundedYear: facts.foundedYear ?? null,
        provenance,
        hiringStatement: hiring?.statement ?? null,
    };
}

type CachedCompany = { facts: CitedFact[]; growthNote: string | null };

// ─────────────────────────────────────────────────────────────── section

export const companySection: ScoutSection<'company'> = async (ctx) => {
    const target = researchTarget(ctx.sections);
    if (!target) return { status: 'unavailable', reason: 'No company is named in this link' };

    const enrichment = await enricher({ companyName: target.company, geography: target.geography }).catch((error: unknown) => {
        ctx.step.log('enrichment failed', { error: String(error) });
        return null;
    });
    const base = fromEnrichment(target.company, enrichment, target.geography);

    const key = researchKey('company', target.company);
    const fetchedAt = new Date().toISOString();
    let research: CachedCompany | null = null;
    let researchReason: string | null = null;

    const cached = await readResearch<CachedCompany>(ctx.step, key);
    if (cached) {
        // Re-verify cached claims against their stored pages: a cache hit is
        // not an exemption from the checks, it is just cheaper input to them.
        const results = pagesAsResults(cached.pages);
        const facts = (cached.payload?.facts ?? []).filter((fact) => {
            const page = results.find((result) => result.url === fact.sourceUrl);
            return Boolean(page && ctx.step.sources.has(fact.sourceUrl) && quotedIn(fact.value, pageText(page)));
        });
        research = { facts, growthNote: facts.length ? cached.payload?.growthNote ?? null : null };
    } else {
        const outcomes: RunSearchOutcome[] = [];
        outcomes.push(await runSearch(ctx.step, {
            query: `${target.company} funding round raised valuation investors`,
            includeDomains: NEWS_DOMAINS,
            maxResults: 6,
            includeRawContent: true,
        }));
        if (outcomes[0].kind === 'ok') {
            outcomes.push(await runSearch(ctx.step, {
                query: `${target.company} company revenue employees headcount growth layoffs`,
                topic: 'news',
                maxResults: 5,
                includeRawContent: true,
            }));
        }

        const results = dedupeResults(outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? outcome.results : [])));
        const firstFailure = outcomes.find((outcome) => outcome.kind !== 'ok');

        if (results.length === 0 && firstFailure) {
            researchReason = reasonForOutcome(firstFailure);
        } else if (results.length === 0) {
            research = { facts: [], growthNote: null };
            await writeResearch({ key, kind: 'company', value: research, pages: [], empty: true, step: ctx.step });
        } else {
            const { data } = await ctx.step.ai({
                task: 'scoutResearchExtract',
                schema: ExtractSchema,
                system: SYSTEM,
                prompt: buildPrompt(target.company, results),
            });
            const verified = verifyFacts(target.company, results, data, fetchedAt);
            ctx.step.log('company facts verified', { kept: verified.facts.length, dropped: verified.dropped });
            research = { facts: verified.facts, growthNote: verified.growthNote };
            await writeResearch({
                key,
                kind: 'company',
                value: research,
                pages: verified.pagesUsed.map(toCachedPage),
                empty: verified.facts.length === 0,
                step: ctx.step,
            });
        }
    }

    const data: CompanyData = {
        ...base,
        facts: research?.facts ?? [],
        growthNote: research?.growthNote ?? null,
    };

    const hasAnything = data.employeeCount !== null || data.employeeCountRange || data.fundingText
        || data.revenueText || data.hiringStatement || data.facts.length > 0;

    if (researchReason) {
        return hasAnything
            ? { status: 'unavailable', reason: researchReason, data }
            : { status: 'unavailable', reason: researchReason === RESEARCH_OFF_REASON ? `${RESEARCH_OFF_REASON}. No other source has this company.` : researchReason };
    }
    if (!hasAnything) {
        return { status: 'unavailable', reason: `No public size, funding or revenue figures found for ${target.company}`, data };
    }
    return { status: 'ok', data };
};
