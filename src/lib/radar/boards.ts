/**
 * Public job-board adapters (PRD 04 §3.1).
 *
 * These read boards a company chose to publish. No scraping, no auth, no
 * logged-in surfaces — that is a locked decision from v2 §11 and the reason
 * this is a per-provider adapter rather than a generic fetcher.
 *
 * ── Which providers, and why only two ───────────────────────────────────
 *
 * Measured against live boards before writing any of this:
 *
 *   Greenhouse   8/8 boards responded · 2,629 postings · 48% disclose comp
 *   Ashby        5/5 boards responded · 1,112 postings · comp is a FIRST-CLASS
 *                API field, present on every posting
 *   Lever        1/15 boards responded, and the one that did (Spotify) carries
 *                no pay text at all in its description
 *
 * So Lever is deliberately absent. The PRD lists it as "Large" coverage; the
 * probe says otherwise, and an adapter nobody's board answers is maintenance
 * with no postings behind it. Revisit with a real list of Lever tokens rather
 * than on the strength of the vendor's market share.
 *
 * ── Politeness ──────────────────────────────────────────────────────────
 *
 * One request per second per host, a real User-Agent with a contact URL, and
 * conditional requests via ETag/Last-Modified. Rate limiting is enforced by
 * STAGGERING the fan-out (see `ingestBoard`), not by sleeping inside a job:
 * a job that sleeps burns Vercel wall-clock, and several jobs sleeping
 * concurrently do not actually serialise anything.
 */

import { extractCompensation, unescapeHtml, type CompExtraction } from '@/lib/radar/comp';

export const BOT_USER_AGENT = 'PatronusBot/1.0 (+https://patronus.app/bot)';

/** Politeness floor per host. Used to space the fan-out, not to sleep. */
export const MIN_REQUEST_SPACING_MS = 1_100;

/** §3.1 — five consecutive 404s retires a board. */
export const NOT_FOUND_STREAK_LIMIT = 5;

/** One posting, normalised across providers. */
export type RawPosting = {
    /** The provider's own id. Unique within a board. */
    externalId: string;
    title: string;
    location: string | null;
    department: string | null;
    absoluteUrl: string;
    postedAt: Date | null;
    updatedAtSource: Date | null;
    /** Plain text, for skill extraction. */
    description: string;
    /** Null when the posting disclosed nothing. */
    compensation: CompExtraction | null;
};

export type FetchOutcome =
    | { kind: 'ok'; postings: RawPosting[]; etag: string | null; lastModified: string | null }
    /** 304 — nothing changed since our cached validator. */
    | { kind: 'not_modified' }
    /** The board is gone. Five of these in a row retires it. */
    | { kind: 'not_found' }
    /** 429/503 — back off, do not count as an error against the board. */
    | { kind: 'throttled'; retryAfterMs: number | null }
    | { kind: 'error'; message: string; status?: number };

export type FetchArgs = {
    boardToken: string;
    etag?: string | null;
    lastModified?: string | null;
    /** Injected in tests. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
};

export interface BoardAdapter {
    readonly provider: 'greenhouse' | 'ashby';
    /** Host, for the per-host spacing budget. */
    readonly host: string;
    fetchBoard(args: FetchArgs): Promise<FetchOutcome>;
}

// ─────────────────────────────────────────────────────────────── helpers

function conditionalHeaders(etag?: string | null, lastModified?: string | null): HeadersInit {
    return {
        'User-Agent': BOT_USER_AGENT,
        Accept: 'application/json',
        ...(etag ? { 'If-None-Match': etag } : {}),
        ...(lastModified ? { 'If-Modified-Since': lastModified } : {}),
    };
}

