import { ClipboardPaste, Sparkles, Download } from 'lucide-react';

const steps = [
  {
    icon: ClipboardPaste,
    title: 'Paste the job description',
    description:
      'Drop in the listing so AI understands exactly what the role requires.',
  },
  {
    icon: Sparkles,
    title: 'Tailor with AI',
    description:
      'Get section-level rewrites, keyword suggestions, and ATS scoring in real time.',
  },
  {
    icon: Download,
    title: 'Export & apply',
    description:
      'Download a polished PDF or fine-tune with LaTeX — then hit apply.',
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
          Three steps to a better resume
        </h2>
      </div>

      <div className="mt-14 grid gap-8 sm:gap-6 md:grid-cols-3">
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
