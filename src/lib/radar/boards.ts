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
 * So Lever was left out at first. The PRD lists it as "Large" coverage; the
 * probe said otherwise, and an adapter nobody's board answers is maintenance
 * with no postings behind it.
 *
 * Revisited 2026-10-11 with a real list, for the job watch (PRD 12), whose
 * users name the companies themselves. Lever answers for CRED, Meesho,
 * Freshworks and Zeta; SmartRecruiters for Swiggy and Freshworks; none of them
 * is on Greenhouse or Ashby. For the Indian market these two are the
 * difference between a watchlist that works and one that mostly says "not
 * found". Workable is still absent: its public endpoint answers 200 for
 * accounts that do not exist, so a hit proves nothing.
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

export type BoardProvider = 'greenhouse' | 'ashby' | 'lever' | 'smartrecruiters';

export interface BoardAdapter {
    readonly provider: BoardProvider;
    /** Host, for the per-host spacing budget. */
    readonly host: string;
    fetchBoard(args: FetchArgs): Promise<FetchOutcome>;
    /**
     * One posting's description, for providers whose list omits it. Called
     * only for a posting a job watch is about to score, never at ingest:
     * fetching every detail would be one request per posting per night.
     */
    fetchDescription?(args: { boardToken: string; externalId: string; fetchImpl?: typeof fetch }): Promise<string | null>;
}

/** Description cap. Enough for every requirement; bounded storage per posting. */
export const DESCRIPTION_MAX_CHARS = 15_000;

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

// ─────────────────────────────────────────────────────────────────── lever

type LeverJob = {
    id?: string;
    text?: string;
    hostedUrl?: string;
    createdAt?: number;
    categories?: { location?: string; department?: string; team?: string; allLocations?: string[] };
    workplaceType?: string;
    descriptionPlain?: string;
    description?: string;
    lists?: Array<{ text?: string; content?: string }>;
    additionalPlain?: string;
    salaryDescriptionPlain?: string;
};

/** Lever keeps requirements in `lists` (HTML bullets), outside the description. */
function leverText(job: LeverJob): { plain: string; html: string } {
    const lists = (job.lists ?? []).map((list) => `${list.text ?? ''}\n${list.content ?? ''}`).join('\n');
    const html = [job.description ?? '', lists, job.additionalPlain ?? '', job.salaryDescriptionPlain ?? ''].join('\n');
    const plain = [job.descriptionPlain ?? toPlainText(job.description ?? ''), toPlainText(lists), job.additionalPlain ?? '', job.salaryDescriptionPlain ?? '']
        .filter(Boolean)
        .join('\n')
        .trim();
    return { plain, html };
}

