'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import {
  LayoutDashboard,
  FileText,
  Sparkles,
  User,
  Send,
  BarChart3,
  FileDown,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import type { UserProfileDTO } from '@/actions/profile';
import type { DashboardOverview } from '@/actions/dashboard';
import type { UserUsageStats } from '@/actions/usage';
import type { PdfHistoryItem } from '@/actions/pdfs';
import { OverviewSection } from '@/components/dashboard/sections/OverviewSection';
import { ResumesSection } from '@/components/dashboard/sections/ResumesSection';
import { DashboardCopilot } from '@/components/dashboard/sections/DashboardCopilot';
import { ProfileSection } from '@/components/dashboard/sections/ProfileSection';
import { TelegramSection } from '@/components/dashboard/sections/TelegramSection';
import { UsageSection } from '@/components/dashboard/sections/UsageSection';
import { PdfHistorySection } from '@/components/dashboard/sections/PdfHistorySection';
import { OnboardingDialog } from '@/components/dashboard/OnboardingDialog';
import { DashboardTour, DASHBOARD_TOUR_STORAGE_KEY } from '@/components/dashboard/DashboardTour';

export type DashboardSectionId =
  | 'overview'
  | 'resumes'
  | 'copilot'
  | 'profile'
  | 'telegram'
  | 'usage'
  | 'pdf';

const NAV_ITEMS: { id: DashboardSectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'resumes', label: 'My Resumes', icon: <FileText className="h-4 w-4" /> },
  { id: 'copilot', label: 'Copilot', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'profile', label: 'Profile', icon: <User className="h-4 w-4" /> },
  { id: 'telegram', label: 'Telegram', icon: <Send className="h-4 w-4" /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'pdf', label: 'PDF History', icon: <FileDown className="h-4 w-4" /> },
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
  isAdmin: boolean;
};

export function DashboardShell({
  overview,
  resumes,
  profile,
  projects,
  usageStats,
  pdfHistory,
  isAdmin,
}: DashboardShellProps) {
  const [activeSection, setActiveSection] = useState<DashboardSectionId>('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!overview.success || !overview.profile?.onboardingComplete) return;
    if (window.localStorage.getItem(DASHBOARD_TOUR_STORAGE_KEY)) return;
    const timer = window.setTimeout(() => {
      setTourOpen(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [overview.success, overview.profile?.onboardingComplete]);

  const handleOnboardingComplete = () => {
    setOnboardingDismissed(true);
    setTourOpen(true);
  };

  const showOnboarding =
    overview.success && !overview.profile?.onboardingComplete && !onboardingDismissed;

  const navContent = (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <Button
          key={item.id}
          variant={activeSection === item.id ? 'secondary' : 'ghost'}
          className="justify-start gap-3"
          onClick={() => {
            setActiveSection(item.id);
            setNavOpen(false);
          }}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent id="dashboard-mobile-nav-sheet" side="left" className="w-64 p-4">
              <div className="mb-4 font-semibold">Dashboard</div>
              {navContent}
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold">
            {NAV_ITEMS.find((i) => i.id === activeSection)?.label ?? 'Dashboard'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link href="/admin">
              <Button variant="ghost" size="sm">
                Admin
              </Button>
            </Link>
          )}
          <UserButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card/50 md:block md:p-3">
          <div className="sticky top-0 space-y-2 py-2">{navContent}</div>
        </aside>

        <main className="flex-1 overflow-auto px-4 py-6 md:px-6">
          <div className="mx-auto max-w-4xl">
            {activeSection === 'overview' && (
              <OverviewSection
                overview={overview}
                onNavigate={setActiveSection}
              />
            )}
            {activeSection === 'resumes' && (
              <ResumesSection resumes={resumes} listError={!overview.success ? overview.error : undefined} />
            )}
            {activeSection === 'copilot' && <DashboardCopilot />}
            {activeSection === 'profile' && (
              <ProfileSection profile={profile} projects={projects} />
            )}
            {activeSection === 'telegram' && <TelegramSection />}
            {activeSection === 'usage' && <UsageSection result={usageStats} />}
            {activeSection === 'pdf' && <PdfHistorySection result={pdfHistory} />}
          </div>
        </main>
      </div>

      {showOnboarding && (
        <OnboardingDialog
          profile={profile}
          onComplete={handleOnboardingComplete}
        />
      )}
      <DashboardTour open={tourOpen} onOpenChange={setTourOpen} onNavigate={setActiveSection} />
    </div>
  );
}
