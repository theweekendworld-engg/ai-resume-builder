import { describe, expect, test } from 'bun:test';

import { parseInternalPath } from './safeNext';

/**
 * This value arrives in a URL and leaves in a redirect, so the interesting
 * cases are all adversarial. A resume product that bounces users to an
 * attacker's login page has a worse problem than a bad resume.
 */
describe('parseInternalPath', () => {
    test('keeps the destinations the CTAs actually use', () => {
        for (const path of ['/log', '/settings/plan', '/build', '/packets/new']) {
            expect(parseInternalPath(path)).toBe(path);
        }
    });

    test('keeps query strings and fragments', () => {
        expect(parseInternalPath('/settings/plan?tier=career')).toBe('/settings/plan?tier=career');
        expect(parseInternalPath('/log#recent')).toBe('/log#recent');
    });

    test('refuses another origin, however it is spelled', () => {
        // `//host` is protocol-relative and leaves the site while looking like
        // a path. The backslash variant is treated the same way by some agents.
        for (const hostile of [
            'https://evil.com',
            'http://evil.com',
            '//evil.com',
            '//evil.com/log',
            '/\\evil.com',
            'javascript:alert(1)',
            'data:text/html,<script>',
        ]) {
            expect(parseInternalPath(hostile)).toBeNull();
        }
    });

    test('refuses anything that is not an absolute path', () => {
        for (const value of ['log', '../log', '', '   ', 'mailto:a@b.c']) {
            expect(parseInternalPath(value)).toBeNull();
        }
    });

    test('refuses control characters used to split or truncate', () => {
        expect(parseInternalPath('/log\nLocation: https://evil.com')).toBeNull();
        expect(parseInternalPath('/log\r\nSet-Cookie: a=b')).toBeNull();
        expect(parseInternalPath('/log\u0000')).toBeNull();
        // Surrounding whitespace is trimmed, not rejected — a trailing space
        // in a query string is a formatting accident, not an attack.
        expect(parseInternalPath('  /log  ')).toBe('/log');
    });

    test('refuses absent, non-string and absurdly long values', () => {
        expect(parseInternalPath(null)).toBeNull();
        expect(parseInternalPath(undefined)).toBeNull();
        expect(parseInternalPath(`/${'a'.repeat(600)}`)).toBeNull();
    });

    test('a scheme hidden behind whitespace is still a scheme', () => {
        expect(parseInternalPath('  https://evil.com  ')).toBeNull();
    });
});
