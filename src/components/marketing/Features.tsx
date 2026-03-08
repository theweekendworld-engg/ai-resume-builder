import { Target, BotMessageSquare, Github, FileText } from 'lucide-react';

const features = [
  {
    icon: Target,
    title: 'ATS scoring',
    description:
      'Instant keyword and section-level match scoring so you know where you stand.',
  },
  {
    icon: BotMessageSquare,
    title: 'AI Copilot',
    description:
      'Context-aware edit suggestions with clear rationale — accept in one click.',
  },
  {
    icon: Github,
    title: 'GitHub import',
    description:
      'Pull in relevant repos and auto-generate polished project bullets.',
  },
  {
    icon: FileText,
    title: 'LaTeX export',
    description:
      'Choose from built-in templates and export a print-ready PDF instantly.',
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
          Features
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Everything you need, nothing you don&apos;t
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          Purpose-built tools to help you move from draft to dream job faster.
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
