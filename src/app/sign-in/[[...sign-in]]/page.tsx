import { SignIn } from '@clerk/nextjs';
import { clerkAuthAppearance } from '@/lib/clerkAppearance';

export default function SignInPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_55%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 w-full">
        <div className="flex w-full justify-center">
          <SignIn
            appearance={clerkAuthAppearance}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            forceRedirectUrl="/dashboard"
            fallbackRedirectUrl="/dashboard"
            signUpForceRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/dashboard"
          />
        </div>
      </div>
    </div>
  );
}
