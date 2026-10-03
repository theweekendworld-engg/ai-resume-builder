'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  FileText,
  User,
  Send,
  FileDown,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PageHeader, PageTabs, pageContainer } from '@/components/patterns';
import type { UserProfileDTO } from '@/actions/profile';
import type { DashboardOverview } from '@/actions/dashboard';
import type { UserUsageStats } from '@/actions/usage';
import type { PdfHistoryItem } from '@/actions/pdfs';
import { OverviewSection } from '@/components/dashboard/sections/OverviewSection';
import { ResumesSection } from '@/components/dashboard/sections/ResumesSection';
import { DashboardCopilot } from '@/components/dashboard/sections/DashboardCopilot';
import { ProfileSection } from '@/components/dashboard/sections/ProfileSection';
import { TelegramSection } from '@/components/dashboard/sections/TelegramSection';
import { WhatsAppSection } from '@/components/dashboard/sections/WhatsAppSection';
import { PdfHistorySection } from '@/components/dashboard/sections/PdfHistorySection';
import { ApplicationsSection } from '@/components/dashboard/sections/ApplicationsSection';
import { DashboardTour, DASHBOARD_TOUR_STORAGE_KEY } from '@/components/dashboard/DashboardTour';

export type DashboardSectionId =
  | 'overview'
  | 'applications'
  | 'resumes'
  | 'copilot'
  | 'profile'
  | 'telegram'
  | 'pdf';

const NAV_ITEMS: { id: DashboardSectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  // Applications and Copilot left the menu (launch audit 2026-10-02): jobs
  // live in Jobs (/scout), and tailoring is /build or one chat message. Old
  // ?section= links still render them.
  { id: 'resumes', label: 'All resumes', icon: FileText },
  { id: 'profile', label: 'Profile', icon: User },
  // WhatsApp is named only where it is configured; production has no
  // WHATSAPP_* variables, and the old "Telegram & WhatsApp" promised a
  // channel nobody could link.
  { id: 'telegram', label: 'Channels', icon: Send },
  { id: 'pdf', label: 'PDFs', icon: FileDown },
];

export type DashboardShellProps = {
  overview: DashboardOverview;
  resumes: Array<{
    id: string;
    title: string;
    updatedAt: Date;
    targetRole: string | null;
    targetCompany: string | null;
    atsScore: number | null;
    atsSummary: string | null;
  }>;
  profile: UserProfileDTO | undefined;
  projects: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    githubUrl: string | null;
    technologies: string[];
    source: 'github' | 'manual';
    embedded: boolean;
    updatedAt: Date;
  }>;
  usageStats: UserUsageStats;
  pdfHistory: { success: boolean; items?: PdfHistoryItem[]; error?: string };
  applicationWorkspaces: Array<{
    id: string;
    sourceUrl: string;
    sourcePlatform: string | null;
    companyName: string | null;
    roleTitle: string | null;
    location: string | null;
    applicationStatus: string;
    fitScore: number | null;
    fitSummary: string | null;
    fitVerdict: string | null;
    scoutRunId: string | null;
    questionCount: number;
    answeredQuestionCount: number;
    selectedResumeId: string | null;
    updatedAt: Date;
    createdAt: Date;
  }>;
  applicationListError?: string;
  isAdmin: boolean;
  initialSection?: DashboardSectionId;
};

export function DashboardShell({
  overview,
  resumes,
  profile,
  projects,
  usageStats,
  pdfHistory,
  applicationWorkspaces,
  applicationListError,
  isAdmin,
  initialSection = 'overview',
}: DashboardShellProps) {
  const [activeSection, setActiveSection] = useState<DashboardSectionId>(initialSection);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // The tour waits for onboarding, which now happens at `/welcome` before
    // anyone reaches this screen.
    if (!overview.success || !overview.profile?.onboardingComplete) return;
    if (window.localStorage.getItem(DASHBOARD_TOUR_STORAGE_KEY)) return;
    const timer = window.setTimeout(() => {
      setTourOpen(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [overview.success, overview.profile?.onboardingComplete]);

  const select = (id: DashboardSectionId) => {
    setActiveSection(id);
    // Keep the section in the URL so reload and back land where you were.
    const url = new URL(window.location.href);
    if (id === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', id);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The page header and its tabs. The app shell (AppNav.tsx) owns the
        destinations, so this page no longer brings a second sidebar; its
        sections are tabs, scrollable on a phone.
      */}
      <PageHeader
        title="Resumes"
        description="Every resume is built from your record. Nothing in it is made up."
        actions={
          <>
            {isAdmin && (
              <Button asChild variant="ghost" size="sm" className="hidden h-8 sm:inline-flex">
                <Link href="/admin">Admin</Link>
              </Button>
            )}
            <Button asChild size="sm" className="h-8 gap-1.5">
              <Link href="/build">
                <Sparkles className="size-4" aria-hidden />
                Tailor a resume
              </Link>
            </Button>
          </>
        }
      >
        <PageTabs
          label="Resume sections"
          active={activeSection}
          tabs={NAV_ITEMS.map((item) => ({ key: item.id, label: item.label, icon: item.icon, onSelect: () => select(item.id) }))}
        />
      </PageHeader>

      <main className="flex-1">
        <div className={cn(pageContainer, 'py-6')}>
          {activeSection === 'overview' && (
            <OverviewSection overview={overview} usageStats={usageStats} />
          )}
          {activeSection === 'applications' && (
            <ApplicationsSection workspaces={applicationWorkspaces} listError={applicationListError} />
          )}
          {activeSection === 'resumes' && (
            <ResumesSection resumes={resumes} listError={!overview.success ? overview.error : undefined} />
          )}
          {activeSection === 'copilot' && <DashboardCopilot />}
          {activeSection === 'profile' && (
            <ProfileSection profile={profile} projects={projects} />
          )}
          {activeSection === 'telegram' && (
            <div className="space-y-6">
              <TelegramSection />
              <WhatsAppSection />
            </div>
          )}
          {activeSection === 'pdf' && <PdfHistorySection result={pdfHistory} />}
        </div>
      </main>

      <DashboardTour open={tourOpen} onOpenChange={setTourOpen} onNavigate={select} />
    </div>
  );
}
