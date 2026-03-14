'use client';

import { LatexEditor } from '@/components/latex/LatexEditor';

interface LaTeXPanelProps {
  latexCode: string;
  onLatexChange: (code: string) => void;
}

export function LaTeXPanel({ latexCode, onLatexChange }: LaTeXPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        LaTeX is an advanced editing mode. Changes here affect preview and export, but do not rewrite the visual editor.
      </div>
      <div className="min-h-0 flex-1">
        <LatexEditor code={latexCode} onChange={(value) => onLatexChange(value ?? '')} />
      </div>
    </div>
  );
}
