'use client';

import { useResumeStore } from '@/store/resumeStore';
import { TemplateAts } from './TemplateAts';
import { TemplateDev } from './TemplateDev';
import { useState, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
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
            <div className="flex justify-between items-center p-4 border-b border-border/50 sticky top-0 z-10 glass bg-card/50 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Template:</span>
                    <Select value={template} onValueChange={(v: any) => setTemplate(v)}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Select Template" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ats">ATS Simple</SelectItem>
                            <SelectItem value="dev">Developer Modern</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button onClick={() => handlePrint()} size="sm" variant="ghost">
                    <Printer className="w-4 h-4 mr-2" /> Download PDF
                </Button>
            </div>

            <div className="border border-border/50 bg-white mx-auto print:shadow-none rounded-lg overflow-hidden" ref={componentRef}>
                {template === 'ats' ? <TemplateAts data={resumeData} /> : <TemplateDev data={resumeData} />}
            </div>
        </>
    );
}
