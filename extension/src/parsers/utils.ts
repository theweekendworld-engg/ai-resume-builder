// TypeScript port of extension/parsers/utils.js. Behavior preserved 1:1; the
// only structural change is going from an IIFE attaching to window.PatronusParser
// to proper ES module exports. Phase 0's fixture suite is the safety net for
// behavioral parity.

export const POSITIVE_JD_KEYWORDS = [
    'responsibilities',
    'requirements',
    'qualifications',
    'experience',
    'skills',
    'preferred',
    'must have',
    'nice to have',
    'what you will do',
    'what you ll do',
    'about the job',
    'job description',
    'about the role',
    'you will',
] as const;

export const NEGATIVE_JD_KEYWORDS = [
    'recommended jobs',
    'people also viewed',
    'share this job',
    'follow company',
    'sign in',
    'cookie',
    'privacy',
    'terms',
    'chat with us',
    'save job',
] as const;

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function normalizeWhitespace(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeToken(value: unknown): string {
    return normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function readText(node: Element | null | undefined): string {
    if (!node) return '';
    const el = node as HTMLElement;
    return normalizeWhitespace(el.innerText || el.textContent || '');
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function confidenceBand(score: number): ConfidenceBand {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
}

export function uniqueStrings(values: Iterable<string>): string[] {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const value of values) {
        const trimmed = normalizeWhitespace(value);
        const normalized = normalizeToken(trimmed);
        if (!trimmed || !normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(trimmed);
    }

    return output;
}

export function isElementVisible(element: unknown): boolean {
    if (!(element instanceof Element)) return false;
    const htmlElement = element instanceof HTMLElement ? element : null;
    if (!htmlElement) return false;

    if (htmlElement.hidden) return false;
    if (htmlElement.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(htmlElement);
    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
    ) {
        return false;
    }

    const rect = htmlElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;

    return Array.from(htmlElement.children).some((child) => isElementVisible(child));
}

export function isInteractive(element: unknown): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (!isElementVisible(element)) return false;
    if (element.matches('input, textarea, select, button')) return true;
    if (element.getAttribute('role') === 'button') return true;
    if (element.getAttribute('contenteditable') === 'true') return true;
    return false;
}

export function getElementPath(element: unknown): string {
    if (!(element instanceof Element)) return '';
    if (element === document.body) return 'body';
    if (element === document.documentElement) return 'html';

    const parts: string[] = [];
    let current: Element | null = element;
    let depth = 0;

    while (
        current &&
        depth < 6 &&
        current !== document.body &&
        current !== document.documentElement
    ) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
            part += `#${current.id.slice(0, 40)}`;
            parts.unshift(part);
            break;
        }

        const className =
            typeof current.className === 'string'
                ? current.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
        if (className) {
            part += `.${className.slice(0, 60)}`;
        }

        const parent = current.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                (node) => node.tagName === current!.tagName
            );
            if (siblings.length > 1) {
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
        }

        parts.unshift(part);
        current = current.parentElement;
        depth += 1;
    }

    return parts.join(' > ');
}

export function getViewportBias(element: unknown): number {
    if (!(element instanceof HTMLElement)) return 0;
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 1;
    if (rect.bottom < -200 || rect.top > viewportHeight + 600) return 0;
    if (rect.top >= 0 && rect.top <= viewportHeight) return 1;
    return 0.6;
}

export function getNearestHeadingText(element: unknown): string {
    if (!(element instanceof HTMLElement)) return '';

    const directHeading = element.querySelector('h1, h2, h3, h4, legend');
    if (directHeading && isElementVisible(directHeading)) {
        const text = readText(directHeading);
        if (text) return text;
    }

    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
        const siblings = Array.from(current.parentElement?.children ?? []);
        const currentIndex = siblings.indexOf(current);
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const sibling = siblings[index];
            if (!(sibling instanceof HTMLElement) || !isElementVisible(sibling)) continue;
            if (sibling.matches('h1, h2, h3, h4, legend')) {
                const text = readText(sibling);
                if (text) return text;
            }
            const nestedHeading = sibling.querySelector?.('h1, h2, h3, h4, legend');
            if (nestedHeading && isElementVisible(nestedHeading)) {
                const text = readText(nestedHeading);
                if (text) return text;
            }
        }
        current = current.parentElement;
    }

    return '';
}

export function getTextSample(element: Element | null | undefined, maxLength: number): string {
    const text = readText(element);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}...`;
}

export function getKeywordHits(text: string, keywords: readonly string[]): number {
    const normalized = normalizeToken(text);
    return keywords.filter((keyword) => normalized.includes(keyword)).length;
}

export function dedupeLines(text: string): string {
    const output: string[] = [];
    const seen = new Set<string>();

    for (const rawLine of String(text || '').split(/\n+/)) {
        const line = normalizeWhitespace(rawLine);
        const normalized = normalizeToken(line);
        if (!line || !normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(line);
    }

    return output.join('\n');
}

export function collectJsonLdObjects(): unknown[] {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const values: unknown[] = [];

    for (const script of scripts) {
        const text = script.textContent?.trim();
        if (!text) continue;
        try {
            const parsed: unknown = JSON.parse(text);
            if (Array.isArray(parsed)) {
                values.push(...parsed);
            } else {
                values.push(parsed);
            }
        } catch {
            // Ignore invalid JSON-LD blocks.
        }
    }

    return values.filter((entry) => entry && typeof entry === 'object');
}
