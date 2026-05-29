import { FileSearch, Sparkles, Download, SendHorizonal } from 'lucide-react';

const steps = [
  {
    icon: FileSearch,
    title: 'Check your score',
    description:
      'Drop in your current resume and get an instant ATS and quality score with a prioritized fix list — no account needed.',
  },
  {
    icon: Sparkles,
    title: 'Build & tailor with AI',
    description:
      'Fix every flagged issue in the editor. Paste a job description and let AI tailor each bullet to the role.',
  },
  {
    icon: Download,
    title: 'Export a polished PDF',
    description:
      'Pick a template, tune the design, and download a clean, ATS-safe PDF you’re proud to send.',
  },
  {
    icon: SendHorizonal,
    title: 'Apply & track',
    description:
      'Auto-fill applications with the browser extension and keep every one organized in your workspace.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
          How it works
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          From score to submitted, in one place
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          One account carries you across the whole journey — no re-uploading, no
          re-onboarding.
        </p>
      </div>

      <div className="mt-14 grid gap-8 sm:gap-6 md:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <article
              key={step.title}
              className="group relative rounded-2xl border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/30 hover:bg-card/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                Step {index + 1}
              </p>
              <h3 className="mt-3 text-base font-semibold leading-snug">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
