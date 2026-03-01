'use client';

import Link from 'next/link';
import type { DashboardOverview } from '@/actions/dashboard';
import type { DashboardSectionId } from '@/components/dashboard/DashboardShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

type OverviewSectionProps = {
  overview: DashboardOverview;
  onNavigate: (section: DashboardSectionId) => void;
};

export function OverviewSection({ overview, onNavigate }: OverviewSectionProps) {
  if (!overview.success) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {overview.error ?? 'Failed to load overview.'}
      </div>
    );
  }

  const name = overview.profile?.fullName?.trim() || 'there';
  const recentResumes = overview.recentResumes ?? [];
  const totalResumes = overview.totalResumes ?? 0;
  const totalPdfs = overview.totalPdfs ?? 0;
  const monthGens = overview.monthGenerations ?? 0;
  const projectCount = overview.projectCount ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
        <p className="text-muted-foreground">Here’s a quick snapshot of your dashboard.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick action</CardTitle>
          <CardDescription>Generate a resume from a job description.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => onNavigate('copilot')}>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate with Copilot
          </Button>
        </CardContent>
      </Card>

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
