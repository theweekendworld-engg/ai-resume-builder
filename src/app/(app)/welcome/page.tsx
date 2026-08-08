import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getWelcomeState } from '@/actions/onboarding';
import { WelcomeFlow } from '@/components/onboarding/WelcomeFlow';
import { parseInternalPath } from '@/lib/safeNext';

export const metadata = {
    title: 'Welcome · Patronus',
};

/**
 * `/welcome` — where everyone lands after signing up.
 *
 * Not flag-gated. Onboarding is the one surface that cannot wait for a rollout:
 * a user who signs up while a flag is off would otherwise get no first run at
 * all. What it OFFERS adapts instead — the mission question only appears when
 * `missions` is on for that user.
 *
 * Runs once. `onboardingComplete` sends a returning user straight through, so
 * a bookmarked or shared link cannot trap someone in setup they have done.
 */
export default async function WelcomePage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    const { userId } = await auth();
    if (!userId) redirect('/sign-in');

    // Where the CTA they clicked was actually going. "Get Career" means
    // checkout; the hero means the Work Log. Sign-up parks it here because
    // first run has to happen before the destination is worth reaching.
    const next = parseInternalPath((await searchParams).next);

    const result = await getWelcomeState();
    if (!result.success) redirect(next ?? '/dashboard');
    // A returning user has done this. Send them where they were going.
    if (result.data.done) redirect(next ?? '/dashboard');

    return <WelcomeFlow initial={result.data} next={next} />;
}
