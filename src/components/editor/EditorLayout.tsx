'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, PanelRight, Sparkles } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { generateLatexFromResume, LatexTemplateType } from '@/templates/latex';
import { compileLatex } from '@/actions/ai';
import { loadJobTargetForResume, saveJobTargetToCloud } from '@/actions/jobTargets';
import { loadResumeFromCloud, saveResumeToCloud } from '@/actions/resume';
import { useResumeStore } from '@/store/resumeStore';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorHeader } from '@/components/editor/EditorHeader';
import { EditorSidebar } from '@/components/editor/EditorSidebar';
import { PreviewPanel } from '@/components/editor/PreviewPanel';
import { EDITOR_TOUR_STORAGE_KEY, FirstTimeEditorTour } from '@/components/editor/FirstTimeEditorTour';
import { PersonalInfoEditor } from '@/components/editor/sections/PersonalInfoEditor';
import { ExperienceEditor } from '@/components/editor/sections/ExperienceEditor';
import { ProjectsEditor } from '@/components/editor/sections/ProjectsEditor';
import { EducationEditor } from '@/components/editor/sections/EducationEditor';
import { SkillsEditor } from '@/components/editor/sections/SkillsEditor';
import { SectionOrderEditor } from '@/components/editor/sections/SectionOrderEditor';
import { JobTargetPanel } from '@/components/editor/tools/JobTargetPanel';
import { ScoreImprovePanel } from '@/components/editor/tools/ScoreImprovePanel';
import { LaTeXPanel } from '@/components/editor/tools/LaTeXPanel';
import { SettingsPanel } from '@/components/editor/tools/SettingsPanel';
import { initialResumeData } from '@/types/resume';

interface EditorLayoutProps {
  resumeId: string;
}

