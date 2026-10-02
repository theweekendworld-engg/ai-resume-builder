'use server';

/**
 * Approve a browser-extension connection: the tap, never the page load.
 *
 * Until 2026-10-02 the connect page approved the grant while it rendered. A
 * grant can be started by anyone (the start route is public), so sending a
 * signed-in user the link handed the sender a 30-day token for that user's
 * account. Approval now happens only here, for the user in the session.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { approveExtensionConnectGrant } from '@/lib/extension/connect';

const GrantId = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export async function approveExtensionConnect(formData: FormData): Promise<void> {
    const { userId } = await auth();
    const parsed = GrantId.safeParse(formData.get('grantId'));
    if (!parsed.success) redirect('/extension/connect');
    if (!userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/extension/connect?grantId=${parsed.data}`)}`);
    const result = await approveExtensionConnectGrant(parsed.data, userId);
    redirect(`/extension/connect?grantId=${parsed.data}&result=${result.status}`);
}
