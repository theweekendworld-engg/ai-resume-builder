import { auth } from '@clerk/nextjs/server';
import { getDashboardOverview } from '@/actions/dashboard';
import { listResumes } from '@/actions/resume';
import { listUserProjects } from '@/actions/projects';
import { getUserUsageStats } from '@/actions/usage';
import { getUserPdfHistory } from '@/actions/pdfs';
import { isAdminUserId } from '@/lib/adminAuth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export default async function DashboardPage() {
  const { userId } = await auth();
  const isAdmin = isAdminUserId(userId);
  const [overviewResult, resumeResult, projectsResult, usageStats, pdfHistory] = await Promise.all([
    getDashboardOverview(),
    listResumes(),
    listUserProjects(),
    getUserUsageStats(),
    getUserPdfHistory(),
  ]);

  const overview = overviewResult.success
    ? overviewResult
    : { success: false as const, error: overviewResult.error };
  const resumes = resumeResult.success ? resumeResult.resumes ?? [] : [];
  const profile = overviewResult.success ? overviewResult.profile ?? undefined : undefined;
  const projects = projectsResult.success ? projectsResult.projects ?? [] : [];

  const projectItems = projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    url: p.url,
    githubUrl: p.githubUrl,
    technologies: p.technologies,
    source: p.source as 'github' | 'manual',
    embedded: p.embedded,
    updatedAt: p.updatedAt,
  }));

  return (
    <DashboardShell
      overview={overview}
      resumes={resumes}
      profile={profile}
      projects={projectItems}
      usageStats={usageStats}
      pdfHistory={pdfHistory}
      isAdmin={!!isAdmin}
    />
  );
}