const mobilePanelOptions = [
  { id: 'job-target', label: 'Job Target' },
  { id: 'personal', label: 'Personal' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
  { id: 'score-improve', label: 'Score & Improve' },
  { id: 'settings', label: 'Settings' },
] as const;

export function EditorLayout({ resumeId }: EditorLayoutProps) {
  const {
    resumeData,
    setResumeData,
    jobDescription,
    setJobDescription,
    latexCode,
    setLatexCode,
    selectedTemplate,
    setSelectedTemplate,
    atsScore,
    syncStatus,
    setSyncStatus,
    lastSyncedAt,
    setLastSyncedAt,
  } = useResumeStore();

  const {
    activePanel,
    setActivePanel,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobilePreviewOpen,
    setMobilePreviewOpen,
  } = useEditorStore();

  const searchParams = useSearchParams();
  const [title, setTitle] = useState('Untitled Resume');
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const initialLoadDone = useRef(false);

  useEffect(() => {
    const template = searchParams.get('template');
    if (template && ['ats-simple', 'modern', 'classic'].includes(template)) {
      setSelectedTemplate(template as LatexTemplateType);
    }
  }, [searchParams, setSelectedTemplate]);

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    Promise.all([loadResumeFromCloud(resumeId), loadJobTargetForResume(resumeId)])
      .then(([resumeResult, jobTargetResult]) => {
        if (!resumeResult.success) {
          setLoadError(resumeResult.error ?? 'Unable to load resume.');
          return;
        }

        if (resumeResult.data) {
          setResumeData(resumeResult.data);
          const generated = generateLatexFromResume(resumeResult.data, selectedTemplate);
          setLatexCode(generated);
        } else {
          const emptyDraft = structuredClone(initialResumeData);
          setResumeData(emptyDraft);
          const generated = generateLatexFromResume(emptyDraft, selectedTemplate);
          setLatexCode(generated);
        }

        if (resumeResult.title) {
          setTitle(resumeResult.title);
        }

        if (resumeResult.updatedAt) {
          setLastSyncedAt(resumeResult.updatedAt);
        }

        if (jobTargetResult.success) {
          setJobDescription(jobTargetResult.jobTarget?.description ?? '');
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to load resume.';
        setLoadError(message);
      })
      .finally(() => {
        setInitialLoading(false);
      });
  }, [resumeId, selectedTemplate, setJobDescription, setLastSyncedAt, setLatexCode, setResumeData]);

  useEffect(() => {
    if (initialLoading || activePanel === 'latex') return;

    const timeout = setTimeout(() => {
      const generated = generateLatexFromResume(resumeData, selectedTemplate);
      if (generated !== latexCode) {
        setLatexCode(generated);
      }
    }, 600);

    return () => clearTimeout(timeout);
  }, [activePanel, initialLoading, latexCode, resumeData, selectedTemplate, setLatexCode]);

  useEffect(() => {
    if (initialLoading) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(EDITOR_TOUR_STORAGE_KEY) === 'true') return;
    setTourOpen(true);
  }, [initialLoading]);

  useEffect(() => {
    if (initialLoading) return;

    const timeout = setTimeout(async () => {
      setSyncStatus('syncing');
      try {
        const saveResult = await saveResumeToCloud(
          resumeData,
          title,
          'manual',
          resumeId,
          typeof atsScore?.overall === 'number' ? atsScore.overall : undefined
        );

        if (!saveResult.success) {
          setSyncStatus('error');
          return;
        }

        if (jobDescription.trim()) {
          await saveJobTargetToCloud('', resumeData.personalInfo.title ?? '', jobDescription, resumeId);
        }

        setSyncStatus('synced');
        setLastSyncedAt(new Date());
      } catch {
        setSyncStatus('error');
      }
    }, 1400);

    return () => clearTimeout(timeout);
  }, [atsScore?.overall, initialLoading, jobDescription, resumeData, resumeId, setLastSyncedAt, setSyncStatus, title]);

  const handleLatexChange = useCallback(
    (newCode: string) => {
      setLatexCode(newCode);
    },
    [setLatexCode]
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await compileLatex(latexCode);
      if (!result.success || !result.pdfBase64) {
        toast.error(result.error ?? 'Failed to export PDF');
        return;
      }

      const dataUrl = `data:application/pdf;base64,${result.pdfBase64}`;
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${title || 'resume'}.pdf`;
      link.click();
      toast.success('PDF exported');
    } catch {
      toast.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }, [latexCode, title]);

  const renderedPanel = useMemo(() => {
    switch (activePanel) {
      case 'job-target':
        return <JobTargetPanel resumeId={resumeId} />;
      case 'personal':
        return <PersonalInfoEditor />;
      case 'experience':
        return <ExperienceEditor />;
      case 'projects':
        return <ProjectsEditor />;
      case 'education':
        return <EducationEditor />;
      case 'skills':
        return <SkillsEditor />;
      case 'section-order':
        return <SectionOrderEditor />;
      case 'score-improve':
        return <ScoreImprovePanel />;
      case 'latex':
        return (
          <LaTeXPanel
            latexCode={latexCode}
            onLatexChange={handleLatexChange}
          />
        );
      case 'settings':
        return <SettingsPanel resumeId={resumeId} onOpenLatex={() => setActivePanel('latex')} onOpenSectionOrder={() => setActivePanel('section-order')} />;
      default:
        return <JobTargetPanel resumeId={resumeId} />;
    }
  }, [activePanel, handleLatexChange, latexCode, resumeId, setActivePanel]);

  const handleTourFinish = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EDITOR_TOUR_STORAGE_KEY, 'true');
    }
    setTourOpen(false);
  }, []);

  if (initialLoading) {
    return (
      <div className="h-screen">
        <div className="border-b border-border p-4">
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="grid h-[calc(100vh-57px)] grid-cols-1 gap-4 p-4 lg:grid-cols-[240px_1fr_40%]">
          <Skeleton className="hidden h-full lg:block" />
          <Skeleton className="h-full" />
          <Skeleton className="hidden h-full lg:block" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          <p className="font-medium">Unable to load resume</p>
          <p className="mt-1 text-sm">{loadError}</p>
          <Button className="mt-3" onClick={() => window.location.reload()} variant="outline">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <FirstTimeEditorTour
        open={tourOpen}
        onOpenChange={(open) => {
          setTourOpen(open);
          if (!open) {
            handleTourFinish();
          }
        }}
        onJumpToPanel={setActivePanel}
        onFinish={handleTourFinish}
      />

      <EditorHeader
        title={title}
        onTitleChange={setTitle}
        onExport={handleExport}
        exporting={exporting}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <EditorSidebar
          activePanel={activePanel}
          onSelect={setActivePanel}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-[1_1_54%]">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 lg:hidden">
            <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <Menu className="h-4 w-4" />
                  Sections
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-2">
                <div className="space-y-1 pt-6">
                  {mobilePanelOptions.map((option) => (
                    <Button
                      key={option.id}
                      variant={activePanel === option.id ? 'secondary' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => {
                        setActivePanel(option.id);
                        setNavSheetOpen(false);
                      }}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </SheetContent>
            </Sheet>

            <Button variant="outline" size="sm" onClick={() => setMobilePreviewOpen(!mobilePreviewOpen)}>
              <PanelRight className="h-4 w-4" />
              {mobilePreviewOpen ? 'Editor' : 'Preview'}
            </Button>
          </div>

          <div className="min-h-0 flex-1 p-3 sm:p-4">
            {mobilePreviewOpen ? (
              <div className="h-full lg:hidden">
                <PreviewPanel
                  latexCode={latexCode}
                  selectedTemplate={selectedTemplate}
                  onTemplateChange={setSelectedTemplate}
                />
              </div>
            ) : (
              <div className="h-full">{renderedPanel}</div>
            )}
          </div>

          <div className="grid grid-cols-3 border-t border-border p-2 lg:hidden">
            <Button variant="ghost" onClick={() => setActivePanel('job-target')}>Target</Button>
            <Button variant="ghost" onClick={() => setActivePanel('score-improve')}>
              <Sparkles className="h-4 w-4" />
              Improve
            </Button>
            <Button variant="ghost" onClick={() => setMobilePreviewOpen(!mobilePreviewOpen)}>
              {mobilePreviewOpen ? 'Editor' : 'Preview'}
            </Button>
          </div>
        </main>

        <div className="hidden min-h-0 min-w-0 lg:flex lg:flex-[1_1_46%]">
          <PreviewPanel
            latexCode={latexCode}
            selectedTemplate={selectedTemplate}
            onTemplateChange={setSelectedTemplate}
          />
        </div>
      </div>
    </div>
  );
}
