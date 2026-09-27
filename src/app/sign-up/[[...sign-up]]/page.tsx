import { SignUp } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerkAppearance';
import { parseInternalPath } from '@/lib/safeNext';
import { welcomeUrl } from '@/lib/redirectTarget';
import { isStashId } from '@/lib/scoreStash';

/**
 * Sign-up.
 *
 * New accounts land on `/welcome`, which is where their history gets in — a
 * dashboard with nothing on it is not a first run.
 *
 * `forceRedirectUrl` used to point at `/dashboard`, and in Clerk that takes
 * precedence over `?redirect_url=`. So `/score`'s "Fix all of these in one
 * click" quietly dropped people on an empty dashboard with their parsed resume
 * unread. `/welcome` collects that stash, so the force is now correct rather
 * than merely harmless.
 *
 * ── What was still leaking ──────────────────────────────────────────────────
 *
 * Fixing the score handoff did nothing for the other six CTAs. "Get Career"
 * sends `?redirect_url=/settings/plan`; the hero, the footer, the features
 * section and the nav all send `?redirect_url=/log`. Every one of them was
 * still being overridden — the highest-intent click in the funnel, the one
 * from someone who has decided to pay, never reached checkout.
 *
 * The destination cannot simply be handed back to Clerk: first run has to
 * happen or the account is useless. So the intent rides through onboarding as
 * `?next=`, and `finishOnboarding` honours it at the end. `parseInternalPath`
 * refuses anything that is not a same-origin path, because this value comes
 * from a URL and lands in a redirect.
 *
 * Sign-IN keeps its own destination: someone with an account is returning to
 * work, not starting over.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string; stash?: string }>;
}) {
  const params = await searchParams;
  const next = parseInternalPath(params.redirect_url);
  // `/score`'s "Fix all" result, kept server-side (src/lib/scoreStash.ts). It
  // rides the URL AND a cookie, so email verification in a new tab keeps it.
  const stash = isStashId(params.stash) ? params.stash : null;
  const welcome = welcomeUrl({ next, stash });
  // An existing account that signs in from here still gets the checked resume.
  const signInDestination = stash ? welcome : next ?? '/dashboard';

  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_55%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 w-full">
        <div className="flex w-full justify-center">
          <SignUp
            appearance={clerkAuthAppearance}
            routing="path"
            path="/sign-up"
            signInUrl={stash ? `/sign-in?stash=${stash}` : '/sign-in'}
            forceRedirectUrl={welcome}
            fallbackRedirectUrl={welcome}
            signInForceRedirectUrl={signInDestination}
            signInFallbackRedirectUrl={signInDestination}
          />
        </div>
      </div>
    </div>
  );
}
