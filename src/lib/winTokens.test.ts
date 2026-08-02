/**
 * Magic-link tokens — the pure half.
 *
 * These are the cheapest tests in the repo to run and the most expensive ones
 * to be missing: every assertion here is a property a leaked or forged token
 * must not have. The database-backed half (scope, replay, blast radius) lives
 * in `winTokens.integration.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import {
    DIGEST_ACTIONS,
    MAX_TOKEN_LENGTH,
    WIN_TOKEN_TTL_DAYS,
    buildActionUrl,
    canonicalString,
    createDigestRoot,
    isTokenExpired,
    isWritingAction,
    mintWinToken,
    tokenExpiresAt,
    verifyWinToken,
    type DigestAction,
} from './winTokens';

const SECRET = 'unit-test-secret';
const OTHER_SECRET = 'a-different-secret';
const ROOT = 'Zm9vYmFyYmF6cXV1eHg';
const WIN = 'clw1n0a2b0000x3f8h7k9q1z4';

function mint(action: DigestAction = 'confirm', secret = SECRET): string {
    const token = mintWinToken({ root: ROOT, winId: WIN, action }, secret);
    if (!token) throw new Error('mint failed');
    return token;
}

describe('minting', () => {
    test('round-trips every action', () => {
        for (const action of DIGEST_ACTIONS) {
            const parsed = verifyWinToken(mint(action), SECRET);
            expect(parsed).toEqual({ root: ROOT, winId: WIN, action });
        }
    });

    test('a token is one URL segment and stays tappable', () => {
        const token = mint();
        expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(token.length).toBeLessThan(MAX_TOKEN_LENGTH);
        expect(encodeURIComponent(token)).toBe(token);
    });

    test('each (win, action) pair gets a distinct token', () => {
        const tokens = DIGEST_ACTIONS.map((action) => mint(action));
        expect(new Set(tokens).size).toBe(DIGEST_ACTIONS.length);
    });

    test('refuses to mint without a secret — fail closed, never sign with ""', () => {
        expect(mintWinToken({ root: ROOT, winId: WIN, action: 'confirm' }, null as unknown as string)).toBeNull();
        expect(mintWinToken({ root: ROOT, winId: WIN, action: 'confirm' }, '')).toBeNull();
    });

    test('refuses ids carrying the field separator', () => {
        expect(mintWinToken({ root: 'a~b', winId: WIN, action: 'confirm' }, SECRET)).toBeNull();
        expect(mintWinToken({ root: ROOT, winId: 'a~b', action: 'confirm' }, SECRET)).toBeNull();
    });

    test('the signed string is exactly root:win:action (PRD 01 §9.3)', () => {
        expect(canonicalString({ root: ROOT, winId: WIN, action: 'confirm' })).toBe(`${ROOT}:${WIN}:confirm`);
    });

    test('digest roots are unguessable and unique', () => {
        const roots = new Set(Array.from({ length: 200 }, createDigestRoot));
        expect(roots.size).toBe(200);
        for (const root of roots) expect(root.length).toBeGreaterThanOrEqual(20);
    });
});

describe('verification rejects', () => {
    test('a tampered action — the confirm token cannot become a dismiss token', () => {
        const confirm = mint('confirm');
        const dismiss = mint('dismiss');
        const [confirmBody] = confirm.split('.');
        const [, dismissSig] = dismiss.split('.');
        // Body from one, signature from the other: the exact swap an attacker
        // with two tokens from the same digest would try.
        expect(verifyWinToken(`${confirmBody}.${dismissSig}`, SECRET)).toBeNull();
    });

    test('a tampered win id', () => {
        const token = mint();
        const [, signature] = token.split('.');
        const forgedBody = Buffer.from(`${ROOT}~someone-elses-win~c`, 'utf8').toString('base64url');
        expect(verifyWinToken(`${forgedBody}.${signature}`, SECRET)).toBeNull();
    });

    test('a tampered digest root', () => {
        const token = mint();
        const [, signature] = token.split('.');
        const forgedBody = Buffer.from(`another-root~${WIN}~c`, 'utf8').toString('base64url');
        expect(verifyWinToken(`${forgedBody}.${signature}`, SECRET)).toBeNull();
    });

    test('a signature made with a different secret', () => {
        expect(verifyWinToken(mint('confirm', OTHER_SECRET), SECRET)).toBeNull();
    });

    test('a truncated signature', () => {
        const token = mint();
        expect(verifyWinToken(token.slice(0, token.length - 4), SECRET)).toBeNull();
    });

    test('an unsigned payload', () => {
        const body = Buffer.from(`${ROOT}~${WIN}~c`, 'utf8').toString('base64url');
        expect(verifyWinToken(body, SECRET)).toBeNull();
        expect(verifyWinToken(`${body}.`, SECRET)).toBeNull();
    });

    test('an unknown action code', () => {
        const payload = { root: ROOT, winId: WIN, action: 'x' as DigestAction };
        expect(mintWinToken(payload, SECRET)).toBeNull();
        const body = Buffer.from(`${ROOT}~${WIN}~x`, 'utf8').toString('base64url');
        expect(verifyWinToken(`${body}.whatever`, SECRET)).toBeNull();
    });

    test('garbage, empty input, and oversized input', () => {
        expect(verifyWinToken('', SECRET)).toBeNull();
        expect(verifyWinToken('.', SECRET)).toBeNull();
        expect(verifyWinToken('not-a-token', SECRET)).toBeNull();
        expect(verifyWinToken('a.b.c', SECRET)).toBeNull();
        expect(verifyWinToken(`${'x'.repeat(MAX_TOKEN_LENGTH + 1)}.y`, SECRET)).toBeNull();
    });

    test('non-base64url characters, including path traversal attempts', () => {
        expect(verifyWinToken('../../etc/passwd.sig', SECRET)).toBeNull();
        expect(verifyWinToken('abc+def.sig', SECRET)).toBeNull();
        expect(verifyWinToken('abc/def.sig', SECRET)).toBeNull();
    });

    test('nothing verifies when the secret is unset', () => {
        expect(verifyWinToken(mint(), null as unknown as string)).toBeNull();
    });
});

describe('expiry', () => {
    const created = new Date('2026-07-31T16:00:00Z');

    test('is 30 days from when the digest was created', () => {
        expect(tokenExpiresAt(created).getTime() - created.getTime()).toBe(WIN_TOKEN_TTL_DAYS * 86_400_000);
    });

    test('valid at 29 days — people read email late', () => {
        expect(isTokenExpired(created, new Date(created.getTime() + 29 * 86_400_000))).toBe(false);
    });

    test('expired at exactly 30 days and beyond', () => {
        expect(isTokenExpired(created, new Date(created.getTime() + 30 * 86_400_000))).toBe(true);
        expect(isTokenExpired(created, new Date(created.getTime() + 400 * 86_400_000))).toBe(true);
    });

    test('the token carries no expiry field to tamper with', () => {
        const [body] = mint().split('.');
        const decoded = Buffer.from(body, 'base64url').toString('utf8');
        expect(decoded.split('~')).toHaveLength(3);
        expect(decoded).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10,}/);
    });
});

describe('action classification', () => {
    test('only confirm and dismiss write', () => {
        expect(isWritingAction('confirm')).toBe(true);
        expect(isWritingAction('dismiss')).toBe(true);
        expect(isWritingAction('edit')).toBe(false);
    });
});

describe('buildActionUrl', () => {
    test('lands on /w/<token> and tolerates a trailing slash', () => {
        expect(buildActionUrl('tok', 'https://app.example.com/')).toBe('https://app.example.com/w/tok');
        expect(buildActionUrl('tok', 'https://app.example.com')).toBe('https://app.example.com/w/tok');
    });
});
