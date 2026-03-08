'use client';

import {
  LayoutDashboard,
  FileText,
  Sparkles,
  User,
  Send,
  BarChart3,
  FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DashboardSectionId } from '@/components/dashboard/DashboardShell';

export const DASHBOARD_TOUR_STORAGE_KEY = 'dashboard-tour-dismissed-v1';

const SECTIONS: { id: DashboardSectionId; title: string; description: string; icon: React.ReactNode }[] = [
  { id: 'overview', title: 'Overview', description: 'Welcome, quick stats, and recent resumes.', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'copilot', title: 'Copilot', description: 'Paste a job description and get a complete resume.', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'resumes', title: 'My Resumes', description: 'Create and manage all your resumes.', icon: <FileText className="h-4 w-4" /> },
  { id: 'profile', title: 'Profile', description: 'Personal info, experience, education, and preferences.', icon: <User className="h-4 w-4" /> },
  { id: 'telegram', title: 'Telegram', description: 'Link Telegram to generate resumes from the bot.', icon: <Send className="h-4 w-4" /> },
  { id: 'pdf', title: 'PDF History', description: 'Download previously generated PDFs.', icon: <FileDown className="h-4 w-4" /> },
  { id: 'usage', title: 'Usage', description: 'View your usage and limits.', icon: <BarChart3 className="h-4 w-4" /> },
];

type DashboardTourProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (section: DashboardSectionId) => void;
};

export function DashboardTour({ open, onOpenChange, onNavigate }: DashboardTourProps) {
  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DASHBOARD_TOUR_STORAGE_KEY, '1');
    }
    onOpenChange(false);
  };

  const handleJump = (section: DashboardSectionId) => {
    onNavigate(section);
    handleDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dashboard tour</DialogTitle>
          <DialogDescription>
            Here’s a quick overview of each section. Click any to jump there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {SECTIONS.map((section) => (
            <div
              key={section.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {section.icon}
                  {section.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleJump(section.id)}
              >
                Open
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleDismiss}>
            Skip for now
          </Button>
          <Button onClick={() => handleJump('overview')}>
            Start exploring
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
