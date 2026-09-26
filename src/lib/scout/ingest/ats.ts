/**
 * Single-job reads from public ATS APIs, and a generic web reader.
 *
 * Greenhouse and Lever expose one posting by id; Ashby only exposes the whole
 * board, so we read it and pick the job (one request either way, and the
 * board JSON is what `radar/boards.ts` already reads). Workday and everything
 * else go through the generic reader, which prefers JSON-LD `JobPosting` —
 * most career sites emit it for Google Jobs — and falls back to main text.
 */

import { BOT_USER_AGENT } from '@/lib/radar/boards';
import type { AtsRef } from '@/lib/scout/ingest/url';
import { safeFetch, type SafeFetchOptions } from '@/lib/scout/ingest/fetch';
import {
    htmlToText,
    jsonLdObjects,
    mainText,
    metaContent,
    stringField,
    tidyText,
    titleOf,
    typeOf,
} from '@/lib/scout/ingest/html';
import type { ParsedPage } from '@/lib/scout/ingest/linkedin';

export type AtsFetchResult =
    | { ok: true; page: ParsedPage & { ok: true }; apiUrl: string; canonicalUrl: string }
    | { ok: false; reason: string };

function jobPage(params: {
    title: string;
    company: string | null;
    location: string | null;
    postedAt: string | null;
    bodyText: string;
    extra?: string[];
}): ParsedPage & { ok: true } {
    const header = [
        params.title,
        [params.company, params.location].filter(Boolean).join(' · '),
        ...(params.extra ?? []),
    ].filter(Boolean).join('\n');
    return {
        ok: true,
        data: {
            title: params.title,
            author: null,
            authorUrl: null,
            companyName: params.company,
            location: params.location,
            postedAt: params.postedAt,
            applicantsText: null,
            text: tidyText(`${header}\n\n${params.bodyText}`),
        },
    };
}

async function getJson(url: string, options: SafeFetchOptions): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
    const res = await safeFetch(url, { ...options, accept: 'application/json', userAgent: BOT_USER_AGENT });
    if (!res.ok) {
        return {
            ok: false,
            reason: res.status === 404 ? 'This posting is no longer on the company’s job board.' : `Could not read the job board (${res.message}).`,
        };
    }
    try {
        return { ok: true, json: JSON.parse(res.body) };
    } catch {
        return { ok: false, reason: 'The job board answered with something that is not a job.' };
    }
}

