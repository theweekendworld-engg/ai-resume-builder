import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Hero } from '@/components/marketing/Hero';
import { TheProblem } from '@/components/marketing/TheProblem';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Features } from '@/components/marketing/Features';
import { Provenance } from '@/components/marketing/Provenance';
import { Pricing } from '@/components/marketing/Pricing';
import { ClosingCta } from '@/components/marketing/ClosingCta';

/**
 * The argument, in order: here is the thing → here is why you need it →
 * here is why it will actually stick → here is what it gives back → here is
 * why you can trust it → here is what it costs.
 *
 * Trust sits immediately before pricing on purpose. It is the last question a
 * reader asks before deciding whether the number is worth it.
 */
export default async function MarketingHomePage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  return (
    <>
      <Hero />
      <TheProblem />
      <HowItWorks />
      <Features />
      <Provenance />
      <Pricing />
      <ClosingCta />
    </>
  );
}
