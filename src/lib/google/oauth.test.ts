import { afterEach, describe, expect, test } from 'bun:test';
import { authorizationUrl, createState, readState } from './oauth';

const SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ID = process.env.GOOGLE_CLIENT_ID;
afterEach(() => {
    if (SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = SECRET;
    if (ID === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = ID;
});

describe('google oauth state', () => {
    test('round-trips the user, and rejects tampering and expiry', () => {
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
        const now = Date.now();
        const state = createState('user_abc', now);
        expect(readState(state, now)).toBe('user_abc');
        const [, nonce, exp, sig] = state.split('.');
        expect(readState([Buffer.from('user_evil').toString('base64url'), nonce, exp, sig].join('.'), now)).toBeNull();
        expect(readState(state, now + 11 * 60_000)).toBeNull();
        expect(readState('garbage', now)).toBeNull();
    });

    test('asks for calendar events only, offline, never Gmail', () => {
        process.env.GOOGLE_CLIENT_ID = 'cid';
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
        const url = new URL(authorizationUrl('https://www.patronus.cv', 's'));
        const scope = url.searchParams.get('scope') ?? '';
        expect(scope).toContain('calendar.events');
        expect(scope).not.toContain('gmail');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('redirect_uri')).toBe('https://www.patronus.cv/api/google/callback');
    });
});
