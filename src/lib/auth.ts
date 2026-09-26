import { auth } from '@clerk/nextjs/server';

/**
 * Require an authenticated user, from the SESSION. Throws if there is none.
 *
 * It used to accept an override id and return it unchecked, which is how three
 * public server actions ended up trusting whatever user id a caller sent.
 * There is deliberately no way to pass one now: code acting for a known user
 * runs in `src/lib` / `src/services`, never behind a `'use server'` export.
 */
export async function requireAuth(): Promise<string> {
    const { userId } = await auth();
    if (!userId) throw new Error('Not authenticated');
    return userId;
}
