/**
 * LinkedIn, logged out.
 *
 * Two public surfaces, both verified against live pages on 2026-09-23 (the
 * fixtures beside this file are those pages):
 *
 *   Jobs — `jobs-guest/jobs/api/jobPosting/<id>` is the fragment LinkedIn's
 *   own logged-out job page loads. It carries title, company, location,
 *   posted-ago, applicant count, the full JD and the criteria list.
 *
 *   Posts — `/posts/<slug>` and `/feed/update/urn:li:activity:<id>` render a
 *   `SocialMediaPosting` JSON-LD block with the whole `articleBody` for public
 *   posts. The og:description is the same text cut at ~200 characters, which
 *   is why it is the last resort and not the first.
 *
 * Never with a user's session. Reading LinkedIn as the user from our servers
 * breaks their terms and gets the user's account restricted; when the logged-
 * out page does not have it, the answer is the extension (which reads the page
 * in the user's own tab) or pasting the text.
 */

import {
    htmlToText,
    innerOf,
    jsonLdObjects,
    mainText,
    metaContent,
    stringField,
    tidyText,
    titleOf,
    typeOf,
} from '@/lib/scout/ingest/html';
import type { IngestData } from '@/lib/scout/types';

export const LINKEDIN_GUEST_JOB_URL = (jobId: string) =>
    `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(jobId)}`;

export const LINKEDIN_JOB_VIEW_URL = (jobId: string) =>
    `https://www.linkedin.com/jobs/view/${encodeURIComponent(jobId)}/`;

/** Said once, used wherever the logged-out page is not enough. */
export const LOGIN_WALL_REASON =
    'LinkedIn would not show this without a login. Paste the post text here, or open it in Chrome and use "Send to Patronus" in the extension.';

export type ParsedPage =
    | { ok: true; data: Omit<IngestData, 'linkKind' | 'fetchVia' | 'truncated' | 'sourceUrl'> }
    | { ok: false; reason: string };

