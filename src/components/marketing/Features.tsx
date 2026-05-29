import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Target,
  BotMessageSquare,
  Github,
  FileText,
  MousePointerClick,
  LayoutDashboard,
  ArrowRight,
} from 'lucide-react';

const features = [
  {
    icon: Target,
    title: 'Know your odds before you apply',
    description:
      'Instant ATS and quality scoring shows exactly which keywords and sections are holding you back — so you fix the right things first.',
  },
  {
    icon: BotMessageSquare,
    title: 'Write stronger bullets in seconds',
    description:
      'The AI copilot rewrites weak lines into metric-driven impact statements, with clear rationale you can accept in one click.',
  },
  {
    icon: Github,
    title: 'Turn your work into proof',
    description:
      'Import your GitHub projects and let AI turn real commits and repos into polished, recruiter-ready bullet points.',
  },
  {
    icon: FileText,
    title: 'Export a PDF you’re proud of',
    description:
      'Pick a template, tune the look, and download a print-ready, ATS-safe PDF — no formatting headaches.',
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      {/* Differentiator: the build -> apply -> track story */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/50 p-8 sm:p-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,hsl(var(--primary)/0.08),transparent)]"
          aria-hidden
        />
        <div className="relative text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
            The part other tools skip
          </p>
          <h2 className="mx-auto mt-2 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Most resume tools stop at the PDF.{' '}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              We take you all the way to applied.
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            A polished resume is only half the job. Patronus carries your data
            from the builder straight into the application — and keeps every one
            organized in a single place.
          </p>
        </div>

        <div className="relative mt-10 grid gap-4 sm:grid-cols-2">
          <article className="flex gap-4 rounded-2xl border border-border/60 bg-background/40 p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MousePointerClick className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Auto-fill real applications</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                The browser extension reads the job description and fills
                multi-page application forms on Workday, Greenhouse, Lever, and
                LinkedIn — you review and click submit. We never auto-submit.
              </p>
            </div>
          </article>
          <article className="flex gap-4 rounded-2xl border border-border/60 bg-background/40 p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LayoutDashboard className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Track every application</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Each application lands in your workspace with the role, the
                tailored resume, and its status — so you always know what you
                sent where, and what to follow up on.
              </p>
            </div>
          </article>
        </div>

        <div className="relative mt-8 flex justify-center">
          <Link href="/sign-up?redirect_url=/build">
            <Button size="lg" className="group gap-2 px-6">
              Build &amp; apply with Patronus
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Benefit-framed capabilities */}
      <div className="mt-20 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
          What you get
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          From a rough draft to your next interview
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          Every tool here exists to get you in front of a recruiter faster.
        </p>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article
              key={feature.title}
              className="group flex gap-4 rounded-2xl border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/30 hover:bg-card/80"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
