import { describe, expect, test } from 'bun:test';
import {
  createExtensionAccessToken,
  hashExtensionAccessToken,
  shouldRefreshExtensionAccessToken,
} from './sessionToken';

describe('extension session tokens', () => {
  test('creates a bearer token with a stable hash', () => {
    const token = createExtensionAccessToken(new Date('2026-03-21T00:00:00.000Z'));

    expect(token.rawToken.startsWith('ext_pat_')).toBe(true);
    expect(token.tokenHash).toBe(hashExtensionAccessToken(token.rawToken));
    expect(token.expiresAt.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  test('refreshes tokens near expiry', () => {
    expect(shouldRefreshExtensionAccessToken('2026-03-21T00:03:00.000Z', new Date('2026-03-21T00:00:00.000Z'))).toBe(true);
    expect(shouldRefreshExtensionAccessToken('2026-03-21T01:00:00.000Z', new Date('2026-03-21T00:00:00.000Z'))).toBe(false);
  });
});
