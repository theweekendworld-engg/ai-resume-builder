import { createHash, randomBytes } from 'node:crypto';

export const EXTENSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXTENSION_TOKEN_PREFIX = 'ext_pat_';

export function hashExtensionAccessToken(token: string): string {
  return createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

export function createExtensionAccessToken(now = new Date()) {
  const rawToken = `${EXTENSION_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + EXTENSION_TOKEN_TTL_MS);

  return {
    rawToken,
    tokenHash: hashExtensionAccessToken(rawToken),
    expiresAt,
  };
}

export function shouldRefreshExtensionAccessToken(expiresAt?: string | Date | null, now = new Date()) {
  if (!expiresAt) return true;
  const expiresDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiresDate.getTime())) return true;
  return expiresDate.getTime() - now.getTime() <= (5 * 60 * 1000);
}
