import { auth } from '@clerk/nextjs/server';

import { GlobalGenerationBanner } from '@/components/app/GlobalGenerationBanner';
import { AppNav, type NavDestination } from '@/components/app/AppNav';
import { getEnabledFlags } from '@/lib/flags';

/**
 * The app shell.
 *
 * Flags are resolved here, once, in a single round trip, and only destinations
 * the user can actually open are handed to the nav — so a link never points at
 * a surface that would `notFound()`.
 *
 * `/dashboard` and `/build` carry no flag: they are the product every customer
 * has, and they are what the nav falls back to when everything else is off.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  let destinations: NavDestination[] = ['resumes'];
  if (userId) {
    const flags = await getEnabledFlags(userId);
    destinations = [
      ...(flags.missions ? (['home'] as const) : []),
      ...(flags.work_log ? (['log'] as const) : []),
      ...(flags.scout ? (['scout'] as const) : []),
      'resumes',
      ...(flags.review_packet ? (['packets'] as const) : []),
      ...(flags.career_radar ? (['radar'] as const) : []),
    ];
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <GlobalGenerationBanner />
      <AppNav destinations={destinations} />
      {children}
    </div>
  );
}
