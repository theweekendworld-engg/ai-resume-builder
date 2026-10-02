/**
 * Personal API keys for the Patronus CLI.
 *
 * `pat_` + 32 random bytes (base64url). Only the SHA-256 is stored, so a
 * database leak yields no usable key; the key is shown once. Resolution is by
 * hash lookup (an index, and constant-time with respect to the key's
 * content), and it returns the OWNER: the user is always the key's, never
 * one named in the request.
 */

import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export const API_KEY_PREFIX = 'pat_';
export const MAX_KEYS_PER_USER = 10;

export function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

export async function createApiKey(userId: string, name: string): Promise<{ id: string; key: string; prefix: string }> {
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const prefix = key.slice(0, 12);
    const row = await prisma.apiKey.create({
        data: { userId, name: name.trim().slice(0, 60) || 'CLI', prefix, hash: hashApiKey(key) },
        select: { id: true },
    });
    return { id: row.id, key, prefix };
}

/** The user a bearer key belongs to, or null. Updates lastUsedAt at most hourly. */
export async function resolveApiKey(authorization: string | null): Promise<{ userId: string; keyId: string } | null> {
    const match = authorization?.match(/^Bearer\s+(pat_[A-Za-z0-9_-]{20,100})\s*$/);
    if (!match) return null;
    const row = await prisma.apiKey.findUnique({
        where: { hash: hashApiKey(match[1]) },
        select: { id: true, userId: true, revokedAt: true, lastUsedAt: true },
    });
    if (!row || row.revokedAt) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 3_600_000) {
        await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { userId: row.userId, keyId: row.id };
}
