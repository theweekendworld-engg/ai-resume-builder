/**
 * "Send to Patronus": turn the current tab into a Scout input.
 *
 * The extension exists for this because it reads LinkedIn in the user's own
 * logged-in tab. The server's logged-out fetch works for job pages (the guest
 * job endpoint) but not reliably for posts, and a login wall is precisely
 * where this path does not break.
 *
 * Three rules, each from a way this goes wrong:
 *
 * 1. **One post, not the feed.** On `/feed/` the page holds dozens of posts.
 *    We send the one the user means: the post an anchor element sits in when
 *    we have one, else the post most visible in the viewport — which is the
 *    one they were reading when they clicked.
 * 2. **The permalink, not the page URL.** Every feed post lives at `/feed/`.
 *    Sent as the URL, that would dedupe every post a user ever shares into a
 *    single Scout run. The post's URN gives a real permalink; when there is
 *    none we send no URL, and the server keys the run on the text instead.
 * 3. **Selectors first, density second.** LinkedIn renames classes. The
 *    selectors live in `linkedinSelectors.ts`; when all of them miss, a
 *    text-density scan still finds the body rather than returning nothing.
 */

import { reduceDom } from './domReducer';
import { extractJobDescription, extractJobMetadata } from './jdExtractor';
import {
    ARTICLE_BODY_SELECTORS,
    ARTICLE_TITLE_SELECTORS,
    NOISE_SELECTORS,
    POST_AUTHOR_LINK_SELECTORS,
    POST_AUTHOR_SELECTORS,
    POST_CONTAINER_SELECTORS,
    POST_TEXT_SELECTORS,
    POST_URN_ATTRIBUTES,
} from './linkedinSelectors';

export type ScoutKindHint = 'linkedin_post' | 'linkedin_job' | 'linkedin_article' | 'job_page' | 'page';

export type ScoutExtractionMethod =
    | 'post_selector'
    | 'post_density'
    | 'article'
    | 'job_description'
    | 'density'
    | 'body';

export type ScoutExtraction = {
    /** Permalink or page URL; null when it would be ambiguous (a feed with no URN). */
    url: string | null;
    /** Where the user actually was. Diagnostic only; never the dedupe key. */
    pageUrl: string;
    title: string | null;
    text: string;
    author: string | null;
    authorUrl: string | null;
    kindHint: ScoutKindHint;
    method: ScoutExtractionMethod;
};

/** The server caps text at 100k characters. */
export const SCOUT_TEXT_MAX = 100_000;
/** Below this there is no post to analyse — likely a login wall or an empty page. */
export const SCOUT_TEXT_MIN = 40;

// ───────────────────────────────────────────────────────────────── urls

export type LinkedinPageKind = 'post' | 'feed' | 'job' | 'article' | 'other';

export function linkedinPageKind(href: string): LinkedinPageKind {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return 'other';
    }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return 'other';
    const path = url.pathname;
    if (/^\/jobs\/view\//.test(path) || url.searchParams.has('currentJobId')) return 'job';
    if (/^\/(feed\/update|posts)\//.test(path)) return 'post';
    if (/^\/pulse\//.test(path)) return 'article';
    if (/^\/feed\/?$/.test(path) || /\/recent-activity\//.test(path) || /^\/company\/[^/]+\/posts/.test(path)) return 'feed';
    return 'other';
}

/** `https://www.linkedin.com/jobs/view/<id>/` for any of LinkedIn's job URL shapes. */
export function canonicalLinkedinJobUrl(href: string): string | null {
    try {
        const url = new URL(href);
        const current = url.searchParams.get('currentJobId');
        if (current && /^\d{6,}$/.test(current)) return `https://www.linkedin.com/jobs/view/${current}/`;
        const view = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/);
        return view ? `https://www.linkedin.com/jobs/view/${view[1]}/` : null;
    } catch {
        return null;
    }
}

/** `urn:li:activity:123` → its public permalink. */
export function permalinkForUrn(urn: string): string | null {
    const match = urn.match(/urn:li:(activity|share|ugcPost):\d+/);
    return match ? `https://www.linkedin.com/feed/update/${match[0]}/` : null;
}

/** Page URL without the tracking query LinkedIn appends to shared links. */
export function stripTracking(href: string): string {
    try {
        const url = new URL(href);
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|trk|ref|refId|trackingId|lipi|originalSubdomain|rcm)/i.test(key)) url.searchParams.delete(key);
        }
        return url.toString();
    } catch {
        return href;
    }
}

// ───────────────────────────────────────────────────────────────── text

const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'UL', 'OL', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE',
]);

/**
 * Text with line breaks kept. `innerText` would do this in a browser, but it
 * is layout-dependent (a `display:none` "see more" remainder vanishes from it)
 * and absent in test DOMs; walking `textContent` with block boundaries gives
 * the whole post regardless of how LinkedIn has clamped it on screen.
 */
