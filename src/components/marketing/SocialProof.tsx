import { ShieldCheck, Star, ScanSearch } from 'lucide-react';

const signals = [
  {
    icon: ScanSearch,
    title: 'ATS-tested templates',
    description: 'Every layout is built to parse cleanly through applicant tracking systems.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    description: 'Files are processed in memory and never sold. Your data stays yours.',
  },
  {
    icon: Star,
    title: 'Built end-to-end',
    description: 'Score, build, export, apply, and track — one account, one workflow.',
  },
];

export function SocialProof() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 text-left sm:grid-cols-3 sm:p-5">
        {signals.map((signal) => {
          const Icon = signal.icon;
          return (
            <div key={signal.title} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">{signal.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {signal.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
