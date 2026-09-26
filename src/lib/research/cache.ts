/**
 * Shared research cache (`ResearchCache`), docs/impl/06-scout-agent.md §2 rule 6.
 *
 * Public research is shared across users; that is the efficiency lever. The
 * tenth person to share an Amazon SDE-II link should pay for their own fit,
 * not for a fresh search of levels.fyi.
 *
 * ── What may go in here ─────────────────────────────────────────────────────
 *
 * Only what was on public pages, keyed only by public facts (company, role
 * family, level, geography). Nothing about the user who triggered the search
 * — not their id, not their skills, not their preferences. A key built from a
 * user attribute would make this table a cross-user leak with a TTL.
 *
 * ── Why the page text is stored ─────────────────────────────────────────────
 *
 * A cache hit must still pass the citation checks. `readResearch` re-registers
 * every stored page into the step's `SourceSet`, so the section re-verifies
 * cached claims exactly as it verified fresh ones, and the step's recorded
 * sources show what the claim rests on. Storing only the claims would make a
 * cached answer unauditable — and quietly exempt from the guard.
 */

import { Prisma } from '@prisma/client';
import type { StepContext } from '@/lib/agent/run';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';
import { prisma } from '@/lib/prisma';

export const TTL_DAYS = {
    company: 30,
    comp: 14,
    interviews: 14,
    talent: 30,
    /** A posting's text does not change; its id does not get reused. */
    posting: 30,
    /** Nothing found. Short, so a company that gets written about is re-tried. */
    empty: 3,
} as const;

/**
 * `posting` holds a parsed job description keyed by a hash of its TEXT. The
 * text is the employer's public posting, and the parse contains nothing about
 * the user who shared it, so sharing it across users is safe — and it is what
 * makes the same link give the same requirements, and the same score, to
 * everyone.
 */
export type ResearchKind = 'company' | 'comp' | 'interviews' | 'talent' | 'posting';

/** A page a cached claim rests on, with enough text to re-verify it. */
export type CachedPage = {
    url: string;
    title: string | null;
    text: string;
    publishedAt: string | null;
};

/** Per page, enough for the quote and guard checks; not the whole article. */
const PAGE_TEXT_MAX = 12_000;

export type ResearchEntry<T> = {
    payload: T;
    pages: CachedPage[];
    /** True when this entry records "searched, found nothing". */
    empty: boolean;
};

export interface ResearchStore {
    get(key: string, now: Date): Promise<{ payload: unknown; sources: unknown } | null>;
    put(key: string, kind: string, payload: unknown, sources: unknown, expiresAt: Date): Promise<void>;
}

const prismaStore: ResearchStore = {
    async get(key, now) {
        const row = await prisma.researchCache.findUnique({ where: { key } });
        if (!row || row.expiresAt <= now) return null;
        return { payload: row.payload, sources: row.sources };
    },
    async put(key, kind, payload, sources, expiresAt) {
        const data = {
            kind,
            payload: payload as Prisma.InputJsonValue,
            sources: sources as Prisma.InputJsonValue,
            expiresAt,
        };
        await prisma.researchCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    },
};

let store: ResearchStore = prismaStore;

/** Lowercase slug of a public attribute. Empty input gives 'any'. */
function part(value: string | null | undefined): string {
    const slug = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || 'any';
}

/** `kind:company[:attr…]` built from public attributes only. */
export function researchKey(kind: ResearchKind, company: string, ...attrs: Array<string | null | undefined>): string {
    return [kind, part(canonicalCompanyKey(company)), ...attrs.map(part)].join(':');
}

function readPages(value: unknown): CachedPage[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const page = raw as Record<string, unknown>;
        if (typeof page.url !== 'string' || typeof page.text !== 'string') return [];
        return [{
            url: page.url,
            title: typeof page.title === 'string' ? page.title : null,
            text: page.text,
            publishedAt: typeof page.publishedAt === 'string' ? page.publishedAt : null,
        }];
    });
}

/**
 * Read a live entry and register its pages into the step's sources.
 * Returns null on a miss, or when the store is unreachable (a cache outage
 * degrades to a search, never to a failed section).
 */
export async function readResearch<T>(
    step: Pick<StepContext, 'sources' | 'log'>,
    key: string,
    now: Date = new Date(),
): Promise<ResearchEntry<T> | null> {
    let row: { payload: unknown; sources: unknown } | null;
    try {
        row = await store.get(key, now);
    } catch (error) {
        step.log('research cache read failed', { key, error: String(error) });
        return null;
    }
    if (!row) return null;

    const pages = readPages(row.sources);
    for (const page of pages) {
        step.sources.add({ url: page.url, title: page.title, text: page.text, publishedAt: page.publishedAt });
    }
    const payload = row.payload as { value?: T; empty?: boolean } | null;
    return { payload: (payload?.value ?? null) as T, pages, empty: payload?.empty === true };
}

export async function writeResearch<T>(params: {
    key: string;
    kind: ResearchKind;
    value: T;
    pages: CachedPage[];
    empty?: boolean;
    now?: Date;
    step?: Pick<StepContext, 'log'>;
}): Promise<void> {
    const now = params.now ?? new Date();
    const days = params.empty ? TTL_DAYS.empty : TTL_DAYS[params.kind];
    const pages = dedupePages(params.pages).map((page) => ({ ...page, text: page.text.slice(0, PAGE_TEXT_MAX) }));
    try {
        await store.put(
            params.key,
            params.kind,
            { value: params.value, empty: params.empty === true },
            pages,
            new Date(now.getTime() + days * 86_400_000),
        );
    } catch (error) {
        // The answer is already computed; failing to cache it must not lose it.
        params.step?.log('research cache write failed', { key: params.key, error: String(error) });
    }
}

function dedupePages(pages: CachedPage[]): CachedPage[] {
    const seen = new Map<string, CachedPage>();
    for (const page of pages) if (!seen.has(page.url)) seen.set(page.url, page);
    return [...seen.values()];
}

/** In-memory store for tests. */
export function createMemoryStore(): ResearchStore & { rows: Map<string, { payload: unknown; sources: unknown; expiresAt: Date }> } {
    const rows = new Map<string, { payload: unknown; sources: unknown; expiresAt: Date }>();
    return {
        rows,
        async get(key, now) {
            const row = rows.get(key);
            return row && row.expiresAt > now ? { payload: row.payload, sources: row.sources } : null;
        },
        async put(key, _kind, payload, sources, expiresAt) {
            rows.set(key, { payload: JSON.parse(JSON.stringify(payload)), sources: JSON.parse(JSON.stringify(sources)), expiresAt });
        },
    };
}

export const __testing = {
    setStore(next: ResearchStore | null) {
        store = next ?? prismaStore;
    },
};
