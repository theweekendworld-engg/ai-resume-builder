'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, GripVertical, Lock, Plus, X } from 'lucide-react';
import { SectionType } from '@/types/resume';

const sectionLabels: Record<SectionType, string> = {
    summary: 'About Me',
    experience: 'Work Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
};

const ALL_SECTIONS: readonly SectionType[] = [
    'summary',
    'experience',
    'projects',
    'education',
    'skills',
];

/**
 * A resume without work history is not a shorter resume, it is a different
 * document. Everything else is the candidate's call.
 */
const REQUIRED: SectionType = 'experience';

/**
 * Which sections this resume has, and in what order.
 *
 * ── Scope, and why it is not the settings screen ────────────────────────────
 *
 * `/settings/resume` sets the DEFAULT every future generation starts from.
 * This edits ONE document. They are deliberately separate: removing projects
 * because a particular employer will not care about them should not quietly
 * change what the next twenty resumes look like. The card says so, because a
 * control that silently has wider reach than it appears to is worse than no
 * control.
 *
 * ── Removal, not just reordering ────────────────────────────────────────────
 *
 * This offered up and down and nothing else, so a section could be moved to the
 * bottom and never removed. `updateSectionOrder` always accepted an arbitrary
 * array — the store could do this from the day it was written; only the UI was
 * missing. Absence from `sectionOrder` is what the renderer and the stored
 * resume both read as "not on this document".
 */
export function SectionOrderEditor() {
    const { resumeData, updateSectionOrder } = useResumeStore();
    const { sectionOrder } = resumeData;

    const hidden = ALL_SECTIONS.filter((section) => !sectionOrder.includes(section));

    const moveSection = (index: number, direction: 'up' | 'down') => {
        const newOrder = [...sectionOrder];
        if (direction === 'up' && index > 0) {
            [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
        } else if (direction === 'down' && index < newOrder.length - 1) {
            [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
        }
        updateSectionOrder(newOrder);
    };

    const removeSection = (section: SectionType) => {
        if (section === REQUIRED) return;
        updateSectionOrder(sectionOrder.filter((entry) => entry !== section));
    };

    const restoreSection = (section: SectionType) => {
        // Back to its canonical position rather than appended. Someone who
        // removes About Me and changes their mind expects it at the top again,
        // not stranded under Skills.
        updateSectionOrder(
            ALL_SECTIONS.filter(
                (entry) => sectionOrder.includes(entry) || entry === section,
            ),
        );
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Sections</CardTitle>
                <CardDescription>
                    Applies to this resume only. Your defaults for new resumes live in
                    Settings.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="space-y-3">
                    {sectionOrder.map((section, index) => (
                        <div
                            key={section}
                            className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/50"
                        >
                            <div className="flex items-center gap-3">
                                <GripVertical className="w-5 h-5 text-muted-foreground" aria-hidden />
                                <span className="text-sm font-medium">{sectionLabels[section]}</span>
                                {section === REQUIRED ? (
                                    <Lock
                                        className="w-3 h-3 text-muted-foreground"
                                        aria-label="always included"
                                    />
                                ) : null}
                            </div>
                            <div className="flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={() => moveSection(index, 'up')}
                                    disabled={index === 0}
                                    aria-label={`Move ${sectionLabels[section]} up`}
                                >
                                    <ChevronUp className="w-4 h-4" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={() => moveSection(index, 'down')}
                                    disabled={index === sectionOrder.length - 1}
                                    aria-label={`Move ${sectionLabels[section]} down`}
                                >
                                    <ChevronDown className="w-4 h-4" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeSection(section)}
                                    disabled={section === REQUIRED}
                                    aria-label={`Remove ${sectionLabels[section]} from this resume`}
                                >
                                    <X className="w-4 h-4" aria-hidden />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                {hidden.length > 0 ? (
                    <div>
                        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                            Not on this resume
                        </p>
                        <div className="space-y-2">
                            {hidden.map((section) => (
                                <div
                                    key={section}
                                    className="flex items-center justify-between rounded-lg border border-dashed border-border p-3"
                                >
                                    <span className="text-sm text-muted-foreground">
                                        {sectionLabels[section]}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs"
                                        onClick={() => restoreSection(section)}
                                    >
                                        <Plus className="w-3.5 h-3.5" aria-hidden />
                                        Add back
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
