'use client';

import { useResumeStore } from '@/store/resumeStore';
import { LatexPreview } from '@/components/latex/LatexPreview';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TEMPLATE_OPTIONS, LatexTemplateType } from '@/templates/latex';

export function ResumePreview() {
    const { latexCode, selectedTemplate, setSelectedTemplate } = useResumeStore();

    return (
        <>
            <div className="flex justify-between items-center p-4 border-b border-border bg-card sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">Template:</span>
                    <Select 
                        value={selectedTemplate} 
                        onValueChange={(v) => setSelectedTemplate(v as LatexTemplateType)}
                    >
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Select Template" />
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
            </div>

            <div className="h-[calc(100%-60px)]">
                <LatexPreview code={latexCode} />
            </div>
        </>
    );
}
