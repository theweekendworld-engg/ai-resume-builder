'use client';

import { LatexPreview } from '@/components/latex/LatexPreview';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TEMPLATE_OPTIONS, LatexTemplateType } from '@/templates/latex';

interface PreviewPanelProps {
  latexCode: string;
  selectedTemplate: LatexTemplateType;
  onTemplateChange: (template: LatexTemplateType) => void;
}

export function PreviewPanel({ latexCode, selectedTemplate, onTemplateChange }: PreviewPanelProps) {
  return (
    <aside className="flex min-h-0 min-w-0 w-full flex-1 flex-col border-l border-border bg-card/30">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-medium">Live Preview</p>
        <Select value={selectedTemplate} onValueChange={(value) => onTemplateChange(value as LatexTemplateType)}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_OPTIONS.map((template) => (
              <SelectItem key={template.value} value={template.value}>
                {template.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1">
        <LatexPreview code={latexCode} />
      </div>
    </aside>
  );
}
