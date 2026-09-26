/**
 * Small, dependency-free HTML helpers for ingest.
 *
 * Not a DOM parser, deliberately: every page we read here is either a known
 * template (LinkedIn's guest job card, a public post's JSON-LD) or a generic
 * page where "the readable text" is the whole requirement. A parser dependency
 * would be the only one in the server bundle for a job regexes already do.
 *
 * Unlike `radar/comp.ts`'s `toText`, this keeps line structure: a JD read by a
 * model and quoted back to a user is far better as paragraphs and bullets than
 * as one 6,000-character line.
 */

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    bull: '•',
    middot: '·',
    rupee: '₹',
    euro: '€',
    pound: '£',
};

function safeCodePoint(code: number): string {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try {
        return String.fromCodePoint(code);
    } catch {
        return '';
    }
}

/**
 * Decode entities in one pass, so `&amp;lt;` becomes `&lt;` (text), not `<`.
 * `fromCodePoint`, not `fromCharCode`: posts are full of emoji above U+FFFF.
 */
export function decodeEntities(input: string): string {
    return String(input ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
            return safeCodePoint(code) || match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/** Collapse runs of spaces within lines and runs of blank lines. */
export function tidyText(input: string): string {
    return input
        .replace(/\r\n?/g, '\n')
        .replace(/[\t\f\v  ]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** HTML fragment → readable text with paragraphs and bullets preserved. */
export function htmlToText(html: string): string {
    const withoutNoise = String(html ?? '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');

    const structured = withoutNoise
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n• ')
        .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|tr|header|footer|blockquote)>/gi, '\n')
        .replace(/<(p|div|section|article|h[1-6]|ul|ol|tr|blockquote)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

    return tidyText(decodeEntities(structured));
}

/** Content of the first element whose opening tag matches `openTag`. */
export function innerOf(html: string, openTag: RegExp, tagName: string): string | null {
    const match = openTag.exec(html);
    if (!match) return null;
    const start = match.index + match[0].length;
    // Balance nested tags of the same name so a <div> inside the markup
    // does not end the capture early.
    const pattern = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi');
    pattern.lastIndex = start;
    let depth = 1;
    let token: RegExpExecArray | null;
    while ((token = pattern.exec(html))) {
        depth += token[1] ? -1 : 1;
        if (depth === 0) return html.slice(start, token.index);
    }
    return html.slice(start);
}

/** `<meta property|name="key" content="…">`, decoded. Attribute order agnostic. */
export function metaContent(html: string, key: string): string | null {
    const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
    const wanted = key.toLowerCase();
    for (const tag of tags) {
        const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
        if (name !== wanted) continue;
        const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
        if (content !== undefined) {
            // LinkedIn double-escapes og tags (`&amp;#39;`), so decode twice.
            return tidyText(decodeEntities(decodeEntities(content)));
        }
    }
    return null;
}

export function titleOf(html: string): string | null {
    const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    return raw ? tidyText(decodeEntities(raw)) : null;
}

/** Every JSON-LD object on the page, flattened through `@graph` and arrays. */
export function jsonLdObjects(html: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        out.push(record);
        if (Array.isArray(record['@graph'])) visit(record['@graph']);
    };
    for (const block of blocks) {
        try {
            visit(JSON.parse(block[1].trim()));
        } catch {
            // A malformed block is common on real pages; skip it, keep the rest.
        }
    }
    return out;
}

export function typeOf(record: Record<string, unknown>): string[] {
    const raw = record['@type'];
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
    return [];
}

export function stringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The page's main readable text: `<main>` or `<article>` when present (they
 * exclude nav and footers), otherwise `<body>`.
 */
export function mainText(html: string): string {
    const region = innerOf(html, /<main\b[^>]*>/i, 'main')
        ?? innerOf(html, /<article\b[^>]*>/i, 'article')
        ?? innerOf(html, /<body\b[^>]*>/i, 'body')
        ?? html;
    const withoutChrome = region.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
    return htmlToText(withoutChrome);
}
