import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { listResumes } from '@/actions/resume';
import { CreateResumeCard } from '@/components/dashboard/CreateResumeCard';
import { ResumeCard } from '@/components/dashboard/ResumeCard';

export default async function DashboardPage() {
  const result = await listResumes();
  const resumes = result.success ? result.resumes ?? [] : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your resumes</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/">
            <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">Home</span>
          </Link>
          <UserButton />
        </div>
      </header>

      {!result.success && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {result.error ?? 'Failed to load your resumes.'}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CreateResumeCard />
        {resumes.map((resume) => (
          <ResumeCard
            key={resume.id}
            resume={{
              id: resume.id,
              title: resume.title,
              updatedAt: resume.updatedAt,
              targetRole: resume.targetRole,
              targetCompany: resume.targetCompany,
              atsScore: resume.atsScore,
              atsSummary: resume.atsSummary,
            }}
          />
        ))}
      </div>

      {resumes.length === 0 && result.success && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          You don&apos;t have any resumes yet. Start with the create card above.
        </div>
      )}
    </div>
  );
}
