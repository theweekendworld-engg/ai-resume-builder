'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { SectionType } from '@/types/resume';

const sectionLabels: Record<SectionType, string> = {
    summary: 'About Me',
    experience: 'Work Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
};

export function SectionOrderEditor() {
    const { resumeData, updateSectionOrder } = useResumeStore();
    const { sectionOrder } = resumeData;

    const moveSection = (index: number, direction: 'up' | 'down') => {
        const newOrder = [...sectionOrder];
        if (direction === 'up' && index > 0) {
            [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
        } else if (direction === 'down' && index < newOrder.length - 1) {
            [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
        }
        updateSectionOrder(newOrder);
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Section Order</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {sectionOrder.map((section, index) => (
                        <div
                            key={section}
                            className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50"
                        >
                            <div className="flex items-center gap-3">
                                <GripVertical className="w-5 h-5 text-muted-foreground" />
                                <span className="text-sm font-medium">{sectionLabels[section]}</span>
                            </div>
                            <div className="flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={() => moveSection(index, 'up')}
                                    disabled={index === 0}
                                >
                                    <ChevronUp className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={() => moveSection(index, 'down')}
                                    disabled={index === sectionOrder.length - 1}
                                >
                                    <ChevronDown className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

