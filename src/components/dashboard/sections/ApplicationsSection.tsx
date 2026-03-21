'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ApplicationWorkspaceItem = {
  id: string;
  sourceUrl: string;
  sourcePlatform: string | null;
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  applicationStatus: string;
  fitScore: number | null;
  fitSummary: string | null;
  questionCount: number;
  answeredQuestionCount: number;
  selectedResumeId: string | null;
  updatedAt: Date;
  createdAt: Date;
};

type ApplicationsSectionProps = {
  workspaces: ApplicationWorkspaceItem[];
  listError?: string;
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ApplicationsSection({ workspaces, listError }: ApplicationsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="text-muted-foreground">Recent browser-saved job workspaces and their question progress.</p>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {listError}
        </div>
      )}

      {workspaces.length === 0 && !listError && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No application workspaces yet. Open a supported job page in the browser extension and it will start saving your application context here.
        </div>
      )}

      <div className="grid gap-4">
        {workspaces.map((workspace) => (
          <Card key={workspace.id}>
            <CardHeader className="gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{workspace.roleTitle || 'Untitled role'}</CardTitle>
                  <CardDescription>
                    {workspace.companyName || 'Unknown company'}
                    {workspace.location ? ` • ${workspace.location}` : ''}
                    {workspace.sourcePlatform ? ` • ${workspace.sourcePlatform}` : ''}
                  </CardDescription>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatStatus(workspace.applicationStatus)}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Fit score</p>
                  <p className="mt-1 text-lg font-semibold">{workspace.fitScore ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Questions</p>
                  <p className="mt-1 text-lg font-semibold">
                    {workspace.answeredQuestionCount}/{workspace.questionCount}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Updated</p>
                  <p className="mt-1 text-sm font-medium">{workspace.updatedAt.toLocaleString()}</p>
                </div>
              </div>

              {workspace.fitSummary && (
                <p className="text-sm text-muted-foreground">{workspace.fitSummary}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Link href={workspace.sourceUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">Open Job Page</Button>
                </Link>
                {workspace.selectedResumeId && (
                  <Link href={`/editor/${workspace.selectedResumeId}`}>
                    <Button variant="outline" size="sm">Open Resume</Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
