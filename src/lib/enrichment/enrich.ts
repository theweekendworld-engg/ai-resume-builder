/**
 * The enrichment orchestrator: provider + observed postings → `CompanyInsight`.
 *
 * Everything expensive here is cached, and the two caches have deliberately
 * different lifetimes:
 *
 *   A successful record is refreshed every 30 days. Headcount and funding do
 *   not move faster than that, and re-asking weekly buys nothing but credits.
 *
 *   A `not_found` is cached for 14 days as a REAL NEGATIVE. This is the one
 *   most likely to be dropped, and dropping it is expensive: without it, every
 *   company outside the vendor's index is re-queried on every page view
 *   forever, which is exactly the population you will never get an answer for.
 *
 * The hiring signal is not cached at all — it is a query against rows we
 * already own, and staleness there would mean showing someone a "no India
 * roles" verdict that the posting ingested this morning already contradicts.
 */

import { Prisma } from '@prisma/client';
import { normalizeCompanyName } from '@/lib/enrichment/companyName';
import { getCompanyHiringSignal, type HiringResult } from '@/lib/enrichment/hiring';
import {
    confidenceFromProvenance,
    freshnessLabelFor,
    mergeCompanyFields,
    readProvenance,
    type MergeableFields,
} from '@/lib/enrichment/merge';
import { resolveEnrichmentProvider } from '@/lib/enrichment/providers';
import { prisma } from '@/lib/prisma';
import type {
    CompanyFacts,
    EnrichmentOutcome,
    EnrichmentProvider,
    ProvenanceMap,
} from '@/lib/enrichment/types';

export const PROVIDER_TTL_DAYS = 30;
export const NOT_FOUND_TTL_DAYS = 14;

/** What the last provider call did, kept so TTLs can be honoured. */
type EnrichmentAttempt = {
    provider: string;
    at: string;
    outcome: EnrichmentOutcome['kind'];
};

export type EnrichCompanyResult = {
    insightId: string | null;
    normalizedCompanyName: string;
    fields: MergeableFields;
    provenance: ProvenanceMap;
    confidence: number;
    freshnessLabel: string;
    /** Extra vendor facts with no column of their own. */
    providerFacts: Partial<CompanyFacts>;
    hiring: HiringResult;
    /** `skipped` means a live cache entry answered. */
    providerOutcome: EnrichmentOutcome['kind'] | 'skipped' | 'no_provider';
};

function readAttempt(rawData: unknown): EnrichmentAttempt | null {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
    const candidate = (rawData as Record<string, unknown>).enrichmentAttempt;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

    const entry = candidate as Record<string, unknown>;
    if (typeof entry.provider !== 'string' || typeof entry.at !== 'string') return null;
    return {
        provider: entry.provider,
        at: entry.at,
        outcome: String(entry.outcome ?? 'error') as EnrichmentOutcome['kind'],
    };
}

function readRawObject(rawData: unknown): Record<string, Prisma.JsonValue> {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    return { ...(rawData as Record<string, Prisma.JsonValue>) };
}

/**
 * Should we spend a credit on this company right now?
 *
 * A different provider than the one that wrote the cache always re-asks —
 * swapping vendors is precisely when you want the old answer re-tested, and
 * silently honouring a TTL written by the vendor you just replaced would make
 * the swap look like it did nothing.
 */
export function shouldCallProvider(params: {
    attempt: EnrichmentAttempt | null;
    providerName: string;
    now: Date;
    forceRefresh?: boolean;
}): boolean {
    if (params.forceRefresh) return true;
    if (!params.attempt) return true;
    if (params.attempt.provider !== params.providerName) return true;

    const at = Date.parse(params.attempt.at);
    if (!Number.isFinite(at)) return true;

    const ageMs = params.now.getTime() - at;
    const ttlDays = params.attempt.outcome === 'not_found'
        ? NOT_FOUND_TTL_DAYS
        : PROVIDER_TTL_DAYS;

    // Transient failures are not cached — a timeout says nothing about the
    // company, only about the minute we happened to ask in.
    const isTransient = params.attempt.outcome === 'throttled'
        || params.attempt.outcome === 'error'
        || params.attempt.outcome === 'quota_exhausted';
    if (isTransient) return true;

    return ageMs > ttlDays * 86_400_000;
}

/** Vendor facts → the columns that exist. The rest ride along in `rawData`. */
function toMergeable(facts: CompanyFacts): Partial<MergeableFields> {
    return {
        employeeCount: facts.employeeCount,
        fundingTotal: facts.fundingTotalText,
        revenueEstimateText: facts.revenueEstimateText,
    };
}

function extraFacts(facts: CompanyFacts): Partial<CompanyFacts> {
    return {
        employeeCountRange: facts.employeeCountRange,
        latestFundingStage: facts.latestFundingStage,
        lastFundingAt: facts.lastFundingAt,
        fundingRoundCount: facts.fundingRoundCount,
        industry: facts.industry,
        foundedYear: facts.foundedYear,
        headquarters: facts.headquarters,
        providerRecordId: facts.providerRecordId,
    };
}

