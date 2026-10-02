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
  /** Set when Scout analysed this job; links the row to that analysis. */
  scoutRunId?: string | null;
  /** Scout's verdict: strong | possible | stretch | not_a_fit | unknown. */
  fitVerdict?: string | null;
};

const VERDICT_WORDS: Record<string, string> = {
  strong: 'Strong fit',
  possible: 'Possible fit',
  stretch: 'Stretch',
  not_a_fit: 'Not a fit',
  unknown: 'Fit unclear',
};

/**
 * Jobs pasted as text into Scout have no real URL; the tracker stores
 * `scout:<id>` so the (userId, sourceUrl) unique still holds. That value is a
 * key, not a link: it must never be rendered as one, or as text.
 */
function isRealUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

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
        <h2 className="font-heading text-lg font-semibold tracking-tight">Applications</h2>
        <p className="text-sm text-muted-foreground">Recent browser-saved job workspaces and their question progress.</p>
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
                  {workspace.fitVerdict && VERDICT_WORDS[workspace.fitVerdict] ? (
                    <p className="text-xs text-muted-foreground">{VERDICT_WORDS[workspace.fitVerdict]}</p>
                  ) : null}
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
                {workspace.scoutRunId ? (
                  <Link href={`/scout/${workspace.scoutRunId}`}>
                    <Button variant="outline" size="sm">Open analysis</Button>
                  </Link>
                ) : null}
                {isRealUrl(workspace.sourceUrl) ? (
                  <Link href={workspace.sourceUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">Open Job Page</Button>
                  </Link>
                ) : null}
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
