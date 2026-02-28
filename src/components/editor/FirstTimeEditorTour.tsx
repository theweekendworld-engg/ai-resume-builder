'use client';

import { Briefcase, GraduationCap, Sparkles, Target, User, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EditorPanelId } from '@/store/editorStore';

export const EDITOR_TOUR_STORAGE_KEY = 'resume-editor-tour-dismissed-v1';

interface FirstTimeEditorTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToPanel: (panel: EditorPanelId) => void;
  onFinish: () => void;
}

const majorSections: {
  panel: EditorPanelId;
  title: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    panel: 'personal',
    title: 'Personal',
    description: 'Name, summary, contact details, and your headline.',
    icon: <User className="h-4 w-4" />,
  },
  {
    panel: 'experience',
    title: 'Experience',
    description: 'Work history and measurable impact bullets.',
    icon: <Briefcase className="h-4 w-4" />,
  },
  {
    panel: 'education',
    title: 'Education',
    description: 'Degrees, schools, and relevant coursework.',
    icon: <GraduationCap className="h-4 w-4" />,
  },
  {
    panel: 'job-target',
    title: 'Job Target',
    description: 'Paste a job description when you want tailoring.',
    icon: <Target className="h-4 w-4" />,
  },
  {
    panel: 'copilot',
    title: 'Copilot',
    description: 'Get AI rewrites and section-level suggestions.',
    icon: <Sparkles className="h-4 w-4" />,
  },
];

export function FirstTimeEditorTour({ open, onOpenChange, onJumpToPanel, onFinish }: FirstTimeEditorTourProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quick editor tour</DialogTitle>
          <DialogDescription>
            Start with any section from the left sidebar, and switch to preview anytime. You can skip this and come back later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {majorSections.map((section) => (
            <div
              key={section.panel}
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
                onClick={() => {
                  onJumpToPanel(section.panel);
                  onFinish();
                }}
              >
                Open
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-1 font-medium text-foreground">
            <Wrench className="h-3.5 w-3.5" />
            Pro tip
          </p>
          Use <span className="font-medium text-foreground">Section Order</span> to rearrange sections, then export from the top-right.
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFinish}>
            Skip for now
          </Button>
          <Button
            onClick={() => {
              onJumpToPanel('personal');
              onFinish();
            }}
          >
            Start editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
