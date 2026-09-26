/**
 * People Data Labs — Company Enrichment.
 *
 * ── Why this vendor for the first implementation ────────────────────────────
 *
 * It is the only one of the obvious candidates that returns headcount AND
 * funding AND a revenue range from a single unauthenticated-to-us GET, on a
 * free tier large enough to validate the feature before anyone signs a
 * contract. Crunchbase has better funding data and gates its API behind an
 * enterprise agreement; Apollo and Clearbit are strong on firmographics and
 * weaker on funding. Since the point of `EnrichmentProvider` is that this
 * choice is reversible, the tiebreak was "which one can be running today".
 *
 * The important property is not the vendor. It is that the vendor has done the
 * licensing and compliance work, so we consume a record instead of maintaining
 * a scraper against a site that does not want one — and so nobody's personal
 * credentials are sitting in our database being a breach target.
 *
 * ── What their numbers actually are ─────────────────────────────────────────
 *
 * `employee_count` is derived from professional-network profiles. It is an
 * estimate with a known bias — high for large companies, noisy for small ones —
 * and `size` (their band, "51-200") is frequently the more honest field, so
 * both are carried and the UI can prefer the band. `inferred_revenue` is a
 * RANGE, which is why it maps cleanly onto `revenueEstimateText`: nobody
 * outside the company knows the point value, and a range says so.
 *
 * API: https://docs.peopledatalabs.com/docs/company-enrichment-api
 */

import {
    emptyCompanyFacts,
    type CompanyFacts,
    type EnrichArgs,
    type EnrichmentOutcome,
    type EnrichmentProvider,
} from '@/lib/enrichment/types';

export const PDL_HOST = 'api.peopledatalabs.com';
const PDL_ENDPOINT = `https://${PDL_HOST}/v5/company/enrich`;

/** Enrichment is a nice-to-have on a request path. It does not get to hang. */
export const DEFAULT_TIMEOUT_MS = 6_000;

// ───────────────────────────────────────────────────────────────── coercion

function toFiniteInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return null;
}

function toNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function toDate(value: unknown): Date | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Render a USD funding total as text.
 *
 * Text rather than a number because the schema field is text, and because the
 * schema field is text for a reason: rounds happen in several currencies and we
 * do not convert (the same rule that governs comp bands in `radar/comp.ts` — a
 * stale FX rate silently corrupts everything downstream of it). PDL reports
 * this figure in USD, so the currency is stated in the string rather than
 * implied by it.
 */
