import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getEnabledFlags } from '@/lib/flags';
import { homeFor } from '@/lib/homeRoute';

/** `/app`: the signed-in front door. Resolves to the user's home (src/lib/homeRoute.ts). */
export default async function AppHome() {
    const { userId } = await auth();
    if (!userId) redirect('/sign-in');
    redirect(homeFor(await getEnabledFlags(userId)));
}
