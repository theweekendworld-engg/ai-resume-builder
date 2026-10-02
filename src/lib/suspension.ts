/**
 * Suspended users spend nothing. Checked at the two places all spend passes
 * through: the usage backstop (every model call) and the entitlement gate
 * (every metered action), so a suspended account cannot run up cost on any
 * channel. Sign-in is blocked separately, by a Clerk ban.
 */

import { prisma } from '@/lib/prisma';

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; suspended: boolean }>();

export class SuspendedError extends Error {
    readonly code = 'suspended' as const;
    constructor() {
        super('This account is suspended. Contact support if you think this is a mistake.');
        this.name = 'SuspendedError';
    }
}

export async function isSuspended(userId: string): Promise<boolean> {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.suspended;
    const row = await prisma.userSuspension.findUnique({ where: { userId }, select: { userId: true } });
    const suspended = Boolean(row);
    cache.set(userId, { at: Date.now(), suspended });
    if (cache.size > 5_000) cache.delete(cache.keys().next().value as string);
    return suspended;
}

export async function assertNotSuspended(userId: string): Promise<void> {
    if (await isSuspended(userId)) throw new SuspendedError();
}

/** After an admin changes it, so this instance sees it at once. */
export function forgetSuspension(userId: string): void {
    cache.delete(userId);
}
