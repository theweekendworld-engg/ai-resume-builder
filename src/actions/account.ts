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
