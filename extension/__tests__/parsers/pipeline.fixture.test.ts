import { describe, test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCurrentPage } from '../../src/parsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', '__fixtures__');

type ExpectedShape = {
    url?: string;
    platform?: string;
    pageKind?: string;
    jobDescription?: {
        present?: boolean;
        minTextLength?: number;
        mustContainKeywords?: string[];
    };
    metadata?: {
        companyNameContains?: string;
        roleTitleContains?: string;
    };
    fields?: {
        minCount?: number;
        maxCount?: number;
        semanticKeysPresent?: string[];
        highConfidenceSemanticKeys?: string[];
    };
    questions?: {
        minCount?: number;
    };
};

function setupDom(html: string, url: string) {
    const window = new Window({ url });

    // happy-dom 20.x calls `new this.window.SyntaxError(...)` from its
    // QuerySelector code paths, but exposes window.SyntaxError as undefined.
    // Polyfill it so internal calls (<select> selectedness updates) work.
    if (!window.SyntaxError) {
        window.SyntaxError = SyntaxError;
    }

    // Strip <title> + <body> contents and inject via innerHTML to dodge a
    // happy-dom document.write parser bug around <select>+<option>.
    let bodyHtml = html;
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) title = titleMatch[1].trim();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch?.[1]) bodyHtml = bodyMatch[1];

    if (title) window.document.title = title;
    window.document.body.innerHTML = bodyHtml;

    // happy-dom has no layout engine — getBoundingClientRect returns 0×0 and
    // computed styles default to ''. Patch both so isElementVisible() reflects
    // real-browser behavior on visible elements.
    const fakeRect = () => ({
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        top: 0,
        left: 0,
        right: 100,
        bottom: 30,
    });
    window.HTMLElement.prototype.getBoundingClientRect = fakeRect as never;
    window.Element.prototype.getBoundingClientRect = fakeRect as never;

    // Bind globals the parsers expect when running in a browser content-script
    // context.
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = window.document as unknown as Document;
    globalThis.location = window.location as unknown as Location;
    globalThis.Element = window.Element as unknown as typeof Element;
    globalThis.Node = window.Node as unknown as typeof Node;
    globalThis.NodeFilter = window.NodeFilter as unknown as typeof NodeFilter;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
    globalThis.HTMLInputElement = window.HTMLInputElement as unknown as typeof HTMLInputElement;
    globalThis.HTMLTextAreaElement =
        window.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
    globalThis.HTMLSelectElement =
        window.HTMLSelectElement as unknown as typeof HTMLSelectElement;
    globalThis.HTMLButtonElement =
        window.HTMLButtonElement as unknown as typeof HTMLButtonElement;
    globalThis.HTMLFormElement =
        window.HTMLFormElement as unknown as typeof HTMLFormElement;
    globalThis.HTMLAnchorElement =
        window.HTMLAnchorElement as unknown as typeof HTMLAnchorElement;
    globalThis.HTMLLabelElement =
        window.HTMLLabelElement as unknown as typeof HTMLLabelElement;
    globalThis.CSS = (window.CSS as unknown as typeof CSS) ?? ({
        escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    } as unknown as typeof CSS);

    // The TS parsers call `window.getComputedStyle(...)`, so patch it on the
    // window object directly (the global proxy isn't read by the module).
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const patchedGetComputedStyle = ((element: Element) => {
        const style = originalGetComputedStyle(element as never);
        return new Proxy(style, {
            get(target, prop) {
                const raw = (target as never)[prop];
                if (prop === 'opacity' && (raw === '' || raw == null)) return '1';
                if (prop === 'display' && (raw === '' || raw == null)) return 'block';
                if (prop === 'visibility' && (raw === '' || raw == null)) return 'visible';
                return raw;
            },
        }) as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
    (window as unknown as { getComputedStyle: typeof window.getComputedStyle }).getComputedStyle =
        patchedGetComputedStyle;
    globalThis.getComputedStyle = patchedGetComputedStyle;
}

function discoverFixtures(): string[] {
    if (!existsSync(FIXTURES_DIR)) return [];
    return readdirSync(FIXTURES_DIR)
        .filter((name) => name.endsWith('.html'))
        .map((name) => name.replace(/\.html$/, ''))
        .filter((name) => existsSync(join(FIXTURES_DIR, `${name}.expected.json`)));
}

describe('parser pipeline against ATS fixtures', () => {
    beforeEach(() => {
        // Reset globals between tests so prior happy-dom Window instances don't
        // leak prototype patches.
    });

    const fixtures = discoverFixtures();

    if (fixtures.length === 0) {
        test('skipped — no fixtures found', () => {
            expect(true).toBe(true);
        });
        return;
    }

    for (const name of fixtures) {
        test(name, () => {
            const html = readFileSync(join(FIXTURES_DIR, `${name}.html`), 'utf8');
            const expected = JSON.parse(
                readFileSync(join(FIXTURES_DIR, `${name}.expected.json`), 'utf8')
            ) as ExpectedShape;
            const url = expected.url || 'https://example.com/';

            setupDom(html, url);
            const result = parseCurrentPage();

            if (process.env.DEBUG_FIXTURE) {
                console.log(`---DEBUG ${name}---`);
                console.log('platform:', result.classification.platform);
                console.log('pageKind:', result.classification.pageKind);
                console.log('jd length:', result.jobDescription?.text?.length || 0);
                console.log('roleTitle:', result.metadata?.roleTitle);
                console.log('field count:', result.fields.length);
                console.log(
                    'field keys:',
                    result.fields.map((f) => `${f.key}(${f.confidenceBand})`).join(', ')
                );
            }

            if (expected.platform) {
                expect(result.classification.platform).toBe(expected.platform);
            }
            if (expected.pageKind) {
                expect(result.classification.pageKind).toBe(expected.pageKind);
            }

            if (expected.jobDescription?.present) {
                expect(result.jobDescription).toBeTruthy();
                if (expected.jobDescription.minTextLength != null) {
                    expect(result.jobDescription!.text.length).toBeGreaterThanOrEqual(
                        expected.jobDescription.minTextLength
                    );
                }
                for (const kw of expected.jobDescription.mustContainKeywords || []) {
                    expect(result.jobDescription!.text.toLowerCase()).toContain(kw.toLowerCase());
                }
            }

            if (expected.metadata?.companyNameContains) {
                expect(result.metadata?.companyName ?? '').toContain(
                    expected.metadata.companyNameContains
                );
            }
            if (expected.metadata?.roleTitleContains) {
                expect(result.metadata?.roleTitle ?? '').toContain(
                    expected.metadata.roleTitleContains
                );
            }

            if (expected.fields?.minCount != null) {
                expect(result.fields.length).toBeGreaterThanOrEqual(expected.fields.minCount);
            }
            if (expected.fields?.maxCount != null) {
                expect(result.fields.length).toBeLessThanOrEqual(expected.fields.maxCount);
            }

            if (expected.fields?.semanticKeysPresent?.length) {
                const keys = new Set(result.fields.map((f) => f.key).filter(Boolean));
                for (const k of expected.fields.semanticKeysPresent) {
                    expect(keys.has(k)).toBe(true);
                }
            }

            if (expected.fields?.highConfidenceSemanticKeys?.length) {
                const highKeys = new Set(
                    result.fields
                        .filter((f) => f.confidenceBand === 'high')
                        .map((f) => f.key)
                        .filter(Boolean)
                );
                for (const k of expected.fields.highConfidenceSemanticKeys) {
                    expect(highKeys.has(k)).toBe(true);
                }
            }

            if (expected.questions?.minCount != null) {
                expect(result.questions.length).toBeGreaterThanOrEqual(
                    expected.questions.minCount
                );
            }
        });
    }
});
