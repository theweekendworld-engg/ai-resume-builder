'use client';

import { useResumeStore } from '@/store/resumeStore';
import { TemplateAts } from './TemplateAts';
import { TemplateDev } from './TemplateDev';
import { useState, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Printer } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ResumePreview() {
    const { resumeData } = useResumeStore();
    const [template, setTemplate] = useState<'ats' | 'dev'>('ats');
    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `${resumeData.personalInfo.fullName.replace(/\s+/g, '_')}_Resume`,
    });

    return (
        <>
            <div className="flex justify-between items-center p-4 border-b border-border bg-card sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">Template:</span>
                    <Select value={template} onValueChange={(v: any) => setTemplate(v)}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Select Template" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ats">ATS Simple</SelectItem>
                            <SelectItem value="dev">Developer Modern</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button onClick={() => handlePrint()} size="sm" variant="outline">
                                <Printer className="w-4 h-4 mr-2" /> Download PDF
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Generate and download PDF</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <div className="bg-card mx-auto print:bg-white print:shadow-none overflow-hidden" ref={componentRef}>
                {template === 'ats' ? <TemplateAts data={resumeData} /> : <TemplateDev data={resumeData} />}
            </div>
        </>
    );
}
