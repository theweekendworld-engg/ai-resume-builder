import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" aria-hidden />
      <div className="relative space-y-6">
        <p className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
          Your best self, on paper
        </p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Land your dream job with an AI-tailored resume
        </h1>
        <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
          Paste a job description, refine with AI suggestions, and export a polished, ATS-friendly PDF in minutes.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up">
            <Button size="lg">Get Started Free</Button>
          </Link>
          <a href="#how-it-works">
            <Button size="lg" variant="outline">See How It Works</Button>
          </a>
        </div>
      </div>

      <div className="patronus-glow-sm relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-primary/15 to-transparent" />
        <div className="relative rounded-xl border border-border/80 bg-background p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium">Live editor + preview</p>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Autosaved
            </span>
          </div>
          <div className="grid gap-3">
            <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
              <p className="mb-1 text-foreground">Target role</p>
              <p>Senior Frontend Engineer @ Stripe</p>
              <p className="mt-2 mb-1 text-foreground">Summary</p>
              <p>Built product experiences used by 1M+ users and improved conversion by 18%.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                <p className="mb-1 text-foreground">ATS score</p>
                <p className="text-lg font-semibold text-foreground">87%</p>
                <p className="mt-2">Missing: accessibility, observability.</p>
              </div>
              <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                <p className="mb-1 text-foreground">Copilot Suggestion</p>
                <p>Replace “worked on” with quantified impact bullets.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