export function formatFundingTotal(raisedUsd: unknown): string | null {
    const amount = toFiniteInt(raisedUsd);
    if (amount === null || amount <= 0) return null;

    if (amount >= 1_000_000_000) {
        const b = amount / 1_000_000_000;
        return `$${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)}B raised (USD)`;
    }
    if (amount >= 1_000_000) {
        const m = amount / 1_000_000;
        return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M raised (USD)`;
    }
    if (amount >= 1_000) {
        return `$${Math.round(amount / 1_000)}K raised (USD)`;
    }
    return `$${amount} raised (USD)`;
}

/** Their location object → one display line. */
function formatHeadquarters(location: unknown): string | null {
    if (!location || typeof location !== 'object' || Array.isArray(location)) return null;
    const loc = location as Record<string, unknown>;

    const parts = [
        toNonEmptyString(loc.locality),
        toNonEmptyString(loc.region),
        toNonEmptyString(loc.country),
    ].filter(Boolean) as string[];

    if (parts.length > 0) return parts.join(', ');
    return toNonEmptyString(loc.name);
}

/**
 * Vendor record → `CompanyFacts`.
 *
 * Exported so the mapping is testable against a fixture without a network call,
 * which is the only part of this file with any logic worth asserting on.
 */
export function mapPdlCompany(body: unknown): CompanyFacts {
    const facts = emptyCompanyFacts();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return facts;
    const row = body as Record<string, unknown>;

    facts.employeeCount = toFiniteInt(row.employee_count);
    facts.employeeCountRange = toNonEmptyString(row.size);
    facts.fundingTotalText = formatFundingTotal(row.total_funding_raised);
    facts.latestFundingStage = toNonEmptyString(row.latest_funding_stage);
    facts.lastFundingAt = toDate(row.last_funding_date);
    facts.fundingRoundCount = toFiniteInt(row.number_funding_rounds);
    facts.revenueEstimateText = toNonEmptyString(row.inferred_revenue);
    facts.industry = toNonEmptyString(row.industry);
    facts.foundedYear = toFiniteInt(row.founded);
    facts.headquarters = formatHeadquarters(row.location);
    facts.website = toNonEmptyString(row.website);
    facts.providerRecordId = toNonEmptyString(row.id);

    return facts;
}

function retryAfterMs(res: Response): number | null {
    const raw = res.headers.get('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1_000;
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Map a response status onto an outcome.
 *
 * 402 and 429 are both "come back later" but for different reasons, and 404
 * from this endpoint is an answer rather than a failure: the vendor looked and
 * does not have the company. Callers cache that.
 */
function classify(res: Response): Exclude<EnrichmentOutcome, { kind: 'ok' }> | null {
    if (res.status === 404) return { kind: 'not_found' };
    if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' };
    if (res.status === 402) return { kind: 'quota_exhausted' };
    if (res.status === 429) return { kind: 'throttled', retryAfterMs: retryAfterMs(res) };
    if (!res.ok) return { kind: 'error', message: `http_${res.status}`, status: res.status };
    return null;
}

/**
 * Build the query.
 *
 * Website wins when present. Name matching across an index this large is
 * genuinely ambiguous — several real companies are called "Atlas" — and a
 * confidently wrong company record is worse than no record, because it looks
 * authoritative on a card the user is using to decide where to work.
 */
export function buildPdlQuery(companyName: string, website?: string | null): URLSearchParams {
    const params = new URLSearchParams();
    const domain = normalizeDomain(website);
    if (domain) params.set('website', domain);
    else params.set('name', companyName);
    return params;
}

/** `https://www.stripe.com/careers` → `stripe.com`. */
export function normalizeDomain(website?: string | null): string | null {
    const raw = toNonEmptyString(website ?? null);
    if (!raw) return null;
    try {
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        return url.hostname.toLowerCase().replace(/^www\./, '') || null;
    } catch {
        return null;
    }
}

export function createPeopleDataLabsProvider(apiKey: string): EnrichmentProvider {
    return {
        name: 'peopledatalabs',
        host: PDL_HOST,

        async enrich(args: EnrichArgs): Promise<EnrichmentOutcome> {
            const companyName = args.companyName.trim();
            const domain = normalizeDomain(args.website);
            if (!companyName && !domain) {
                return { kind: 'error', message: 'no_company_identifier' };
            }

            const doFetch = args.fetchImpl ?? fetch;
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            );

            try {
                const query = buildPdlQuery(companyName, domain);
                const res = await doFetch(`${PDL_ENDPOINT}?${query.toString()}`, {
                    method: 'GET',
                    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
                    signal: controller.signal,
                });

                const problem = classify(res);
                if (problem) return problem;

                const body = (await res.json()) as unknown;

                // Their 200 envelope can still carry a not-found status, so the
                // HTTP code alone is not the answer.
                if (
                    body && typeof body === 'object' && !Array.isArray(body) &&
                    toFiniteInt((body as Record<string, unknown>).status) === 404
                ) {
                    return { kind: 'not_found' };
                }

                const facts = mapPdlCompany(body);
                return { kind: 'ok', facts, observedAt: new Date(), raw: body };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // An abort is a timeout, which is a retryable condition rather
                // than a broken integration. Naming it keeps that readable in
                // logs six months from now.
                if (error instanceof Error && error.name === 'AbortError') {
                    return { kind: 'error', message: 'timeout' };
                }
                return { kind: 'error', message };
            } finally {
                clearTimeout(timeout);
            }
        },
    };
}