export function blockText(root: Element): string {
    const parts: string[] = [];
    const walk = (node: Node) => {
        if (node.nodeType === 3) {
            parts.push(node.textContent ?? '');
            return;
        }
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'BUTTON') return;
        // LinkedIn repeats every name and label in a screen-reader-only span
        // beside the visible one; reading both doubles them.
        if (el.classList.contains('visually-hidden')) return;
        const block = BLOCK_TAGS.has(el.tagName);
        if (block) parts.push('\n');
        for (const child of Array.from(el.childNodes)) walk(child);
        if (block) parts.push('\n');
    };
    walk(root);
    return cleanPostText(parts.join(''));
}

/** Strip LinkedIn's inline chrome from post text. */
export function cleanPostText(raw: string): string {
    return raw
        .replace(/ /g, ' ')
        .replace(/…\s*see more/gi, '')
        .replace(/\bsee (more|less)\b\s*$/gim, '')
        // Hashtags render as "hashtag" + "#tag"; keep only the tag.
        .replace(/\bhashtag\s*\n?\s*#/gi, '#')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, SCOUT_TEXT_MAX);
}

function firstMatch(root: ParentNode, selectors: readonly string[]): Element | null {
    for (const selector of selectors) {
        try {
            const found = root.querySelector(selector);
            if (found) return found;
        } catch {
            // An invalid selector in a future edit must not break extraction.
        }
    }
    return null;
}

function allMatches(root: ParentNode, selectors: readonly string[]): Element[] {
    const out: Element[] = [];
    const seen = new Set<Element>();
    for (const selector of selectors) {
        let found: Element[] = [];
        try {
            found = Array.from(root.querySelectorAll(selector));
        } catch {
            continue;
        }
        for (const el of found) {
            if (!seen.has(el)) {
                seen.add(el);
                out.push(el);
            }
        }
    }
    return out;
}

function isNoise(el: Element): boolean {
    return NOISE_SELECTORS.some((selector) => {
        try {
            return Boolean(el.closest(selector));
        } catch {
            return false;
        }
    });
}

function linkTextLength(el: Element): number {
    return Array.from(el.querySelectorAll('a')).reduce((sum, a) => sum + (a.textContent?.trim().length ?? 0), 0);
}

/**
 * The tightest element holding most of the readable text.
 *
 * Start at `root` and keep descending into the child that holds at least 80%
 * of the text, skipping navigation and link-heavy blocks. Where no single
 * child dominates, the text is spread across siblings — that element is the
 * body. Cheap, layout-free, and robust to class renames.
 */
export function densestTextBlock(root: Element): Element | null {
    const textLen = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    const usable = (el: Element) => !isNoise(el) && textLen(el) > 0 && linkTextLength(el) / Math.max(1, textLen(el)) < 0.5;

    if (!usable(root) && root !== document.body) return null;
    let current = root;
    for (let depth = 0; depth < 40; depth += 1) {
        const total = textLen(current);
        const children = Array.from(current.children).filter(usable);
        const dominant = children.find((child) => textLen(child) >= total * 0.8);
        if (!dominant) break;
        current = dominant;
    }
    return textLen(current) >= SCOUT_TEXT_MIN ? current : null;
}

// ───────────────────────────────────────────────────────────────── posts

function postContainers(): Element[] {
    const all = allMatches(document, POST_CONTAINER_SELECTORS);
    // Outermost only: a reshare nests the original post inside the resharer's,
    // and the outer one carries both the commentary and the original.
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

function containerOf(anchor: Element): Element | null {
    const containers = postContainers();
    return containers.find((container) => container.contains(anchor)) ?? null;
}

/** The container with the most visible height in the viewport; ties go to the nearest the centre. */
function mostVisible(containers: Element[]): Element | null {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const centre = viewportHeight / 2;
    let best: { el: Element; visible: number; distance: number } | null = null;
    for (const el of containers) {
        const rect = el.getBoundingClientRect();
        const visible = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const distance = Math.abs((rect.top + rect.bottom) / 2 - centre);
        if (
            !best
            || visible > best.visible
            || (visible === best.visible && distance < best.distance)
        ) {
            best = { el, visible, distance };
        }
    }
    return best?.el ?? null;
}

function urnOf(container: Element): string | null {
    const carriers = [container, ...Array.from(container.querySelectorAll(POST_URN_ATTRIBUTES.map((a) => `[${a}]`).join(',')))];
    for (const el of carriers) {
        for (const attribute of POST_URN_ATTRIBUTES) {
            const value = el.getAttribute(attribute);
            if (value && /urn:li:(activity|share|ugcPost):\d+/.test(value)) return value;
        }
    }
    return null;
}

function authorOf(container: Element): { author: string | null; authorUrl: string | null } {
    const nameEl = firstMatch(container, POST_AUTHOR_SELECTORS);
    const author = nameEl ? cleanPostText(nameEl.textContent ?? '').split('\n')[0] || null : null;
    const linkEl = firstMatch(container, POST_AUTHOR_LINK_SELECTORS) as HTMLAnchorElement | null;
    let authorUrl: string | null = null;
    if (linkEl?.getAttribute('href')) {
        try {
            authorUrl = stripTracking(new URL(linkEl.getAttribute('href') as string, window.location.href).toString());
        } catch {
            authorUrl = null;
        }
    }
    return { author, authorUrl };
}

function postText(container: Element): { text: string; method: ScoutExtractionMethod } {
    const blocks = allMatches(container, POST_TEXT_SELECTORS)
        // Outermost text blocks only, so nested selector hits are not doubled.
        .filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
    const texts = [...new Set(blocks.map(blockText).filter(Boolean))];
    if (texts.join('').length >= SCOUT_TEXT_MIN) return { text: texts.join('\n\n'), method: 'post_selector' };

    const dense = densestTextBlock(container);
    if (dense) return { text: blockText(dense), method: 'post_density' };
    return { text: blockText(container), method: 'post_density' };
}

function pageTitle(): string | null {
    const title = (document.title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    return title || null;
}

function extractPost(anchor: Element | null | undefined, pageKind: LinkedinPageKind): ScoutExtraction | null {
    const containers = postContainers();
    const container = (anchor ? containerOf(anchor) : null)
        ?? (containers.length === 1 ? containers[0] : mostVisible(containers));
    if (!container) return null;

    const { text, method } = postText(container);
    if (text.length < SCOUT_TEXT_MIN) return null;

    const urn = urnOf(container);
    const pageUrl = window.location.href;
    const url = (urn ? permalinkForUrn(urn) : null)
        // A permalink page's own URL is unambiguous; a feed's is not (rule 2).
        ?? (pageKind === 'post' ? stripTracking(pageUrl) : null);
    const { author, authorUrl } = authorOf(container);

    return {
        url,
        pageUrl,
        title: author ? `${author} on LinkedIn` : pageTitle(),
        text,
        author,
        authorUrl,
        kindHint: 'linkedin_post',
        method,
    };
}

function extractArticle(): ScoutExtraction | null {
    const body = firstMatch(document, ARTICLE_BODY_SELECTORS) ?? densestTextBlock(document.body);
    if (!body) return null;
    const text = blockText(body);
    if (text.length < SCOUT_TEXT_MIN) return null;
    const titleEl = firstMatch(document, ARTICLE_TITLE_SELECTORS);
    return {
        url: stripTracking(window.location.href),
        pageUrl: window.location.href,
        title: titleEl ? cleanPostText(titleEl.textContent ?? '') || pageTitle() : pageTitle(),
        text,
        author: null,
        authorUrl: null,
        kindHint: 'linkedin_article',
        method: 'article',
    };
}

function extractJob(isLinkedin: boolean): ScoutExtraction | null {
    const jd = extractJobDescription(reduceDom());
    if (!jd || jd.text.length < SCOUT_TEXT_MIN || jd.confidenceBand === 'low') return null;
    const meta = extractJobMetadata(jd);
    const pageUrl = window.location.href;
    const roleAtCompany = meta.roleTitle && meta.companyName
        ? `${meta.roleTitle} at ${meta.companyName}`
        : meta.roleTitle || pageTitle();
    return {
        url: (isLinkedin ? canonicalLinkedinJobUrl(pageUrl) : null) ?? stripTracking(pageUrl),
        pageUrl,
        title: roleAtCompany || null,
        text: jd.text.slice(0, SCOUT_TEXT_MAX),
        author: null,
        authorUrl: null,
        kindHint: isLinkedin ? 'linkedin_job' : 'job_page',
        method: 'job_description',
    };
}

/**
 * Extract the current tab for Scout. Never throws; returns null only when the
 * page has nothing readable (a login wall, an empty SPA shell).
 */
export function extractForScout(options: { anchor?: Element | null } = {}): ScoutExtraction | null {
    const pageUrl = window.location.href;
    const pageKind = linkedinPageKind(pageUrl);
    const isLinkedin = pageKind !== 'other' || /(^|\.)linkedin\.com$/i.test(window.location.hostname);

    try {
        if (pageKind === 'job') {
            const job = extractJob(true);
            if (job) return job;
        }
        if (pageKind === 'article') {
            const article = extractArticle();
            if (article) return article;
        }
        if (pageKind === 'post' || pageKind === 'feed' || (isLinkedin && options.anchor)) {
            const post = extractPost(options.anchor, pageKind);
            if (post) return post;
        }
        if (!isLinkedin) {
            const job = extractJob(false);
            if (job) return job;
        }
        if (isLinkedin && pageKind !== 'job') {
            // An unrecognised LinkedIn page that still renders posts.
            const post = extractPost(options.anchor, pageKind);
            if (post) return post;
        }

        const dense = densestTextBlock(document.body);
        const text = dense ? blockText(dense) : blockText(document.body);
        if (text.length < SCOUT_TEXT_MIN) return null;
        return {
            // A feed URL identifies nothing; any other page URL is fine.
            url: pageKind === 'feed' ? null : stripTracking(pageUrl),
            pageUrl,
            title: pageTitle(),
            text,
            author: null,
            authorUrl: null,
            kindHint: 'page',
            method: dense ? 'density' : 'body',
        };
    } catch (error) {
        console.warn('[patronus] scout extraction failed', error);
        return null;
    }
}
