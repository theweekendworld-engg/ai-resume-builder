import { headers } from 'next/headers';
import { SignIn } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerkAppearance';
import { resolveRedirectTarget, welcomeUrl } from '@/lib/redirectTarget';
import { isStashId } from '@/lib/scoreStash';

/**
 * Sign-in honours where the user was going.
 *
 * `forceRedirectUrl="/dashboard"` used to override `?redirect_url=`, so every
 * deep link that bounced through sign-in — the extension's connect page, email
 * links, `/log/review/…` — landed on the dashboard instead (audit 2026-09-27,
 * C). Clerk's own `auth.protect()` sends an ABSOLUTE url here, so the target is
 * accepted only when its host is this app's host, then reduced to a path.
 *
 * A `?stash=` (from `/score`'s "Fix all" for a returning user) goes through
 * `/welcome`, which opens the checked resume with its fixes.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string; stash?: string }>;
}) {
  const params = await searchParams;
  const host = (await headers()).get('host');
  const target = resolveRedirectTarget(params.redirect_url, host);
  const stash = isStashId(params.stash) ? params.stash : null;
  const destination = stash ? welcomeUrl({ next: target, stash }) : target;
  const newAccount = welcomeUrl({ next: target, stash });

  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_55%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 w-full">
        <div className="flex w-full justify-center">
          <SignIn
            appearance={clerkAuthAppearance}
            routing="path"
            path="/sign-in"
            signUpUrl={stash ? `/sign-up?stash=${stash}` : '/sign-up'}
            {...(destination ? { forceRedirectUrl: destination } : {})}
            fallbackRedirectUrl="/dashboard"
            signUpForceRedirectUrl={newAccount}
            signUpFallbackRedirectUrl={newAccount}
          />
        </div>
      </div>
    </div>
  );
}
