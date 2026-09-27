'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileUp, Wand2 } from 'lucide-react';
import type { DashboardOverview } from '@/actions/dashboard';
import { getActivationState, type ActivationState } from '@/actions/onboarding';
import type { UserUsageStats } from '@/actions/usage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

  const firstName = overview.profile?.fullName?.trim().split(/\s+/)[0] ?? '';
  const recentResumes = overview.recentResumes ?? [];
  const totalResumes = overview.totalResumes ?? 0;
  const totalPdfs = overview.totalPdfs ?? 0;
  const monthGens = overview.monthGenerations ?? 0;
  const projectCount = overview.projectCount ?? 0;
  const totalApplications = overview.totalApplications ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {totalResumes === 0 ? (firstName ? `Welcome, ${firstName}` : 'Welcome') : firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </h1>
        <p className="text-muted-foreground">
          {activation && remainingLabel(activation) ? remainingLabel(activation) : 'Everything you are working on, in one place.'}
        </p>
      </div>

      {activation && nextStepFor(activation) ? (() => {
        const step = nextStepFor(activation)!;
        const Icon = step.icon === 'upload' ? FileUp : Wand2;
        return (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                {step.title}
              </CardTitle>
              <CardDescription>{step.body}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Link href={step.href}>
                <Button className="gap-2">
                  {step.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
              <Link href="/dashboard?section=profile" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                Resume preferences (length, tone)
              </Link>
            </CardContent>
          </Card>
        );
      })() : null}

      {/* A row of zeros is noise on a first visit; it appears once there is something to count. */}
      {(!activation || activation.hasHistory || totalResumes > 0) && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resumes</CardDescription>
            <CardTitle className="text-2xl">{totalResumes}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>PDFs generated</CardDescription>
            <CardTitle className="text-2xl">{totalPdfs}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This month</CardDescription>
            <CardTitle className="text-2xl">{monthGens}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projects</CardDescription>
            <CardTitle className="text-2xl">{projectCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Applications</CardDescription>
            <CardTitle className="text-2xl">{totalApplications}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      )}

            {usageStats.success && usageStats.stats && (
        <>
          <h2 className="text-lg font-semibold">Usage this period</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/*
              A dollar figure and a raw token count were here.
              Removed: neither is a fact about the user, they are facts about
              our supplier bill. A customer on a $5 plan does not benefit from
              learning their resume cost us 23 cents — it invites the question
              of why the plan is $5, and it exposes a number that moves when we
              change model. What they need is what the plan promised: how many
              resumes are left. Cost stays in /admin, where a decision is made
              from it.
            */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Generations completed</CardDescription>
                <CardTitle className="text-2xl">{usageStats.stats.generationsCompleted}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Generations failed</CardDescription>
                <CardTitle className="text-2xl">{usageStats.stats.generationsFailed}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>PDFs generated</CardDescription>
                <CardTitle className="text-2xl">{usageStats.stats.pdfsGenerated}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </>
      )}

      {recentResumes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent resumes</CardTitle>
            <CardDescription>Jump back into editing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentResumes.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div>
                  <p className="font-medium">{r.title || 'Untitled'}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.targetRole ?? '—'}
                    {r.targetCompany ? ` @ ${r.targetCompany}` : ''}
                  </p>
                </div>
                <Link href={`/editor/${r.id}`}>
                  <Button variant="outline" size="sm">
                    Open
                  </Button>
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
