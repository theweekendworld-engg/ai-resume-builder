import { describe, expect, test } from 'bun:test';
import { resolveRedirectTarget, welcomeUrl } from './redirectTarget';

const HOST = 'aicv.theweekendworld.com';

describe('resolveRedirectTarget', () => {
    test('a same-origin absolute url (what auth.protect sends) becomes its path', () => {
        expect(resolveRedirectTarget(`https://${HOST}/log/review/2026-09?src=email`, HOST)).toBe('/log/review/2026-09?src=email');
        expect(resolveRedirectTarget(`https://${HOST}/extension/connect?grantId=g_1`, HOST)).toBe('/extension/connect?grantId=g_1');
    });

    test('plain internal paths pass through', () => {
        expect(resolveRedirectTarget('/settings/plan', HOST)).toBe('/settings/plan');
    });

    test('other origins and tricks are refused', () => {
        expect(resolveRedirectTarget('https://evil.com/log', HOST)).toBeNull();
        expect(resolveRedirectTarget(`https://${HOST}.evil.com/log`, HOST)).toBeNull();
        expect(resolveRedirectTarget('//evil.com', HOST)).toBeNull();
        expect(resolveRedirectTarget('javascript:alert(1)', HOST)).toBeNull();
        expect(resolveRedirectTarget(`https://${HOST}/x`, null)).toBeNull();
        expect(resolveRedirectTarget('', HOST)).toBeNull();
        expect(resolveRedirectTarget(undefined, HOST)).toBeNull();
    });
});

describe('welcomeUrl', () => {
    test('carries next and stash only when present', () => {
        expect(welcomeUrl({})).toBe('/welcome');
        expect(welcomeUrl({ stash: 'abc' })).toBe('/welcome?stash=abc');
        expect(welcomeUrl({ next: '/settings/plan', stash: 'abc' })).toBe('/welcome?next=%2Fsettings%2Fplan&stash=abc');
    });
});
