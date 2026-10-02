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
 * ── Pricing ─────────────────────────────────────────────────────────────────
 *
 * `<Pricing />` is back (2026-09-27). Payments are not live yet, so the paid
 * columns say "Opening soon" instead of linking to checkout — but the prices
 * are public: a visitor deciding whether to invest in a record deserves to
 * know what it will cost, and a payment gateway's review requires a visible
 * price list. Contact is its own section again rather than standing in for it.
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
