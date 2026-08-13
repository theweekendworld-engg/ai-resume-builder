import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Hero } from '@/components/marketing/Hero';
import { EvidenceTicker } from '@/components/marketing/EvidenceTicker';
import { TheProblem } from '@/components/marketing/TheProblem';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Guarantees } from '@/components/marketing/Guarantees';
import { Features } from '@/components/marketing/Features';
import { Provenance } from '@/components/marketing/Provenance';
import { Faq } from '@/components/marketing/Faq';
import { Contact } from '@/components/marketing/Contact';
import { ClosingCta } from '@/components/marketing/ClosingCta';

/**
 * The argument, in order: here is the thing → here is what it produces → here
 * is why you need it → here is why it will actually stick → here is what we
 * guarantee → here is what it gives back → here is why you can trust it →
 * here are your remaining objections → here is how to reach us.
 *
 * Trust sits immediately before the questions on purpose. It is the last thing
 * a reader weighs before they start hunting for reasons this will not work.
 *
 * ── Pricing ─────────────────────────────────────────────────────────────────
 *
 * `<Pricing />` used to sit where `<Contact />` now does. Its plan cards read
 * from `PLAN_CATALOG`, but the Stripe Prices behind Career and Search do not
 * exist yet (CLAUDE.md, "what is not proven"), so the page was quoting numbers
 * nothing could actually charge. The component is intact and still covered by
 * `pricing.test.ts` — restoring it is this import plus one line below, on the
 * day those Price objects are created.
 *
 * ── Rhythm ──────────────────────────────────────────────────────────────────
 *
 * The two full-bleed bands — EvidenceTicker and Guarantees — are placed to
 * break up the runs of contained sections, so no more than two centred
 * containers sit next to each other. Nine identical containers in a row scroll
 * like one very long section; the band is what tells the eye a new argument
 * has started.
 */
export default async function MarketingHomePage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  return (
    <>
      <Hero />
      <EvidenceTicker />
      <TheProblem />
      <HowItWorks />
      <Guarantees />
      <Features />
      <Provenance />
      <Faq />
      <Contact />
      <ClosingCta />
    </>
  );
}
