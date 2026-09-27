import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';

import { finishOnboarding, getWelcomeState, startOnboardingFromStash } from '@/actions/onboarding';
import { WelcomeFlow } from '@/components/onboarding/WelcomeFlow';
import { parseInternalPath } from '@/lib/safeNext';
import { SCORE_STASH_COOKIE, isStashId, readScoreStash } from '@/lib/scoreStash';

export const metadata = {
    title: 'Welcome · Patronus',
};

/**
 * `/welcome` — where everyone lands after signing up or signing in with a
 * checked resume in hand.
 *
 * Not flag-gated: a user who signs up while a flag is off must still get a
 * first run.
 *
 * ── The score stash ─────────────────────────────────────────────────────────
 *
 * `?stash=<id>` (or the first-party cookie `/api/score/stash` set, which
 * survives an email-verification tab) means they came from "Fix all of these".
 * The stash is read server-side, so nothing depends on this tab's
 * sessionStorage (audit 2026-09-27, B).
 *
 *   returning user + stash  → straight to the resume, fixes ready
 *   new user + stash        → one tap: "Use it" → the resume, fixes ready
 *   has history, no stash   → nothing to ask: finish and go
 */
export default async function WelcomePage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string; stash?: string }>;
}) {
    const { userId } = await auth();
    if (!userId) redirect('/sign-in');

    const params = await searchParams;
    const next = parseInternalPath(params.next);
    const cookieStash = (await cookies()).get(SCORE_STASH_COOKIE)?.value;
    // `stash=none` is "Use a different file": ignore the cookie too.
    const declined = params.stash === 'none';
    const stashId = isStashId(params.stash) ? params.stash : !declined && isStashId(cookieStash) ? cookieStash : null;
    const stash = stashId ? await readScoreStash(stashId, userId) : null;

    const result = await getWelcomeState();
    if (!result.success) redirect(next ?? '/dashboard');

    if (result.data.done) {
        // A returning user who checked a resume: open it, don't ask again.
        if (stash) {
            const started = await startOnboardingFromStash(stash.id);
            if (started.success) redirect(`/editor/${started.data.resumeId}?stash=${stash.id}`);
        }
        redirect(next ?? '/dashboard');
    }

    // Already has history and nothing new to bring in: there is nothing to ask.
    if (result.data.hasHistory && !stash && !result.data.missionsEnabled) {
        const finished = await finishOnboarding(next ?? undefined);
        redirect(finished.success ? finished.data.next : next ?? '/dashboard');
    }

    return (
        <WelcomeFlow
            initial={result.data}
            next={next}
            stash={stash ? { id: stash.id, score: stash.score, fixes: stash.fixes.length } : null}
        />
    );
}
