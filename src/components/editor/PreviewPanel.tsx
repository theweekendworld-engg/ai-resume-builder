'use client';

import { useMemo, useState } from 'react';
import { Eye, FileText, FileStack } from 'lucide-react';
import { LatexPreview } from '@/components/latex/LatexPreview';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ResumeData, ResumeTheme } from '@/types/resume';
import { ResumeHtmlPreview } from '@/components/editor/tools/TemplateGalleryPanel';
import { estimateResumeLength } from '@/lib/resumeLength';

interface PreviewPanelProps {
  latexCode: string;
  resumeData: ResumeData;
  theme: ResumeTheme;
}

type PreviewMode = 'live' | 'pdf';

/**
 * The centerpiece of the editor. Two modes:
 *  - "live": a fast, debounce-free CLIENT-SIDE HTML approximation of the current
 *    template + theme, rendered from the user's own data. Updates instantly as
 *    the theme/content changes — no server round-trip, never blocks the UI.
 *  - "pdf": the full-fidelity LaTeX-compiled PDF (the export artifact). This is
 *    the expensive path; the user opts in via "Final PDF" and it compiles on
 *    demand (see `LatexPreview` -> `compileLatex`).
 */
export function PreviewPanel({ latexCode, resumeData, theme }: PreviewPanelProps) {
  const [mode, setMode] = useState<PreviewMode>('live');
  const length = useMemo(() => estimateResumeLength(resumeData), [resumeData]);

  return (
    <aside className="flex min-h-0 min-w-0 w-full flex-1 flex-col border-l border-border bg-card/30">
      <div className="flex items-center justify-between gap-2 border-b border-border p-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setMode('live')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Eye className="h-3.5 w-3.5" /> Live
          </button>
          <button
            type="button"
            onClick={() => setMode('pdf')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'pdf' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FileText className="h-3.5 w-3.5" /> Final PDF
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              length.fitsOnePage
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
            )}
            title={
              length.fitsOnePage
                ? 'Estimated to fit on one page'
                : `Estimated ~${length.overflowLines} line(s) past one page`
            }
          >
            <FileStack className="h-3 w-3" />~{length.estimatedPages} page{length.estimatedPages === 1 ? '' : 's'}
          </span>
          {mode === 'live' ? (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">Instant style preview</span>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMode('live')}>
              Back to live
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
        {mode === 'live' ? (
          <div className="mx-auto max-w-[820px] overflow-hidden rounded-md border border-border bg-white shadow-sm">
            <ResumeHtmlPreview data={resumeData} theme={theme} variant="full" />
          </div>
        ) : (
          <div className="h-full overflow-hidden rounded-md border border-border bg-white">
            <LatexPreview code={latexCode} />
          </div>
        )}
      </div>
    </aside>
  );
}
