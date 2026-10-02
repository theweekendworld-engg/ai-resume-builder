'use server';

/**
 * Delete my account: every row, file and vector, then the Clerk user.
 * Identity from the session only; the confirmation phrase is the guard
 * against a mis-click, not against an attacker.
 */

import { auth, clerkClient } from '@clerk/nextjs/server';
import { z } from 'zod';
import { err, ok, type Result } from '@/lib/result';
import { deleteUserData } from '@/services/accountDeletion';

const ConfirmSchema = z.object({ confirm: z.literal('DELETE') });

export async function deleteMyAccount(input: { confirm: string }): Promise<Result<{ deleted: true }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!ConfirmSchema.safeParse(input).success) return err('Type DELETE to confirm', 'invalid_input');

    const report = await deleteUserData(userId);
    if (report.leftovers.length > 0) {
        return err('Some of your data could not be deleted. Nothing else was changed; contact support and we will finish it.', 'partial');
    }
    try {
        const client = await clerkClient();
        await client.users.deleteUser(userId);
    } catch (error) {
        console.error('[account] Clerk user delete failed after data deletion', { userId, error: String(error) });
        return err('Your data is deleted, but your sign-in could not be removed. Contact support to finish.', 'clerk_failed');
    }
    return ok({ deleted: true });
}

export type ConnectedDevice = { id: string; client: string; createdAt: string; expiresAt: string; lastUsedAt: string | null };

/** The extension sessions that can act for me right now. */
export async function listConnectedDevices(): Promise<Result<ConnectedDevice[]>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.extensionAccessToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });
    return ok(rows.map((row) => ({
        id: row.id,
        client: row.client,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    })));
}

/**
 * Disconnect the browser extension everywhere. Tokens lasted 30 days and could
 * only be revoked by connecting again, so a lost laptop stayed signed in
 * (launch audit 2026-10-02).
 */
export async function disconnectExtension(): Promise<Result<{ revoked: number }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const { prisma } = await import('@/lib/prisma');
    const { count } = await prisma.extensionAccessToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    return ok({ revoked: count });
}

// ───────────────────────────────────────────────────────────── API keys (CLI)

export type ApiKeyView = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export async function listApiKeys(): Promise<Result<ApiKeyView[]>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.apiKey.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    return ok(rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null })));
}

/** The key is returned once, here, and never again. */
export async function createCliKey(input: { name: string }): Promise<Result<{ key: string; prefix: string }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const name = z.string().trim().max(60).safeParse(input?.name ?? '');
    if (!name.success) return err('Name is too long', 'invalid_input');
    const { prisma } = await import('@/lib/prisma');
    const { createApiKey, MAX_KEYS_PER_USER } = await import('@/lib/apiKeys');
    const live = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
    if (live >= MAX_KEYS_PER_USER) return err(`You have ${MAX_KEYS_PER_USER} keys. Revoke one first.`, 'limit');
    const created = await createApiKey(userId, name.data);
    return ok({ key: created.key, prefix: created.prefix });
}

export async function revokeCliKey(input: { id: string }): Promise<Result<void>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const { prisma } = await import('@/lib/prisma');
    const { count } = await prisma.apiKey.updateMany({ where: { id: String(input?.id ?? ''), userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return count > 0 ? ok(undefined) : err('Key not found', 'not_found');
}
