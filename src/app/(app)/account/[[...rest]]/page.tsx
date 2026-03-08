import { UserProfile } from '@clerk/nextjs';
import { clerkGlobalAppearance } from '@/lib/clerkAppearance';

export default function AccountPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.16),transparent_60%)]" />
      <div className="relative flex min-h-screen items-start justify-center px-4 py-8">
        <UserProfile path="/account" routing="path" appearance={clerkGlobalAppearance} />
      </div>
    </div>
  );
}

