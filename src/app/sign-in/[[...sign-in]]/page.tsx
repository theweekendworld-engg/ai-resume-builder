import { headers } from 'next/headers';
import { SignIn } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerkAppearance';
import { Wordmark } from '@/components/marketing/Wordmark';
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
    // Dossier paper, like the landing page every visitor arrives from and the
    // app they land in (2026-11-08). This used to force `.dark` so the auth pages
    // matched a dark marketing site; both moved to paper together, so the
    // three surfaces are one product. The tokens in clerkAuthAppearance
    // resolve against the page's own (light) theme.
    <div className="light min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10">
        <Wordmark size="lg" />
        <p className="mt-3 text-center text-sm text-muted-foreground">The private, evidence-backed record of your working life.</p>
        <div className="mt-8 flex w-full justify-center">
          <SignIn
            appearance={clerkAuthAppearance}
            routing="path"
            path="/sign-in"
            signUpUrl={stash ? `/sign-up?stash=${stash}` : '/sign-up'}
            {...(destination ? { forceRedirectUrl: destination } : {})}
            fallbackRedirectUrl="/app"
            signUpForceRedirectUrl={newAccount}
            signUpFallbackRedirectUrl={newAccount}
          />
        </div>
      </div>
    </div>
  );
}
