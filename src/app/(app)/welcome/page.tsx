import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getWelcomeState } from '@/actions/onboarding';
import { WelcomeFlow } from '@/components/onboarding/WelcomeFlow';

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
export default async function WelcomePage() {
    const { userId } = await auth();
    if (!userId) redirect('/sign-in');

    const result = await getWelcomeState();
    if (!result.success) redirect('/dashboard');
    if (result.data.done) redirect('/dashboard');

    return <WelcomeFlow initial={result.data} />;
}