function retryAfterMs(res: Response): number | null {
    const raw = res.headers.get('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1_000;
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Map a transport-level response onto the outcomes callers branch on. */
function classify(res: Response): Exclude<FetchOutcome, { kind: 'ok' }> | null {
    if (res.status === 304) return { kind: 'not_modified' };
    if (res.status === 404 || res.status === 410) return { kind: 'not_found' };
    if (res.status === 429 || res.status === 503) {
        return { kind: 'throttled', retryAfterMs: retryAfterMs(res) };
    }
    if (!res.ok) return { kind: 'error', message: `http_${res.status}`, status: res.status };
    return null;
}

function toDate(value: unknown): Date | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function toPlainText(html: string): string {
    return unescapeHtml(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ────────────────────────────────────────────────────────────── greenhouse

type GreenhouseJob = {
    id?: number | string;
    title?: string;
    absolute_url?: string;
    updated_at?: string;
    first_published?: string;
    content?: string;
    location?: { name?: string };
    departments?: Array<{ name?: string }>;
};

export const greenhouseAdapter: BoardAdapter = {
    provider: 'greenhouse',
    host: 'boards-api.greenhouse.io',

    async fetchBoard({ boardToken, etag, lastModified, fetchImpl = fetch }) {
        const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;

        let res: Response;
        try {
            res = await fetchImpl(url, { headers: conditionalHeaders(etag, lastModified) });
        } catch (error) {
            return { kind: 'error', message: error instanceof Error ? error.message : 'fetch_failed' };
        }

        const early = classify(res);
        if (early) return early;

        let body: { jobs?: GreenhouseJob[] };
        try {
            body = (await res.json()) as { jobs?: GreenhouseJob[] };
        } catch {
            return { kind: 'error', message: 'invalid_json' };
        }

        const postings: RawPosting[] = (body.jobs ?? []).flatMap((job) => {
            if (job.id === undefined || !job.title) return [];
            // `content` arrives HTML-ESCAPED. `extractCompensation` unescapes
            // internally; the plain-text copy for skills must do so too.
            const raw = job.content ?? '';
            return [
                {
                    externalId: String(job.id),
                    title: job.title,
                    location: job.location?.name ?? null,
                    department: job.departments?.[0]?.name ?? null,
                    absoluteUrl: job.absolute_url ?? '',
                    postedAt: toDate(job.first_published),
                    updatedAtSource: toDate(job.updated_at),
                    description: toPlainText(raw),
                    compensation: extractCompensation(raw),
                },
            ];
        });

        return {
            kind: 'ok',
            postings,
            etag: res.headers.get('etag'),
            lastModified: res.headers.get('last-modified'),
        };
    },
};

// ─────────────────────────────────────────────────────────────────── ashby

type AshbyJob = {
    id?: string;
    title?: string;
    location?: string;
    department?: string;
    jobUrl?: string;
    publishedAt?: string;
    descriptionHtml?: string;
    descriptionPlain?: string;
    isListed?: boolean;
    compensation?: {
        scrapeableCompensationSalarySummary?: string | null;
        compensationTierSummary?: string | null;
    };
};

/**
 * Ashby publishes compensation as structured data rather than prose, which is
 * strictly better evidence than anything parsed out of a description — the
 * employer tagged it as pay themselves.
 *
 * The summary still needs parsing (`"$211.4K - $290.6K"`), but it is a short,
 * predictable string rather than a paragraph, so it is handed to the same
 * extractor the rest of the pipeline uses. One extractor, one set of currency
 * and separator rules, one place to fix a bug.
 */
function ashbyCompensation(job: AshbyJob): CompExtraction | null {
    const summary =
        job.compensation?.scrapeableCompensationSalarySummary ??
        job.compensation?.compensationTierSummary ??
        null;

    if (summary) {
        const parsed = extractCompensation(summary);
        // The extractor reports `prose` because it matched a plain string, but
        // this string came out of a dedicated compensation field the employer
        // filled in — that is structured evidence, and recording it as prose
        // would understate how much we trust it. Provenance accuracy is the
        // product; it applies to our own metadata too.
        if (parsed) return { ...parsed, source: 'structured' };
    }
    // Fall back to the description for boards that describe pay in prose.
    return extractCompensation(job.descriptionHtml ?? job.descriptionPlain ?? '');
}

export const ashbyAdapter: BoardAdapter = {
    provider: 'ashby',
    host: 'api.ashbyhq.com',

    async fetchBoard({ boardToken, etag, lastModified, fetchImpl = fetch }) {
        const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}?includeCompensation=true`;

        let res: Response;
        try {
            res = await fetchImpl(url, { headers: conditionalHeaders(etag, lastModified) });
        } catch (error) {
            return { kind: 'error', message: error instanceof Error ? error.message : 'fetch_failed' };
        }

        const early = classify(res);
        if (early) return early;

        let body: { jobs?: AshbyJob[] };
        try {
            body = (await res.json()) as { jobs?: AshbyJob[] };
        } catch {
            return { kind: 'error', message: 'invalid_json' };
        }

        const postings: RawPosting[] = (body.jobs ?? []).flatMap((job) => {
            if (!job.id || !job.title) return [];
            // `isListed: false` is a posting the company has taken down but
            // still serves. Including it would age the band with dead roles.
            if (job.isListed === false) return [];
            return [
                {
                    externalId: job.id,
                    title: job.title,
                    location: job.location ?? null,
                    department: job.department ?? null,
                    absoluteUrl: job.jobUrl ?? '',
                    postedAt: toDate(job.publishedAt),
                    updatedAtSource: toDate(job.publishedAt),
                    description: job.descriptionPlain ?? toPlainText(job.descriptionHtml ?? ''),
                    compensation: ashbyCompensation(job),
                },
            ];
        });

        return {
            kind: 'ok',
            postings,
            etag: res.headers.get('etag'),
            lastModified: res.headers.get('last-modified'),
        };
    },
};

// ───────────────────────────────────────────────────────────────── registry

const ADAPTERS: Record<string, BoardAdapter> = {
    greenhouse: greenhouseAdapter,
    ashby: ashbyAdapter,
};

/**
 * Resolve an adapter, or null for a provider we do not implement.
 *
 * Returns null rather than throwing so a `JobSource` row for a retired or
 * not-yet-built provider (`lever`) is skipped rather than dead-lettering the
 * whole ingest job.
 */
export function adapterFor(provider: string): BoardAdapter | null {
    return ADAPTERS[provider] ?? null;
}

export function supportedProviders(): string[] {
    return Object.keys(ADAPTERS);
}
