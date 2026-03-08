import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check } from 'lucide-react';

const perks = [
  'Unlimited resumes',
  'AI-powered suggestions',
  'ATS scoring',
  'PDF & LaTeX export',
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/50">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,hsl(var(--primary)/0.06),transparent)]"
          aria-hidden
        />

        <div className="relative grid items-center gap-10 p-8 sm:p-12 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
              Pricing
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Start free.{' '}
              <span className="text-muted-foreground">Upgrade when you&apos;re ready.</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Build and export your first resumes completely free. Power users
              can unlock higher AI limits and priority generation.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/sign-up">
                <Button size="lg" className="group gap-2">
                  Get started free
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="mailto:sales@patronus.app">
                <Button size="lg" variant="ghost" className="text-muted-foreground">
                  Talk to sales
                </Button>
              </a>
            </div>
          </div>

          <ul className="grid gap-3 sm:gap-2">
            {perks.map((perk) => (
              <li key={perk} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Check className="h-4 w-4 shrink-0 text-primary/70" strokeWidth={2} />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
