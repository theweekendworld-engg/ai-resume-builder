import { afterEach, describe, expect, test } from 'bun:test';
import { decryptToken, encryptToken } from './tokens';

const KEY = process.env.TOKEN_ENCRYPTION_KEY;
afterEach(() => {
    if (KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = KEY;
});

describe('token encryption', () => {
    test('round-trips, and every seal is different', () => {
        process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
        const a = encryptToken('ya29.secret');
        expect(a).not.toContain('ya29');
        expect(encryptToken('ya29.secret')).not.toBe(a);
        expect(decryptToken(a)).toBe('ya29.secret');
    });

    test('a tampered value or a rotated key reads as nothing, never as garbage', () => {
        process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('hex');
        const sealed = encryptToken('ya29.secret');
        expect(decryptToken(sealed.slice(0, -2) + 'AA')).toBeNull();
        process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
        expect(decryptToken(sealed)).toBeNull();
        expect(decryptToken('not-a-token')).toBeNull();
    });
});
