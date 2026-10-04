import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for third-party OAuth tokens at rest (Google Calendar).
 *
 * Key: TOKEN_ENCRYPTION_KEY, 32 bytes as base64 or hex. Rotating it makes
 * every stored token unreadable, which is safe: the connection reads as
 * expired and the user reconnects. Format: `v1.<iv>.<tag>.<ciphertext>`.
 */

const VERSION = 'v1';

function key(): Buffer {
    const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
    if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or hex)');
    return buf;
}

export function tokenEncryptionConfigured(): boolean {
    try {
        key();
        return true;
    } catch {
        return false;
    }
}

export function encryptToken(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Null when the value is not ours or the key changed: the caller treats it as disconnected. */
export function decryptToken(sealed: string): string | null {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !body) return null;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}
