import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Features } from '@/components/marketing/Features';
import { Pricing } from '@/components/marketing/Pricing';

export default async function MarketingHomePage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
    </>
  );
}
