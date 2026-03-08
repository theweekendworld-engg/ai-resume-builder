'use client';

import { CreateResumeCard } from '@/components/dashboard/CreateResumeCard';
import { ResumeCard } from '@/components/dashboard/ResumeCard';

type ResumeItem = {
  id: string;
  title: string;
  updatedAt: Date;
  targetRole: string | null;
  targetCompany: string | null;
  atsScore: number | null;
  atsSummary: string | null;
};

type ResumesSectionProps = {
  resumes: ResumeItem[];
  listError?: string;
};

export function ResumesSection({ resumes, listError }: ResumesSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Resumes</h1>
        <p className="text-muted-foreground">Create and manage your resumes.</p>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {listError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CreateResumeCard />
        {resumes.map((resume) => (
          <ResumeCard key={resume.id} resume={resume} />
        ))}
      </div>

      {resumes.length === 0 && !listError && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          You don&apos;t have any resumes yet. Use the create card above or try the Copilot to generate one from a job description.
        </div>
      )}
    </div>
  );
}