export const leverAdapter: BoardAdapter = {
    provider: 'lever',
    host: 'api.lever.co',

    async fetchBoard({ boardToken, etag, lastModified, fetchImpl = fetch }) {
        const url = `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`;

        let res: Response;
        try {
            res = await fetchImpl(url, { headers: conditionalHeaders(etag, lastModified) });
        } catch (error) {
            return { kind: 'error', message: error instanceof Error ? error.message : 'fetch_failed' };
        }

        const early = classify(res);
        if (early) return early;

        let body: unknown;
        try {
            body = await res.json();
        } catch {
            return { kind: 'error', message: 'invalid_json' };
        }
        // A real board with no openings is `[]`; an unknown one is a 404.
        if (!Array.isArray(body)) return { kind: 'error', message: 'unexpected_shape' };

        const postings: RawPosting[] = (body as LeverJob[]).flatMap((job) => {
            if (!job.id || !job.text) return [];
            const { plain, html } = leverText(job);
            const location = job.categories?.location ?? job.categories?.allLocations?.[0] ?? null;
            return [
                {
                    externalId: job.id,
                    title: job.text.trim(),
                    // Lever states remote-ness separately from the city; keep it
                    // in the string so work-mode detection can see it.
                    location: job.workplaceType === 'remote' && location && !/remote/i.test(location) ? `${location} (Remote)` : location,
                    department: job.categories?.department ?? job.categories?.team ?? null,
                    absoluteUrl: job.hostedUrl ?? '',
                    postedAt: toDate(job.createdAt),
                    updatedAtSource: toDate(job.createdAt),
                    description: plain,
                    compensation: extractCompensation(html),
                },
            ];
        });

        return { kind: 'ok', postings, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
    },
};

// ───────────────────────────────────────────────────────── smartrecruiters

type SmartRecruitersPosting = {
    id?: string;
    name?: string;
    releasedDate?: string;
    company?: { identifier?: string; name?: string };
    location?: { fullLocation?: string; city?: string; country?: string; remote?: boolean; hybrid?: boolean };
    department?: { label?: string };
    function?: { label?: string };
};

/** Pages of 100. Ten pages is a 1,000-posting board; larger ones are truncated, newest first. */
const SMARTRECRUITERS_MAX_PAGES = 10;

function smartRecruitersLocation(location: SmartRecruitersPosting['location']): string | null {
    if (!location) return null;
    // `fullLocation` leaves an empty slot when there is no region: "Chennai, , India".
    const parts = location.fullLocation ? location.fullLocation.split(',') : [location.city, location.country?.toUpperCase()];
    const base = parts.map((part) => (part ?? '').trim()).filter(Boolean).join(', ') || null;
    if (!base) return location.remote ? 'Remote' : null;
    if (location.remote) return `${base} (Remote)`;
    if (location.hybrid) return `${base} (Hybrid)`;
    return base;
}

export const smartRecruitersAdapter: BoardAdapter = {
    provider: 'smartrecruiters',
    host: 'api.smartrecruiters.com',

    async fetchBoard({ boardToken, fetchImpl = fetch }) {
        const postings: RawPosting[] = [];
        for (let page = 0; page < SMARTRECRUITERS_MAX_PAGES; page += 1) {
            const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardToken)}/postings?limit=100&offset=${page * 100}`;
            let res: Response;
            try {
                res = await fetchImpl(url, { headers: conditionalHeaders(null, null) });
            } catch (error) {
                return { kind: 'error', message: error instanceof Error ? error.message : 'fetch_failed' };
            }
            const early = classify(res);
            if (early) return early;

            let body: { totalFound?: number; content?: SmartRecruitersPosting[] };
            try {
                body = (await res.json()) as typeof body;
            } catch {
                return { kind: 'error', message: 'invalid_json' };
            }
            const content = body.content ?? [];
            for (const job of content) {
                if (!job.id || !job.name) continue;
                const identifier = job.company?.identifier ?? boardToken;
                postings.push({
                    externalId: job.id,
                    title: job.name.trim(),
                    location: smartRecruitersLocation(job.location),
                    department: job.department?.label ?? job.function?.label ?? null,
                    absoluteUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(job.id)}`,
                    postedAt: toDate(job.releasedDate),
                    updatedAtSource: toDate(job.releasedDate),
                    // The list carries no description; see `fetchDescription`.
                    description: '',
                    compensation: null,
                });
            }
            if (content.length < 100 || postings.length >= (body.totalFound ?? 0)) break;
        }
        // SmartRecruiters answers 200 with nothing for ANY company name, so an
        // empty board is indistinguishable from a wrong token. Treat it as
        // not found; a real board that empties out retires after five polls
        // and comes back when the resolver sees it again.
        if (postings.length === 0) return { kind: 'not_found' };
        return { kind: 'ok', postings, etag: null, lastModified: null };
    },

    async fetchDescription({ boardToken, externalId, fetchImpl = fetch }) {
        const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardToken)}/postings/${encodeURIComponent(externalId)}`;
        try {
            const res = await fetchImpl(url, { headers: conditionalHeaders(null, null) });
            if (!res.ok) return null;
            const body = (await res.json()) as { jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
            const sections = body.jobAd?.sections ?? {};
            // Company boilerplate first would read as requirements; keep it last.
            const order = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription'];
            const text = order
                .map((key) => sections[key])
                .filter((section): section is { title?: string; text?: string } => Boolean(section?.text))
                .map((section) => `${section.title ?? ''}\n${toPlainText(section.text ?? '')}`)
                .join('\n\n')
                .trim();
            return text ? text.slice(0, DESCRIPTION_MAX_CHARS) : null;
        } catch {
            return null;
        }
    },
};

// ───────────────────────────────────────────────────────────────── registry

const ADAPTERS: Record<string, BoardAdapter> = {
    greenhouse: greenhouseAdapter,
    ashby: ashbyAdapter,
    lever: leverAdapter,
    smartrecruiters: smartRecruitersAdapter,
};

/**
 * Resolve an adapter, or null for a provider we do not implement.
 *
 * Returns null rather than throwing so a `JobSource` row for a retired or
 * not-yet-built provider is skipped rather than dead-lettering the whole
 * ingest job.
 */
export function adapterFor(provider: string): BoardAdapter | null {
    return ADAPTERS[provider] ?? null;
}

export function supportedProviders(): string[] {
    return Object.keys(ADAPTERS);
}
