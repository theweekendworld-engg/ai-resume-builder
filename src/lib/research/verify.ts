/**
 * Code-side checks every research claim must pass before a user sees it.
 *
 * The model reads numbered results and answers by INDEX; it never writes a
 * URL. These functions then decide, without the model, whether its answer
 * stands:
 *
 *   - `resolvePick` maps an index back to a result and rejects out-of-range
 *     indexes (the model's only way to invent a source).
 *   - `quotedIn` requires a quoted value to actually appear on that page.
 *   - `numbersSupported` runs the numeric guard against THAT page only, not
 *     against the whole run — "₹45 LPA" is supported by the page that says
 *     it, not by some other page that happens to mention 45.
 *
 * Everything that fails is dropped and counted, never repaired.
 */

import { checkNumericGuard } from '@/lib/ai/guard';
import { canonicalUrl } from '@/lib/agent/sources';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';
import type { SearchResult } from '@/lib/research/types';
import { pageText } from '@/lib/research/search';
import type { CachedPage } from '@/lib/research/cache';

/** Loose text normal form: case, width, dashes, currency spacing, whitespace. */
export function looseNormalize(value: string): string {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[‐-―−]/g, '-')
        .replace(/[‘’“”"'`*_]/g, '')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A quoted value must appear verbatim (after loose normalization) on its page. */
export function quotedIn(value: string, page: string): boolean {
    const needle = looseNormalize(value);
    if (needle.length < 2) return false;
    return looseNormalize(page).includes(needle);
}

/** Every quantity in `texts` must be present on `page`. */
export function numbersSupported(texts: string[], page: string): boolean {
    const data = { t: texts };
    return checkNumericGuard(data, { sourceText: page, fields: ['t'] }).ok;
}

/** The page is about this company — its distinctive name appears on it. */
export function mentionsCompany(page: string, company: string): boolean {
    const key = canonicalCompanyKey(company);
    if (!key) return false;
    const haystack = ` ${canonicalCompanyKey(page)} `;
    return haystack.includes(` ${key} `);
}

/** 1-based index → result, or null when the model pointed at nothing. */
export function resolvePick(results: readonly SearchResult[], index: number): SearchResult | null {
    if (!Number.isInteger(index) || index < 1 || index > results.length) return null;
    return results[index - 1];
}

/** Results as the model sees them: numbered, host, date, bounded excerpt. */
export function numberedResults(results: readonly SearchResult[], excerptChars = 1_500): string {
    return results
        .map((result, i) => {
            let host = '';
            try {
                host = new URL(result.url).hostname.replace(/^www\./, '');
            } catch {
                host = 'unknown';
            }
            const date = result.publishedDate ? ` · ${result.publishedDate.slice(0, 10)}` : '';
            const excerpt = pageText(result).replace(/\s+/g, ' ').slice(0, excerptChars);
            return `[${i + 1}] ${result.title} (${host}${date})\n${excerpt}`;
        })
        .join('\n\n');
}

/** Dedupe results by canonical URL, keeping the first (highest-ranked). */
export function dedupeResults(results: readonly SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const result of results) {
        const key = canonicalUrl(result.url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(result);
    }
    return out;
}

/** Cached pages → results, so cached and fresh claims share one verifier. */
export function pagesAsResults(pages: readonly CachedPage[]): SearchResult[] {
    return pages.map((page) => ({
        url: page.url,
        title: page.title ?? page.url,
        content: page.text,
        rawContent: null,
        publishedDate: page.publishedAt,
        score: 0,
    }));
}

export function toCachedPage(result: SearchResult): CachedPage {
    return { url: result.url, title: result.title, text: pageText(result), publishedAt: result.publishedDate };
}

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}
