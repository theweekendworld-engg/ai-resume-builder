import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-4 pb-16 sm:px-6">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Pricing</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Start free. Upgrade when you need more.</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Build and export your first resumes for free. Power users can unlock higher AI limits and priority generation.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/sign-up">
            <Button>Get Started Free</Button>
          </Link>
          <a href="mailto:sales@resumepilot.app">
            <Button variant="outline">Talk to Sales</Button>
          </a>
        </div>
      </div>
    </section>
  );
}
