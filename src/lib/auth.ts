import { auth } from '@clerk/nextjs/server';

/**
 * Require an authenticated user. Throws if not authenticated.
 * Optionally accepts an override userId (e.g. from actor/tracking context).
 */
export async function requireAuth(overrideUserId?: string): Promise<string> {
    if (overrideUserId?.trim()) return overrideUserId.trim();
    const { userId } = await auth();
    if (!userId) throw new Error('Not authenticated');
    return userId;
}
