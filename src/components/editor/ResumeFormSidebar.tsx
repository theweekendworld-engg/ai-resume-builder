'use client';

import { useResumeStore } from '@/store/resumeStore';
import { SectionType } from '@/types/resume';
import { Button } from '@/components/ui/button';
import { 
    User, 
    Briefcase, 
    FolderKanban, 
    GraduationCap, 
    Code, 
    FileText,
    Github,
    Search,
    Book,
    Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResumeFormSidebarProps {
    activeSection: string;
    onSectionChange: (section: string) => void;
}

const sectionLabels: Record<SectionType | string, { label: string; icon: React.ComponentType<any> }> = {
    'tools': { label: 'Tools', icon: Settings },
    'github': { label: 'GitHub Import', icon: Github },
    'job-tailor': { label: 'Job Tailor', icon: Search },
    'knowledge-base': { label: 'Knowledge Base', icon: Book },
    'personal': { label: 'Personal Info', icon: User },
    'section-order': { label: 'Section Order', icon: Settings },
    'summary': { label: 'About Me', icon: FileText },
    'experience': { label: 'Experience', icon: Briefcase },
    'projects': { label: 'Projects', icon: FolderKanban },
    'education': { label: 'Education', icon: GraduationCap },
    'skills': { label: 'Skills', icon: Code },
};

export function ResumeFormSidebar({ activeSection, onSectionChange }: ResumeFormSidebarProps) {
    const { resumeData } = useResumeStore();
    const { sectionOrder } = resumeData;
    const order = sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills'];

    const toolsSections = ['github', 'job-tailor', 'knowledge-base'];
    // Include all sections from order (summary will show PersonalInfoEditor when clicked)
    const mainSections = ['personal', 'section-order', ...order];

    return (
        <div className="w-64 border-r border-border bg-card h-full overflow-y-auto flex-shrink-0">
            <div className="p-4 space-y-1">
                {/* Tools Section */}
                <div className="mb-6">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-3">
                        Tools
                    </div>
                    {toolsSections.map((section) => {
                        const { label, icon: Icon } = sectionLabels[section] || { label: section, icon: Settings };
                        return (
                            <Button
                                key={section}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start gap-3 h-10 px-3 rounded-md transition-colors",
                                    activeSection === section 
                                        ? "bg-primary/10 text-primary font-medium border-l-2 border-primary" 
                                        : "hover:bg-secondary text-foreground/90"
                                )}
                                onClick={() => onSectionChange(section)}
                            >
                                <Icon className="w-4 h-4 flex-shrink-0" />
                                <span className="text-sm truncate">{label}</span>
                            </Button>
                        );
                    })}
                </div>

                {/* Main Sections */}
                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-3">
                        Sections
                    </div>
                    {mainSections.map((section) => {
                        const { label, icon: Icon } = sectionLabels[section] || { label: section, icon: Settings };
                        return (
                            <Button
                                key={section}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start gap-3 h-10 px-3 rounded-md transition-colors",
                                    activeSection === section 
                                        ? "bg-primary/10 text-primary font-medium border-l-2 border-primary" 
                                        : "hover:bg-secondary text-foreground/90"
                                )}
                                onClick={() => onSectionChange(section)}
                            >
                                <Icon className="w-4 h-4 flex-shrink-0" />
                                <span className="text-sm truncate">{label}</span>
                            </Button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

