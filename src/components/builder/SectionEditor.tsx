'use client';

import { PersonalInfoEditor } from '@/components/editor/PersonalInfoEditor';
import { ExperienceEditor } from '@/components/editor/ExperienceEditor';
import { ProjectsEditor } from '@/components/editor/ProjectsEditor';
import { EducationEditor } from '@/components/editor/EducationEditor';
import { SkillsEditor } from '@/components/editor/SkillsEditor';
import { SectionOrderEditor } from '@/components/editor/SectionOrderEditor';
import { JobTargetEditor } from '@/components/editor/JobTargetEditor';

type SectionType = 'personal' | 'experience' | 'projects' | 'education' | 'skills' | 'section-order' | 'job-target';

interface SectionEditorProps {
    section: SectionType;
}

const sectionComponents: Record<SectionType, React.ComponentType> = {
    'personal': PersonalInfoEditor,
    'experience': ExperienceEditor,
    'projects': ProjectsEditor,
    'education': EducationEditor,
    'skills': SkillsEditor,
    'section-order': SectionOrderEditor,
    'job-target': JobTargetEditor,
};

export function SectionEditor({ section }: SectionEditorProps) {
    const Component = sectionComponents[section];
    
    if (!Component) {
        return <div className="text-muted-foreground">Select a section to edit</div>;
    }

    return <Component />;
}
