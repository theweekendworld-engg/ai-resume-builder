const steps = [
  {
    title: 'Paste job description',
    description: 'Add the target role so the assistant knows what to optimize for.',
  },
  {
    title: 'Tailor your resume',
    description: 'Use guided edits, ATS suggestions, and AI rewrite actions per section.',
  },
  {
    title: 'Export and apply',
    description: 'Download a polished PDF or tweak LaTeX if you need advanced control.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Step {index + 1}</p>
            <h3 className="mt-2 text-base font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
