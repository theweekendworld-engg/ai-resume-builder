import { SignUp } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerkAppearance';

/**
 * Sign-up.
 *
 * New accounts land on `/welcome`, which is where their history gets in — a
 * dashboard with nothing on it is not a first run.
 *
 * `forceRedirectUrl` used to point at `/dashboard`, and in Clerk that takes
 * precedence over `?redirect_url=`. So `/score`'s "Fix all of these in one
 * click" — which sends people to `/sign-up?redirect_url=/build` with their
 * parsed resume stashed in sessionStorage — quietly dropped them on an empty
 * dashboard instead, handoff unread. `/welcome` collects that stash, so the
 * force is now correct rather than merely harmless.
 *
 * Sign-IN keeps its own destination: someone with an account is returning to
 * work, not starting over.
 */
export default function SignUpPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_55%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 w-full">
        <div className="flex w-full justify-center">
          <SignUp
            appearance={clerkAuthAppearance}
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            forceRedirectUrl="/welcome"
            fallbackRedirectUrl="/welcome"
            signInForceRedirectUrl="/dashboard"
            signInFallbackRedirectUrl="/dashboard"
          />
        </div>
      </div>
    </div>
  );
}