/**
 * Enrich one company and persist the result.
 *
 * Never throws for an unreachable or unconfigured provider. Enrichment failing
 * must degrade the card, not the request that asked for it — the caller is
 * usually rendering something the user is already looking at.
 */
export async function enrichCompany(params: {
    companyName: string;
    website?: string | null;
    geography?: string;
    forceRefresh?: boolean;
    /** Injected in tests; defaults to whatever the environment configures. */
    provider?: EnrichmentProvider | null;
    now?: Date;
}): Promise<EnrichCompanyResult> {
    const now = params.now ?? new Date();
    const normalizedCompanyName = normalizeCompanyName(params.companyName);
    const website = params.website?.trim() || null;

    // The hiring signal is our own data and costs nothing external, so it is
    // computed even when there is no company row and no provider.
    const hiring = await getCompanyHiringSignal({
        companyName: params.companyName,
        geography: params.geography,
        now,
    });

    if (!normalizedCompanyName) {
        return {
            insightId: null,
            normalizedCompanyName: '',
            fields: { employeeCount: null, fundingTotal: null, revenueEstimateText: null },
            provenance: {},
            confidence: 0.12,
            freshnessLabel: 'job-page-derived',
            providerFacts: {},
            hiring,
            providerOutcome: 'no_provider',
        };
    }

    const existing = await prisma.companyInsight.findFirst({
        where: { normalizedCompanyName, website },
    });

    const provider = params.provider === undefined
        ? resolveEnrichmentProvider()
        : params.provider;

    let provenance = readProvenance(existing?.rawData);
    let fields: MergeableFields = {
        employeeCount: existing?.employeeCount ?? null,
        fundingTotal: existing?.fundingTotal ?? null,
        revenueEstimateText: existing?.revenueEstimateText ?? null,
    };

    const raw = readRawObject(existing?.rawData);
    let providerFacts: Partial<CompanyFacts> = {};
    let providerOutcome: EnrichCompanyResult['providerOutcome'] = 'no_provider';
    let attempt = readAttempt(existing?.rawData);

    if (provider) {
        const call = shouldCallProvider({
            attempt,
            providerName: provider.name,
            now,
            forceRefresh: params.forceRefresh,
        });

        if (!call) {
            providerOutcome = 'skipped';
        } else {
            const outcome = await provider.enrich({
                companyName: params.companyName,
                website,
            });
            providerOutcome = outcome.kind;
            attempt = { provider: provider.name, at: now.toISOString(), outcome: outcome.kind };

            if (outcome.kind === 'ok') {
                const merged = mergeCompanyFields({
                    current: fields,
                    currentProvenance: provenance,
                    incoming: toMergeable(outcome.facts),
                    source: 'provider',
                    provider: provider.name,
                    observedAt: outcome.observedAt,
                });
                fields = merged.fields;
                provenance = merged.provenance;
                providerFacts = extraFacts(outcome.facts);
            }
        }
    }

    // `providerFacts` from a skipped call still has to survive the write, or a
    // cached row loses the very fields the cache was protecting.
    const persistedExtras = providerOutcome === 'skipped'
        ? (raw.providerFacts as Prisma.JsonValue | undefined)
        : (JSON.parse(JSON.stringify(providerFacts)) as Prisma.JsonValue);

    const confidence = confidenceFromProvenance(provenance);
    const freshnessLabel = freshnessLabelFor(provenance);

    const rawData = {
        ...raw,
        provenance: provenance as unknown as Prisma.JsonValue,
        ...(persistedExtras !== undefined ? { providerFacts: persistedExtras } : {}),
        ...(attempt ? { enrichmentAttempt: attempt as unknown as Prisma.JsonValue } : {}),
        hiring: JSON.parse(JSON.stringify(hiring)) as Prisma.JsonValue,
    } satisfies Record<string, Prisma.JsonValue>;

    const payload = {
        normalizedCompanyName,
        website,
        employeeCount: fields.employeeCount,
        fundingTotal: fields.fundingTotal,
        revenueEstimateText: fields.revenueEstimateText,
        confidence,
        freshnessLabel,
        rawData: rawData as Prisma.InputJsonValue,
    };

    // findFirst → update/create rather than upsert, matching the existing path
    // in `src/lib/extension/company.ts`. Note the constraint cannot be relied on
    // to serialise this: Postgres treats NULLs as distinct, so the unique index
    // on (normalizedCompanyName, website) does not fire for the website-less
    // rows that are the common case.
    const row = existing
        ? await prisma.companyInsight.update({ where: { id: existing.id }, data: payload })
        : await prisma.companyInsight.create({ data: payload });

    return {
        insightId: row.id,
        normalizedCompanyName,
        fields,
        provenance,
        confidence,
        freshnessLabel,
        providerFacts: providerOutcome === 'skipped'
            ? ((raw.providerFacts as Partial<CompanyFacts> | undefined) ?? {})
            : providerFacts,
        hiring,
        providerOutcome,
    };
}
