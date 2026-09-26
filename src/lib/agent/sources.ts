/**
 * The set of external pages one run actually read.
 *
 * This is the enforcement point for "every external fact carries a source the
 * run fetched" (docs/impl/06-scout-agent.md §2 rule 2). A model can write a
 * URL; it cannot make that URL appear here, because only fetch/search code
 * calls `add`. So:
 *
 *   - `keepCited` drops any item whose URL is not in the set. A hallucinated
 *     Reddit thread disappears rather than shipping as a dead link.
 *   - `guardFor` builds the numeric guard's source text from exactly the pages
 *     an item cites. "$45 LPA" survives only if that string is on that page —
 *     not on some other page in the run, which is what a single concatenated
 *     source would allow.
 */

import type { NumericGuard } from '@/lib/ai/guard';

export type SourceRef = {
    url: string;
    title: string | null;
    /** ISO-8601. When we read it, which is what we can vouch for. */
    fetchedAt: string;
    /** Publication date when the source states one. */
    publishedAt?: string | null;
};

type Entry = SourceRef & { text: string };

/** Lowercased host+path, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(raw: string): string {
    try {
        const url = new URL(raw.trim());
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|trk|ref|refId|trackingId|lipi|originalSubdomain)/i.test(key)) {
                url.searchParams.delete(key);
            }
        }
        const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|in\.)/, '');
        const path = url.pathname.replace(/\/+$/, '');
        const query = url.searchParams.toString();
        return `${host}${path}${query ? `?${query}` : ''}`;
    } catch {
        return raw.trim().toLowerCase();
    }
}

export class SourceSet {
    private readonly entries = new Map<string, Entry>();

    add(source: { url: string; title?: string | null; text: string; publishedAt?: string | null; fetchedAt?: Date }): SourceRef {
        const key = canonicalUrl(source.url);
        const existing = this.entries.get(key);
        const entry: Entry = {
            url: source.url,
            title: source.title ?? existing?.title ?? null,
            text: existing ? `${existing.text}\n${source.text}` : source.text,
            fetchedAt: (source.fetchedAt ?? new Date()).toISOString(),
            publishedAt: source.publishedAt ?? existing?.publishedAt ?? null,
        };
        this.entries.set(key, entry);
        return this.ref(entry);
    }

    has(url: string): boolean {
        return this.entries.has(canonicalUrl(url));
    }

    get(url: string): SourceRef | null {
        const entry = this.entries.get(canonicalUrl(url));
        return entry ? this.ref(entry) : null;
    }

    text(url: string): string {
        return this.entries.get(canonicalUrl(url))?.text ?? '';
    }

    get size(): number {
        return this.entries.size;
    }

    refs(): SourceRef[] {
        return [...this.entries.values()].map((entry) => this.ref(entry));
    }

    /**
     * Keep only items whose cited URL was read by this run, rewriting each
     * URL to the canonical form we fetched (so the user gets the link we
     * checked, not the model's respelling of it).
     */
    keepCited<T>(items: readonly T[], getUrl: (item: T) => string | null | undefined): { kept: T[]; dropped: T[] } {
        const kept: T[] = [];
        const dropped: T[] = [];
        for (const item of items) {
            const url = getUrl(item);
            if (url && this.has(url)) kept.push(item);
            else dropped.push(item);
        }
        return { kept, dropped };
    }

    /** A numeric guard whose source is exactly the cited pages. */
    guardFor(urls: readonly string[], fields: string[]): NumericGuard {
        const sourceText = [...new Set(urls.map(canonicalUrl))]
            .map((key) => this.entries.get(key)?.text ?? '')
            .join('\n\n');
        return { sourceText, fields };
    }

    private ref(entry: Entry): SourceRef {
        return {
            url: entry.url,
            title: entry.title,
            fetchedAt: entry.fetchedAt,
            publishedAt: entry.publishedAt ?? null,
        };
    }
}
