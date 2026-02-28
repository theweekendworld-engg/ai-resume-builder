const features = [
  { title: 'ATS scoring', description: 'See keyword and section-level match quality instantly.' },
  { title: 'AI Copilot', description: 'Generate targeted edits with rationale before applying.' },
  { title: 'GitHub import', description: 'Turn relevant repositories into polished project bullets.' },
  { title: 'LaTeX export', description: 'Use built-in templates and export print-ready PDF output.' },
];

export function Features() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl px-4 py-4 pb-16 sm:px-6">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Key features</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-base font-semibold">{feature.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
