import { auth } from '@clerk/nextjs/server';
import { getDashboardOverview } from '@/actions/dashboard';
import { listResumes } from '@/actions/resume';
import { listUserProjects } from '@/actions/projects';
import { isAdminUserId } from '@/lib/adminAuth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export default async function DashboardPage() {
  const { userId } = await auth();
  const isAdmin = isAdminUserId(userId);
  const [overviewResult, resumeResult, projectsResult] = await Promise.all([
    getDashboardOverview(),
    listResumes(),
    listUserProjects(),
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
    updatedAt: p.updatedAt,
  }));

  return (
    <DashboardShell
      overview={overview}
      resumes={resumes}
      profile={profile}
      projects={projectItems}
      isAdmin={!!isAdmin}
    />
  );
}
