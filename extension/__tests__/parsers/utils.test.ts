import { describe, test, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { getElementPath } from '../../src/parsers/utils';

function setupDom(): Window {
    const window = new Window({ url: 'https://example.com/' });
    if (!window.SyntaxError) {
        window.SyntaxError = SyntaxError;
    }
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = window.document as unknown as Document;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
    globalThis.HTMLInputElement = window.HTMLInputElement as unknown as typeof HTMLInputElement;
    globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
    globalThis.HTMLSelectElement = window.HTMLSelectElement as unknown as typeof HTMLSelectElement;
    globalThis.Element = window.Element as unknown as typeof Element;
    globalThis.Node = window.Node as unknown as typeof Node;
    return window;
}

describe('parsers/utils.getElementPath', () => {
    let window: Window;

    beforeEach(() => {
        window = setupDom();
    });

    test('returns "body" when called on document.body', () => {
        const path = getElementPath(window.document.body);
        expect(typeof path).toBe('string');
        expect(path).toBe('body');
    });

    test('returns "html" when called on document.documentElement', () => {
        const path = getElementPath(window.document.documentElement);
        expect(typeof path).toBe('string');
        expect(path).toBe('html');
    });

    test('returns a non-empty selector for a nested element', () => {
        window.document.body.innerHTML =
            '<main><section><form><input id="email"/></form></section></main>';
        const input = window.document.getElementsByTagName('input')[0];
        const path = getElementPath(input);
        expect(typeof path).toBe('string');
        expect(path.length).toBeGreaterThan(0);
    });

    test('returns empty string for non-Element values', () => {
        expect(getElementPath(null)).toBe('');
        expect(getElementPath(undefined)).toBe('');
        expect(getElementPath('not-an-element')).toBe('');
    });
});
