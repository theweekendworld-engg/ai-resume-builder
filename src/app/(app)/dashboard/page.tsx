import { auth } from '@clerk/nextjs/server';
import { getDashboardOverview, listApplicationWorkspaces } from '@/actions/dashboard';
import { listResumes } from '@/actions/resume';
import { listUserProjects } from '@/actions/projects';
import { getUserUsageStats } from '@/actions/usage';
import { getUserPdfHistory } from '@/actions/pdfs';
import { isAdminUserId } from '@/lib/adminAuth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

const KNOWN_SECTIONS = ['overview', 'applications', 'resumes', 'copilot', 'profile', 'telegram', 'pdf'] as const;
type KnownSection = (typeof KNOWN_SECTIONS)[number];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { userId } = await auth();
  const isAdmin = isAdminUserId(userId);
  const params = await searchParams;
  const sectionParam = typeof params.section === 'string' ? params.section : '';
  const initialSection: KnownSection = (KNOWN_SECTIONS as readonly string[]).includes(sectionParam)
    ? (sectionParam as KnownSection)
    : 'overview';
  const [overviewResult, resumeResult, projectsResult, usageStats, pdfHistory, applicationWorkspacesResult] = await Promise.all([
    getDashboardOverview(),
    listResumes(),
    listUserProjects(),
    getUserUsageStats(),
    getUserPdfHistory(),
    listApplicationWorkspaces(),
  ]);

  const overview = overviewResult.success
    ? overviewResult
    : { success: false as const, error: overviewResult.error };
  const resumes = resumeResult.success ? resumeResult.resumes ?? [] : [];
  const profile = overviewResult.success ? overviewResult.profile ?? undefined : undefined;
  const projects = projectsResult.success ? projectsResult.projects ?? [] : [];
  const applicationWorkspaces = applicationWorkspacesResult.success ? applicationWorkspacesResult.workspaces ?? [] : [];

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
      // A ?section= link to this same route remounts on the new section.
      key={initialSection}
      overview={overview}
      resumes={resumes}
      profile={profile}
      projects={projectItems}
      usageStats={usageStats}
      pdfHistory={pdfHistory}
      applicationWorkspaces={applicationWorkspaces}
      applicationListError={!applicationWorkspacesResult.success ? applicationWorkspacesResult.error : undefined}
      isAdmin={!!isAdmin}
      initialSection={initialSection}
    />
  );
}
