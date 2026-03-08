import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Background gradient orbs */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.15),transparent_70%)] blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-60 -right-40 -z-10 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.08),transparent_70%)] blur-3xl"
        aria-hidden
      />

      <div className="mx-auto max-w-3xl px-4 pb-20 pt-24 text-center sm:px-6 sm:pt-32 sm:pb-28">
        <div className="animate-fade-in-up flex justify-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 blur-3xl scale-150 rounded-full bg-primary/40" />
            <img src="/logo.png" alt="Patronus Logo" className="relative h-24 w-auto object-contain drop-shadow-[0_0_24px_rgba(143,201,255,0.8)]" />
          </div>
        </div>

        <p className="animate-fade-in-up animation-delay-100 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-medium tracking-wide text-primary/90">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60" />
          AI-powered resume builder
        </p>

        <h1 className="animate-fade-in-up animation-delay-100 mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl md:text-6xl">
          Resumes that get you{' '}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            interviews
          </span>
        </h1>

        <p className="animate-fade-in-up animation-delay-200 mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Paste a job description, let AI tailor every bullet, and export a
          polished, ATS-optimized PDF — in minutes, not hours.
        </p>

        <div className="animate-fade-in-up animation-delay-300 mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-up">
            <Button size="lg" className="group gap-2 px-6">
              Start for free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <a href="#how-it-works">
            <Button size="lg" variant="ghost" className="text-muted-foreground">
              See how it works
            </Button>
          </a>
        </div>

        <p className="animate-fade-in-up animation-delay-400 mt-5 text-xs text-muted-foreground/60">
          No credit card required · Free forever plan
        </p>
      </div>
    </section>
  );
}
