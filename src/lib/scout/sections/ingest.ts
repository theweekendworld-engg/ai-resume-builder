/**
 * Section 1: read the link (or take the text the user gave us).
 *
 * Provided text always wins over fetching. Text arrives two ways: pasted by
 * the user, or read by the extension from the page in the user's own
 * logged-in tab — the one reliable way to see a LinkedIn post that the
 * logged-out page hides. Either way it is exactly what the user was looking
 * at, which no server-side fetch can promise.
 *
 * No model call here. Every page read is registered as a source so later
 * sections can cite it.
 */

import { capText, ingestUrl } from '@/lib/scout/ingest';
import type { SafeFetchOptions } from '@/lib/scout/ingest/fetch';
import { tidyText } from '@/lib/scout/ingest/html';
import { classifyUrl } from '@/lib/scout/ingest/url';
import type { ScoutSection } from '@/lib/scout/section';
import type { IngestData } from '@/lib/scout/types';

let fetchOverrides: Pick<SafeFetchOptions, 'fetchImpl' | 'resolve'> = {};

/** Test seam: route ingest's network through a fake. */
export const __testing = {
    setFetch(overrides: Pick<SafeFetchOptions, 'fetchImpl' | 'resolve'>) {
        fetchOverrides = overrides;
    },
    reset() {
        fetchOverrides = {};
    },
};

function firstLine(text: string): string | null {
    const line = text.split('\n').map((entry) => entry.trim()).find(Boolean);
    return line ? line.slice(0, 160) : null;
}

export const ingestSection: ScoutSection<'ingest'> = async (ctx) => {
    const url = ctx.input.url?.trim() || null;
    const provided = ctx.input.text ? tidyText(ctx.input.text) : '';

    if (provided) {
        const classified = url ? classifyUrl(url) : null;
        const capped = capText(provided);
        const data: IngestData = {
            sourceUrl: classified?.url.toString() ?? null,
            linkKind: classified?.linkKind ?? 'text',
            fetchVia: ctx.input.source === 'extension' ? 'extension' : 'provided_text',
            title: ctx.input.title?.trim() || firstLine(provided),
            // Only the extension supplies these, read from the page itself.
            author: ctx.input.author?.trim() || null,
            authorUrl: ctx.input.authorUrl?.trim() || null,
            companyName: null,
            location: null,
            postedAt: null,
            applicantsText: null,
            text: capped.text,
            truncated: capped.truncated,
        };
        // Extension text IS that page, read in the user's tab: cite it as
        // such. Pasted text beside a link may not be that page, so it is
        // not registered under the link.
        if (data.sourceUrl && data.fetchVia === 'extension') {
            ctx.step.sources.add({ url: data.sourceUrl, title: data.title, text: provided });
        }
        return { status: 'ok', data };
    }

    if (!url) return { status: 'unavailable', reason: 'Share a link or paste the post text.' };

    const outcome = await ingestUrl(url, { signal: ctx.step.signal, ...fetchOverrides });
    if (!outcome.ok) return { status: 'unavailable', reason: outcome.reason };

    for (const page of outcome.pages) {
        ctx.step.sources.add({ url: page.url, title: page.title, text: page.text, publishedAt: page.publishedAt });
    }
    ctx.step.log('read', { linkKind: outcome.data.linkKind, chars: outcome.data.text.length });
    return { status: 'ok', data: outcome.data };
};
