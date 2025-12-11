'use client';

import { useState } from 'react';
import { PersonalInfoEditor } from './PersonalInfoEditor';
import { ExperienceEditor } from './ExperienceEditor';
import { ProjectsEditor } from './ProjectsEditor';
import { EducationEditor } from './EducationEditor';
import { SkillsEditor } from './SkillsEditor';
import { SectionOrderEditor } from './SectionOrderEditor';
import { ResumeFormSidebar } from './ResumeFormSidebar';
import { useResumeStore } from '@/store/resumeStore';
import { SectionType } from '@/types/resume';

import { JobTailor } from './JobTailor';
import { GitHubImport } from './GitHubImport';
import { KnowledgeBase } from './KnowledgeBase';

const sectionComponents: Record<SectionType | string, React.ComponentType> = {
    'github': GitHubImport,
    'job-tailor': JobTailor,
    'knowledge-base': KnowledgeBase,
    'personal': PersonalInfoEditor,
    'section-order': SectionOrderEditor,
    'summary': PersonalInfoEditor, // Summary is part of PersonalInfoEditor
    'experience': ExperienceEditor,
    'projects': ProjectsEditor,
    'education': EducationEditor,
    'skills': SkillsEditor,
};

export function ResumeForm() {
    const { resumeData } = useResumeStore();
    const { sectionOrder } = resumeData;
    const [activeSection, setActiveSection] = useState<string>('personal');
    
    // Fallback to default order if sectionOrder is not set (for backward compatibility)
    const order = sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills'];

    const ActiveComponent = sectionComponents[activeSection] || (() => null);

    return (
        <div className="flex h-full">
            <ResumeFormSidebar 
                activeSection={activeSection} 
                onSectionChange={setActiveSection}
            />
            <div className="flex-1 overflow-y-auto bg-background">
                <div className="p-6 w-full h-full flex flex-col">
                    <div className="flex-1 min-h-0 w-full max-w-4xl">
                        <ActiveComponent />
                    </div>
                </div>
            </div>
        </div>
    );
}
