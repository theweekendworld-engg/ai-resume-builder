/**
 * Link → `IngestData`. Picks the reader for the link kind, and reports every
 * page it read so the section can register them as the run's sources.
 */

import { fetchAtsJob, parseGenericPage } from '@/lib/scout/ingest/ats';
import { safeFetch, type SafeFetchOptions } from '@/lib/scout/ingest/fetch';
import {
    LINKEDIN_GUEST_JOB_URL,
    LINKEDIN_JOB_VIEW_URL,
    LOGIN_WALL_REASON,
    parseLinkedInGeneric,
    parseLinkedInGuestJob,
    parseLinkedInPost,
    type ParsedPage,
} from '@/lib/scout/ingest/linkedin';
import { classifyUrl } from '@/lib/scout/ingest/url';
import type { IngestData } from '@/lib/scout/types';

/** Text handed to later sections is capped: a JD is never this long. */
export const MAX_INGEST_CHARS = 30_000;

export type FetchedPage = { url: string; title: string | null; text: string; publishedAt: string | null };

export type IngestOutcome =
    | { ok: true; data: IngestData; pages: FetchedPage[] }
    | { ok: false; reason: string };

export function capText(text: string): { text: string; truncated: boolean } {
    if (text.length <= MAX_INGEST_CHARS) return { text, truncated: false };
    // Cut at a paragraph boundary when one is near, so a quote never ends mid-word.
    const slice = text.slice(0, MAX_INGEST_CHARS);
    const boundary = slice.lastIndexOf('\n\n');
    return { text: boundary > MAX_INGEST_CHARS * 0.8 ? slice.slice(0, boundary) : slice, truncated: true };
}

function finish(
    page: ParsedPage & { ok: true },
    meta: { sourceUrl: string; linkKind: IngestData['linkKind']; fetchVia: IngestData['fetchVia']; fetchedUrl: string; pageTruncated?: boolean },
): IngestOutcome {
    const capped = capText(page.data.text);
    const data: IngestData = {
        ...page.data,
        sourceUrl: meta.sourceUrl,
        linkKind: meta.linkKind,
        fetchVia: meta.fetchVia,
        text: capped.text,
        truncated: capped.truncated || Boolean(meta.pageTruncated),
    };
    // The source is registered under the URL the user shared as well as the
    // one we fetched, so a later section citing either is recognised.
    const pages: FetchedPage[] = [
        { url: meta.sourceUrl, title: data.title, text: page.data.text, publishedAt: data.postedAt },
    ];
    if (meta.fetchedUrl !== meta.sourceUrl) {
        pages.push({ url: meta.fetchedUrl, title: data.title, text: page.data.text, publishedAt: data.postedAt });
    }
    return { ok: true, data, pages };
}

function unreadable(message: string): string {
    return `Could not read that link: ${message}. Paste the text instead.`;
}

export async function ingestUrl(rawUrl: string, options: SafeFetchOptions = {}): Promise<IngestOutcome> {
    const classified = classifyUrl(rawUrl);
    if (!classified) return { ok: false, reason: 'That does not look like a web link.' };
    const sourceUrl = classified.url.toString();

    switch (classified.linkKind) {
        case 'linkedin_job': {
            const jobId = classified.linkedinJobId!;
            const guestUrl = LINKEDIN_GUEST_JOB_URL(jobId);
            const res = await safeFetch(guestUrl, options);
            if (!res.ok) {
                return {
                    ok: false,
                    reason: res.status === 404
                        ? 'LinkedIn says this job no longer exists.'
                        : unreadable(res.message),
                };
            }
            const page = parseLinkedInGuestJob(res.body);
            if (!page.ok) return page;
            // Cite the job's public page, not the guest API fragment: that is
            // the link a user can open.
            return finish(page, {
                sourceUrl: LINKEDIN_JOB_VIEW_URL(jobId),
                linkKind: 'linkedin_job',
                fetchVia: 'guest_job_api',
                fetchedUrl: sourceUrl,
                pageTruncated: res.truncated,
            });
        }

        case 'linkedin_post':
        case 'linkedin_article': {
            const res = await safeFetch(sourceUrl, options);
            if (!res.ok) {
                return { ok: false, reason: res.status === 404 ? 'LinkedIn says this post no longer exists.' : LOGIN_WALL_REASON };
            }
            const page = parseLinkedInPost(res.body, res.url);
            if (!page.ok) return page;
            return finish(page, { sourceUrl, linkKind: classified.linkKind, fetchVia: 'public_html', fetchedUrl: res.url, pageTruncated: res.truncated });
        }

        case 'linkedin_company':
        case 'linkedin_profile': {
            const res = await safeFetch(sourceUrl, options);
            if (!res.ok) return { ok: false, reason: LOGIN_WALL_REASON };
            const page = parseLinkedInGeneric(res.body);
            if (!page.ok) return page;
            return finish(page, { sourceUrl, linkKind: classified.linkKind, fetchVia: 'public_html', fetchedUrl: res.url, pageTruncated: res.truncated });
        }

        case 'ats_job': {
            const ats = classified.ats!;
            if (ats.provider !== 'workday') {
                const result = await fetchAtsJob(ats, sourceUrl, options);
                if (!result.ok) return result;
                return finish(result.page, {
                    sourceUrl: result.canonicalUrl,
                    linkKind: 'ats_job',
                    fetchVia: 'ats_api',
                    fetchedUrl: sourceUrl,
                });
            }
            const res = await safeFetch(sourceUrl, options);
            if (!res.ok) return { ok: false, reason: unreadable(res.message) };
            const page = parseGenericPage(res.body);
            if (!page.ok) return page;
            return finish(page, { sourceUrl, linkKind: 'ats_job', fetchVia: 'public_html', fetchedUrl: res.url, pageTruncated: res.truncated });
        }

        case 'web': {
            const res = await safeFetch(sourceUrl, options);
            if (!res.ok) return { ok: false, reason: unreadable(res.message) };
            if (res.contentType && !/html|xml|text\/plain/i.test(res.contentType)) {
                return { ok: false, reason: 'That link is not a web page (it looks like a file). Paste the text instead.' };
            }
            const page = /text\/plain/i.test(res.contentType)
                ? ({ ok: true, data: { title: null, author: null, authorUrl: null, companyName: null, location: null, postedAt: null, applicantsText: null, text: res.body } } as const)
                : parseGenericPage(res.body);
            if (!page.ok) return page;
            // A generic page carrying a JobPosting is a job; say so, so
            // classify can take its no-model shortcut.
            const linkKind = /\bJobPosting\b/.test(res.body) && page.data.companyName ? 'ats_job' : 'web';
            return finish(page, { sourceUrl, linkKind, fetchVia: 'public_html', fetchedUrl: res.url, pageTruncated: res.truncated });
        }
    }
}
