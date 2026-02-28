import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { listResumes } from '@/actions/resume';
import { getUserProfile } from '@/actions/profile';
import { listUserProjects } from '@/actions/projects';
import { CreateResumeCard } from '@/components/dashboard/CreateResumeCard';
import { ResumeCard } from '@/components/dashboard/ResumeCard';
import { ProfilePanel } from '@/components/dashboard/ProfilePanel';
import { ProjectLibraryPanel } from '@/components/dashboard/ProjectLibraryPanel';

export default async function DashboardPage() {
  const [resumeResult, profileResult, projectsResult] = await Promise.all([
    listResumes(),
    getUserProfile(),
    listUserProjects(),
  ]);
  const resumes = resumeResult.success ? resumeResult.resumes ?? [] : [];
  const profile = profileResult.success ? profileResult.profile : undefined;
  const projects = projectsResult.success ? projectsResult.projects ?? [] : [];

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

      {!resumeResult.success && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {resumeResult.error ?? 'Failed to load your resumes.'}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ProfilePanel profile={profile} />
        <ProjectLibraryPanel projects={projects} />
      </div>

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

      {resumes.length === 0 && resumeResult.success && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          You don&apos;t have any resumes yet. Start with the create card above.
        </div>
      )}
    </div>
  );
}
