'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, FileUp, Wand2 } from 'lucide-react';
import type { DashboardOverview } from '@/actions/dashboard';
import { getActivationState, type ActivationState } from '@/actions/onboarding';
import type { UserUsageStats } from '@/actions/usage';
import { Button } from '@/components/ui/button';

type OverviewSectionProps = {
  overview: DashboardOverview;
  usageStats: UserUsageStats;
};

/**
 * The one thing to do next, from what the user actually has. An empty
 * dashboard used to say "Welcome back, there" over a row of zeros with no
 * action on it (audit 2026-09-27, E).
 */
export function nextStepFor(state: ActivationState): { title: string; body: string; href: string; cta: string; icon: 'upload' | 'tailor' } | null {
  if (!state.hasHistory) {
    return {
      title: 'Start with your resume',
      body: 'Upload the resume you have. We read your roles and projects in once, and everything you make here builds on your real work.',
      href: '/build',
      cta: 'Upload your resume',
      icon: 'upload',
    };
  }
  if (state.tailored === 0) {
    return {
      title: 'Tailor it for a job',
      body: 'Paste a job description and get a version of your resume aimed at it, built only from what is true in your history.',
      href: '/build',
      cta: 'Tailor it for a job',
      icon: 'tailor',
    };
  }
  return null;
}

function remainingLabel(state: ActivationState): string | null {
  if (state.tailoredRemaining === null || state.tailoredLimit === null) return null;
  return `${state.tailoredRemaining} of ${state.tailoredLimit} free tailored resumes left`;
}

export function OverviewSection({ overview, usageStats }: OverviewSectionProps) {
  const [activation, setActivation] = useState<ActivationState | null>(null);
  useEffect(() => {
    let mounted = true;
    void getActivationState().then((result) => {
      if (mounted && result.success) setActivation(result.data);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!overview.success) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {overview.error ?? 'Failed to load overview.'}
      </div>
    );
  }

  const recentResumes = overview.recentResumes ?? [];
  const totalResumes = overview.totalResumes ?? 0;
  const stats: Array<[string, number]> = [
    ['Resumes', totalResumes],
    ['Tailored this month', usageStats.success && usageStats.stats ? usageStats.stats.generationsCompleted : overview.monthGenerations ?? 0],
    ['PDFs', overview.totalPdfs ?? 0],
    ['Projects', overview.projectCount ?? 0],
  ];
  const step = activation ? nextStepFor(activation) : null;
  const remaining = activation ? remainingLabel(activation) : null;

  // The page header (DashboardShell) carries the title. This is what to do
  // next, a count strip, and the resumes you were last in. Usage in dollars
  // and tokens stays in /admin: it is our supplier bill, not the user's fact.
  return (
    <div className="space-y-8">
      {step ? (() => {
        const Icon = step.icon === 'upload' ? FileUp : Wand2;
        return (
          <section className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-heading text-base font-semibold">{step.title}</h2>
                <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{step.body}</p>
              </div>
            </div>
            <Button asChild className="shrink-0 gap-2">
              <Link href={step.href}>
                {step.cta}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </section>
        );
      })() : null}

      {/* A row of zeros is noise on a first visit; it appears once there is something to count. */}
      {(!activation || activation.hasHistory || totalResumes > 0) && (
        <section>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="bg-card px-4 py-4">
                <dd className="font-heading text-2xl font-semibold tabular-nums">{value}</dd>
                <dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>
          {remaining ? <p className="mt-2 text-xs text-muted-foreground">{remaining}</p> : null}
        </section>
      )}

      {recentResumes.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-heading text-base font-semibold">Recent resumes</h2>
            <Link href="/dashboard?section=resumes" className="text-sm text-primary hover:underline">See all</Link>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {recentResumes.map((r) => (
              <li key={r.id}>
                <Link href={`/editor/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/60">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title || 'Untitled'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.targetRole, r.targetCompany].filter(Boolean).join(' at ') || 'Base resume'}
                      {' · '}
                      {formatUpdated(r.updatedAt)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard?section=profile" className="font-medium text-primary hover:underline">Resume preferences</Link>
        {' '}set length and tone for every resume you make.
      </p>
    </div>
  );
}

function formatUpdated(date: Date): string {
  return `edited ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