function textOfClass(html: string, tag: string, className: string): string | null {
    const open = new RegExp(`<${tag}\\b[^>]*class\\s*=\\s*"[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i');
    const inner = innerOf(html, open, tag);
    if (inner === null) return null;
    const text = htmlToText(inner);
    return text || null;
}

// ─────────────────────────────────────────────────────────────────── jobs

export type LinkedInJobCriteria = Record<string, string>;

function parseCriteria(html: string): LinkedInJobCriteria {
    const out: LinkedInJobCriteria = {};
    const items = html.matchAll(/<li\b[^>]*class\s*=\s*"[^"]*description__job-criteria-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi);
    for (const item of items) {
        const label = textOfClass(item[1], 'h3', 'description__job-criteria-subheader');
        const value = textOfClass(item[1], 'span', 'description__job-criteria-text');
        if (label && value) out[label] = value;
    }
    return out;
}

/**
 * Parse the guest job fragment.
 *
 * The text handed on is a short header (title, company, location, posted,
 * criteria) followed by the JD body. The header is there for the JD reader:
 * "Mid-Senior level" and "Full-time" live in the criteria list, not the body,
 * and a reader that only sees the body cannot extract what is not in it.
 * Posted-ago is kept as LinkedIn phrased it ("1 week ago"); turning it into a
 * date would be a derived figure presented as an observed one.
 */
export function parseLinkedInGuestJob(html: string): ParsedPage {
    const title = textOfClass(html, 'h2', 'top-card-layout__title') ?? textOfClass(html, 'h1', 'top-card-layout__title');
    const body = textOfClass(html, 'div', 'show-more-less-html__markup');
    if (!title || !body) {
        return { ok: false, reason: 'LinkedIn returned this job without its description. It may have been taken down.' };
    }

    const companyLink = /<a\b[^>]*class\s*=\s*"[^"]*topcard__org-name-link[^"]*"[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
    const companyName = companyLink ? htmlToText(companyLink[2]) || null : null;

    // The first bullet flavor that is not the applicant count is the location.
    let location: string | null = null;
    for (const match of html.matchAll(/<span\b[^>]*class\s*=\s*"([^"]*topcard__flavor--bullet[^"]*)"[^>]*>([\s\S]*?)<\/span>/gi)) {
        if (/num-applicants/.test(match[1])) continue;
        location = htmlToText(match[2]) || null;
        if (location) break;
    }

    const postedText = textOfClass(html, 'span', 'posted-time-ago__text');
    const applicantsText = textOfClass(html, 'span', 'num-applicants__caption')
        ?? textOfClass(html, 'figcaption', 'num-applicants__caption');
    const criteria = parseCriteria(html);

    const header = [
        title,
        [companyName, location].filter(Boolean).join(' · '),
        [postedText ? `Posted ${postedText}` : null, applicantsText].filter(Boolean).join(' · '),
        ...Object.entries(criteria).map(([label, value]) => `${label}: ${value}`),
    ].filter(Boolean).join('\n');

    return {
        ok: true,
        data: {
            title,
            author: null,
            authorUrl: null,
            companyName,
            location,
            postedAt: null,
            applicantsText,
            text: tidyText(`${header}\n\n${body}`),
        },
    };
}

// ─────────────────────────────────────────────────────────────────── posts

const POST_TYPES = new Set(['SocialMediaPosting', 'Article', 'NewsArticle', 'BlogPosting', 'DiscussionForumPosting']);

function authorOf(record: Record<string, unknown>): { name: string | null; url: string | null } {
    const raw = record.author;
    const author = Array.isArray(raw) ? raw[0] : raw;
    if (typeof author === 'string') return { name: author.trim() || null, url: null };
    if (author && typeof author === 'object') {
        const entry = author as Record<string, unknown>;
        return { name: stringField(entry, 'name'), url: stringField(entry, 'url') };
    }
    return { name: null, url: null };
}

/** The page is LinkedIn's sign-in wall rather than the thing asked for. */
export function isLoginWall(html: string, finalUrl: string): boolean {
    if (/linkedin\.com\/(authwall|login|checkpoint|signup|uas\/login)/i.test(finalUrl)) return true;
    const title = titleOf(html) ?? '';
    return /^(sign up|sign in|log in|join linkedin|linkedin login)\b/i.test(title) && !/articleBody/.test(html);
}

/** og text LinkedIn cut short: ends in an ellipsis, or is too short to be a post. */
function looksTruncated(text: string): boolean {
    return /(…|\.\.\.)\s*$/.test(text) || text.length < 120;
}

export function parseLinkedInPost(html: string, finalUrl: string): ParsedPage {
    if (isLoginWall(html, finalUrl)) return { ok: false, reason: LOGIN_WALL_REASON };

    const posting = jsonLdObjects(html).find((record) => typeOf(record).some((type) => POST_TYPES.has(type)));
    if (posting) {
        const body = stringField(posting, 'articleBody') ?? stringField(posting, 'text');
        if (body) {
            const author = authorOf(posting);
            const headline = stringField(posting, 'headline') ?? stringField(posting, 'name');
            return {
                ok: true,
                data: {
                    title: headline ? tidyText(headline).split('\n')[0].slice(0, 200) : null,
                    author: author.name,
                    authorUrl: author.url,
                    companyName: null,
                    location: null,
                    postedAt: stringField(posting, 'datePublished'),
                    applicantsText: null,
                    text: tidyText(body),
                },
            };
        }
    }

    // Articles sometimes carry no body in JSON-LD but render it in <article>.
    const article = innerOf(html, /<article\b[^>]*>/i, 'article');
    if (article) {
        const text = htmlToText(article);
        if (text.length >= 400) {
            return {
                ok: true,
                data: {
                    title: metaContent(html, 'og:title') ?? titleOf(html),
                    author: posting ? authorOf(posting).name : null,
                    authorUrl: posting ? authorOf(posting).url : null,
                    companyName: null,
                    location: null,
                    postedAt: posting ? stringField(posting, 'datePublished') : null,
                    applicantsText: null,
                    text,
                },
            };
        }
    }

    const og = metaContent(html, 'og:description') ?? metaContent(html, 'description');
    if (og && !looksTruncated(og)) {
        return {
            ok: true,
            data: {
                title: metaContent(html, 'og:title') ?? titleOf(html),
                author: null,
                authorUrl: null,
                companyName: null,
                location: null,
                postedAt: null,
                applicantsText: null,
                text: og,
            },
        };
    }

    return { ok: false, reason: LOGIN_WALL_REASON };
}

/** Company pages and profiles: we can say what they are, not analyse them. */
export function parseLinkedInGeneric(html: string): ParsedPage {
    const title = metaContent(html, 'og:title') ?? titleOf(html);
    const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
    const text = [description, mainText(html)].filter(Boolean).join('\n\n').slice(0, 8_000);
    if (!title && !text) return { ok: false, reason: LOGIN_WALL_REASON };
    return {
        ok: true,
        data: {
            title,
            author: null,
            authorUrl: null,
            companyName: null,
            location: null,
            postedAt: null,
            applicantsText: null,
            text: tidyText(text),
        },
    };
}
