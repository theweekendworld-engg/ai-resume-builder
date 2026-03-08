'use client';

import { LatexEditor } from '@/components/latex/LatexEditor';

interface LaTeXPanelProps {
  latexCode: string;
  onLatexChange: (code: string) => void;
  isParsing: boolean;
  parseError: string | null;
}

export function LaTeXPanel({ latexCode, onLatexChange, isParsing, parseError }: LaTeXPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        Visual and LaTeX stay in sync automatically. Editing here updates visual sections in the background.
      </div>
      {isParsing && (
        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          Parsing LaTeX changes...
        </div>
      )}
      {parseError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {parseError}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <LatexEditor code={latexCode} onChange={(value) => onLatexChange(value ?? '')} />
      </div>
    </div>
  );
}