function titleCaseSlug(slug: string): string {
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function iso(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchAtsJob(ref: AtsRef, pageUrl: string, options: SafeFetchOptions): Promise<AtsFetchResult> {
    switch (ref.provider) {
        case 'greenhouse': {
            const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.boardToken)}/jobs/${encodeURIComponent(ref.jobId)}?content=true`;
            const res = await getJson(apiUrl, options);
            if (!res.ok) return res;
            const job = res.json as {
                title?: string;
                content?: string;
                absolute_url?: string;
                first_published?: string;
                updated_at?: string;
                location?: { name?: string };
                company_name?: string;
            };
            if (!job.title) return { ok: false, reason: 'The job board returned no posting for this link.' };
            // Greenhouse escapes the whole body (`&lt;p&gt;`): unescape the
            // markup once, then render it as text.
            const body = htmlToText(unescapeMarkup(job.content ?? ''));
            return {
                ok: true,
                apiUrl,
                canonicalUrl: job.absolute_url || pageUrl,
                page: jobPage({
                    title: job.title,
                    company: job.company_name ?? titleCaseSlug(ref.boardToken),
                    location: job.location?.name ?? null,
                    postedAt: iso(job.first_published ?? job.updated_at),
                    bodyText: body,
                }),
            };
        }
        case 'lever': {
            const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(ref.company)}/${encodeURIComponent(ref.postingId)}`;
            const res = await getJson(apiUrl, options);
            if (!res.ok) return res;
            const job = res.json as {
                text?: string;
                hostedUrl?: string;
                createdAt?: number;
                descriptionPlain?: string;
                description?: string;
                additionalPlain?: string;
                lists?: { text?: string; content?: string }[];
                categories?: { location?: string; commitment?: string; team?: string };
                workplaceType?: string;
            };
            if (!job.text) return { ok: false, reason: 'The job board returned no posting for this link.' };
            const lists = (job.lists ?? [])
                .map((list) => `${list.text ?? ''}\n${htmlToText(list.content ?? '')}`)
                .join('\n\n');
            const body = [job.descriptionPlain ?? htmlToText(job.description ?? ''), lists, job.additionalPlain ?? '']
                .filter(Boolean)
                .join('\n\n');
            return {
                ok: true,
                apiUrl,
                canonicalUrl: job.hostedUrl || pageUrl,
                page: jobPage({
                    title: job.text,
                    company: titleCaseSlug(ref.company),
                    location: job.categories?.location ?? null,
                    postedAt: iso(job.createdAt),
                    bodyText: body,
                    extra: [
                        job.categories?.commitment ? `Employment type: ${job.categories.commitment}` : null,
                        job.workplaceType && job.workplaceType !== 'unspecified' ? `Workplace: ${job.workplaceType}` : null,
                    ].filter((line): line is string => Boolean(line)),
                }),
            };
        }
        case 'ashby': {
            const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.boardToken)}?includeCompensation=true`;
            const res = await getJson(apiUrl, options);
            if (!res.ok) return res;
            const board = res.json as {
                jobs?: {
                    id?: string;
                    title?: string;
                    location?: string;
                    jobUrl?: string;
                    publishedAt?: string;
                    descriptionPlain?: string;
                    descriptionHtml?: string;
                    employmentType?: string;
                    isRemote?: boolean;
                    workplaceType?: string;
                    compensation?: { scrapeableCompensationSalarySummary?: string | null; compensationTierSummary?: string | null };
                }[];
            };
            const job = (board.jobs ?? []).find((entry) => entry.id === ref.jobId);
            if (!job?.title) return { ok: false, reason: 'This posting is no longer on the company’s job board.' };
            const pay = job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? null;
            return {
                ok: true,
                apiUrl,
                canonicalUrl: job.jobUrl || pageUrl,
                page: jobPage({
                    title: job.title,
                    company: titleCaseSlug(ref.boardToken),
                    location: job.location ?? null,
                    postedAt: iso(job.publishedAt),
                    bodyText: job.descriptionPlain ?? htmlToText(job.descriptionHtml ?? ''),
                    extra: [
                        job.employmentType ? `Employment type: ${job.employmentType}` : null,
                        job.workplaceType ? `Workplace: ${job.workplaceType}` : job.isRemote ? 'Workplace: Remote' : null,
                        pay ? `Compensation: ${pay}` : null,
                    ].filter((line): line is string => Boolean(line)),
                }),
            };
        }
        case 'workday':
            return { ok: false, reason: 'workday_generic' };
    }
}

function unescapeMarkup(escaped: string): string {
    // `&lt;p&gt;` → `<p>`; htmlToText then strips it. `&amp;` last, and once:
    // decoding again would turn literal `&lt;` text into a tag.
    return escaped
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&');
}

// ───────────────────────────────────────────────────────────── generic web

function orgName(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (value && typeof value === 'object') return stringField(value as Record<string, unknown>, 'name');
    return null;
}

function jobLocation(value: unknown): string | null {
    const entries = Array.isArray(value) ? value : [value];
    const parts: string[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const address = (entry as Record<string, unknown>).address;
        if (!address || typeof address !== 'object') continue;
        const a = address as Record<string, unknown>;
        const text = [stringField(a, 'addressLocality'), stringField(a, 'addressRegion'), stringField(a, 'addressCountry')]
            .filter(Boolean)
            .join(', ');
        if (text) parts.push(text);
    }
    return parts.length ? [...new Set(parts)].join(' · ') : null;
}

/**
 * Any web page: JSON-LD `JobPosting` first (it is structured and complete),
 * then JSON-LD articles, then the page's main text.
 */
export function parseGenericPage(html: string): ParsedPage {
    const records = jsonLdObjects(html);
    const posting = records.find((record) => typeOf(record).includes('JobPosting'));
    if (posting) {
        const title = stringField(posting, 'title') ?? stringField(posting, 'name');
        const description = stringField(posting, 'description');
        if (title && description) {
            const workplace = stringField(posting, 'jobLocationType') === 'TELECOMMUTE' ? 'Workplace: Remote' : null;
            const employment = posting.employmentType
                ? `Employment type: ${Array.isArray(posting.employmentType) ? posting.employmentType.join(', ') : String(posting.employmentType)}`
                : null;
            return jobPage({
                title,
                company: orgName(posting.hiringOrganization),
                location: jobLocation(posting.jobLocation),
                postedAt: iso(posting.datePosted),
                bodyText: htmlToText(description.includes('&lt;') ? unescapeMarkup(description) : description),
                extra: [employment, workplace].filter((line): line is string => Boolean(line)),
            });
        }
    }

    const article = records.find((record) => typeOf(record).some((type) => /Article|Posting/.test(type)));
    const articleBody = article ? stringField(article, 'articleBody') : null;
    const title = metaContent(html, 'og:title') ?? titleOf(html);
    const text = articleBody ? tidyText(articleBody) : mainText(html);
    if (text.length < 80) return { ok: false, reason: 'That page has almost no readable text. Paste the content instead.' };
    return {
        ok: true,
        data: {
            title,
            author: article ? orgName(article.author) : null,
            authorUrl: null,
            // og:site_name is the publisher (a blog, a news site), not the
            // company a post is about; classify extracts that from the text.
            companyName: null,
            location: null,
            postedAt: article ? iso(article.datePublished) : null,
            applicantsText: null,
            text,
        },
    };
}
