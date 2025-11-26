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
        <div className="w-56 border-r border-border/50 glass bg-card/30 backdrop-blur-sm h-full overflow-y-auto flex-shrink-0">
            <div className="p-3 space-y-0.5">
                {/* Tools Section */}
                <div className="mb-4">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
                        Tools
                    </div>
                    {toolsSections.map((section) => {
                        const { label, icon: Icon } = sectionLabels[section] || { label: section, icon: Settings };
                        return (
                            <Button
                                key={section}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start gap-2.5 h-8 px-3 rounded-md transition-all duration-200 ease-in-out",
                                    activeSection === section 
                                        ? "bg-primary/20 text-primary border-l-2 border-primary" 
                                        : "hover:bg-secondary/50 text-foreground/80"
                                )}
                                onClick={() => onSectionChange(section)}
                            >
                                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="text-xs font-medium truncate">{label}</span>
                            </Button>
                        );
                    })}
                </div>

                {/* Main Sections */}
                <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
                        Sections
                    </div>
                    {mainSections.map((section) => {
                        const { label, icon: Icon } = sectionLabels[section] || { label: section, icon: Settings };
                        return (
                            <Button
                                key={section}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start gap-2.5 h-8 px-3 rounded-md transition-all duration-200 ease-in-out",
                                    activeSection === section 
                                        ? "bg-primary/20 text-primary border-l-2 border-primary" 
                                        : "hover:bg-secondary/50 text-foreground/80"
                                )}
                                onClick={() => onSectionChange(section)}
                            >
                                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="text-xs font-medium truncate">{label}</span>
                            </Button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

