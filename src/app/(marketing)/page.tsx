import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Hero } from '@/components/marketing/Hero';
import { EvidenceTicker } from '@/components/marketing/EvidenceTicker';
import { TheProblem } from '@/components/marketing/TheProblem';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Channels } from '@/components/marketing/Channels';
import { JobSearch } from '@/components/marketing/JobSearch';
import { Guarantees } from '@/components/marketing/Guarantees';
import { Features } from '@/components/marketing/Features';
import { Provenance } from '@/components/marketing/Provenance';
import { Faq } from '@/components/marketing/Faq';
import { Pricing } from '@/components/marketing/Pricing';
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
 * ── The job search ──────────────────────────────────────────────────────────
 *
 * `<JobSearch />` (2026-11-07) sits after Channels: once a reader knows where
 * they talk to it, it shows what it does for a search, from the nightly alert
 * to the tracked reply. Between the sunken Channels band and the Guarantees
 * band, so the rhythm rule below still holds.
 *
 * ── Pricing ─────────────────────────────────────────────────────────────────
 *
 * Free while we launch, every feature included (owner decision, 2026-11-07).
 * Payments are not live, so there are no paid columns and no "Opening soon"
 * buttons; one quiet line says paid plans come later. Contact is its own
 * section rather than standing in for pricing.
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
    redirect('/app');
  }

  return (
    <>
      <Hero />
      <EvidenceTicker />
      <TheProblem />
      <HowItWorks />
      <Channels />
      <JobSearch />
      <Guarantees />
      <Features />
      <Provenance />
      <Pricing />
      <Faq />
      <Contact />
      <ClosingCta />
    </>
  );
}
