'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Trash2, Plus, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';
import { suggestSectionSkillHints } from '@/actions/copilot';
import { useEffect, useState } from 'react';
import type { ExperienceItem } from '@/types/resume';

function createEmptyExperienceDraft(): Omit<ExperienceItem, 'id'> {
    return {
        company: '',
        role: '',
        startDate: '',
        endDate: '',
        current: false,
        location: '',
        description: '',
    };
}

export function ExperienceEditor() {
    const { resumeData, jobDescription, atsScore, addExperience, updateExperience, removeExperience } = useResumeStore();
    const { experience } = resumeData;
    const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
    const [currentRewriteId, setCurrentRewriteId] = useState<string | null>(null);
    const [currentRewriteText, setCurrentRewriteText] = useState('');
    const [sectionSkillHint, setSectionSkillHint] = useState<{ matchedKeywords: string[]; missingKeywords: string[] } | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [addingNew, setAddingNew] = useState(false);
    const [draftExperience, setDraftExperience] = useState<Omit<ExperienceItem, 'id'>>(createEmptyExperienceDraft());

    useEffect(() => {
        if (!jobDescription.trim() || experience.length === 0) {
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const sectionId = 'experience-section';
                const sectionText = experience
                    .map((item) => `${item.role} at ${item.company}. ${item.description}`.trim())
                    .filter(Boolean)
                    .join('\n')
                    .slice(0, 6000);
                const hints = await suggestSectionSkillHints({
                    section: 'experience',
                    jobDescription,
                    entries: [{ id: sectionId, text: sectionText }],
                });
                if (!cancelled) {
                    setSectionSkillHint(hints[sectionId] ?? null);
                }
            } catch {
                if (!cancelled) {
                    setSectionSkillHint(null);
                }
            }
        }, 700);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [jobDescription, experience]);

    const visibleSectionSkillHint = jobDescription.trim() && experience.length > 0 ? sectionSkillHint : null;

    const activeExpandedId = experience.some((item) => item.id === expandedId)
        ? expandedId
        : experience[0]?.id ?? null;

    const handleOpenRewrite = (id: string, text: string) => {
        setCurrentRewriteId(id);
        setCurrentRewriteText(text);
        setRewriteModalOpen(true);
    };

    const handleAcceptRewrite = (rewrittenText: string) => {
        if (currentRewriteId) {
            updateExperience(currentRewriteId, { description: rewrittenText });
            setCurrentRewriteId(null);
        }
    };

    const handleSaveNewExperience = () => {
        if (!draftExperience.company.trim() || !draftExperience.role.trim()) {
            return;
        }

        addExperience(draftExperience);
        setDraftExperience(createEmptyExperienceDraft());
        setAddingNew(false);
    };

    const summaryText = (item: ExperienceItem) => {
        const dateRange = item.current
            ? `${item.startDate || 'Start date'} - Present`
            : [item.startDate, item.endDate].filter(Boolean).join(' - ') || 'Dates not set';
        return dateRange;
    };

    const draftCanSave = draftExperience.company.trim() && draftExperience.role.trim();

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Work Experience</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                {atsScore && visibleSectionSkillHint && (
                    <div className="rounded-md border border-border bg-card/40 p-3">
                        {(visibleSectionSkillHint.matchedKeywords ?? []).length > 0 && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                Matched Skills (Experience): {visibleSectionSkillHint.matchedKeywords.join(', ')}
                            </p>
                        )}
                        {(visibleSectionSkillHint.missingKeywords ?? []).length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                Missing Skills (Experience): {visibleSectionSkillHint.missingKeywords.join(', ')}
                            </p>
                        )}
                    </div>
                )}
                {experience.map((item) => (
                    <div key={item.id} className="border border-border rounded-lg bg-card/50">
                        <div className="flex items-start justify-between gap-4 px-5 py-4">
                            <div className="min-w-0">
                                <p className="truncate text-base font-medium">
                                    {item.role || 'Untitled role'}{item.company ? ` at ${item.company}` : ''}
                                </p>
                                <p className="text-sm text-muted-foreground">{summaryText(item)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeExperience(item.id);
                                    }}
                                    className="h-8 w-8"
                                >
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setExpandedId((current) => current === item.id ? null : item.id)}
                                    className="h-8 w-8"
                                >
                                    {activeExpandedId === item.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                </Button>
                            </div>
                        </div>

                        {activeExpandedId === item.id && (
                            <div className="border-t border-border px-5 py-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-2">
                                        <Label className="text-sm font-medium">Company</Label>
                                        <Input
                                            value={item.company}
                                            onChange={(e) => updateExperience(item.id, { company: e.target.value })}
                                            placeholder="Company Name"
                                            className="h-10"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Label className="text-sm font-medium">Job Title</Label>
                                        <Input
                                            value={item.role}
                                            onChange={(e) => updateExperience(item.id, { role: e.target.value })}
                                            placeholder="Software Engineer"
                                            className="h-10"
                                        />
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-2">
                                        <Label className="text-sm font-medium">Start Date</Label>
                                        <Input
                                            value={item.startDate}
                                            onChange={(e) => updateExperience(item.id, { startDate: e.target.value })}
                                            placeholder="MM/YYYY"
                                            className="h-10"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Label className="text-sm font-medium">End Date</Label>
                                        <Input
                                            value={item.endDate}
                                            onChange={(e) => updateExperience(item.id, { endDate: e.target.value })}
                                            placeholder="MM/YYYY"
                                            disabled={item.current}
                                            className="h-10"
                                        />
                                    </div>
                                </div>

                                <div className="mt-4 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id={`current-${item.id}`}
                                        checked={item.current}
                                        onChange={(e) => updateExperience(item.id, { current: e.target.checked })}
                                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                    />
                                    <label htmlFor={`current-${item.id}`} className="text-sm text-muted-foreground cursor-pointer">I currently work here</label>
                                </div>

                                <div className="mt-4 flex flex-col gap-2">
                                    <Label className="text-sm font-medium">Location</Label>
                                    <Input
                                        value={item.location}
                                        onChange={(e) => updateExperience(item.id, { location: e.target.value })}
                                        placeholder="Bengaluru, India"
                                        className="h-10"
                                    />
                                </div>

                                <div className="mt-4 flex flex-col gap-2">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-sm font-medium">Description</Label>
                                        <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => handleOpenRewrite(item.id, item.description)}
                                                    disabled={!item.description}
                                                    className="h-8 text-xs gap-1.5"
                                                >
                                                    <Sparkles className="w-3.5 h-3.5" />
                                                    <span className="hidden sm:inline">Copilot</span>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Improve with action verbs and metrics</p>
                                            </TooltipContent>
                                        </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                    <Textarea
                                        value={item.description}
                                        onChange={(e) => updateExperience(item.id, { description: e.target.value })}
                                        placeholder="• Achieved X by doing Y, resulting in Z..."
                                        className="min-h-[180px] resize-y"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {experience.length === 0 && (
                    <div className="text-center text-muted-foreground py-6">
                        <p className="text-sm">No work experience added yet.</p>
                        <p className="text-xs mt-1">Add your first role below.</p>
                    </div>
                )}

                <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
                    {!addingNew ? (
                        <Button onClick={() => setAddingNew(true)} variant="outline" className="w-full">
                            <Plus className="w-4 h-4 mr-2" /> Add Experience
                        </Button>
                    ) : (
                        <>
                            <div className="space-y-1">
                                <p className="text-sm font-medium">New experience</p>
                                <p className="text-xs text-muted-foreground">Add the basics first, then refine the bullet points.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <Label className="text-sm font-medium">Company</Label>
                                    <Input
                                        value={draftExperience.company}
                                        onChange={(e) => setDraftExperience((current) => ({ ...current, company: e.target.value }))}
                                        placeholder="Company Name"
                                        className="h-10"
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-sm font-medium">Job Title</Label>
                                    <Input
                                        value={draftExperience.role}
                                        onChange={(e) => setDraftExperience((current) => ({ ...current, role: e.target.value }))}
                                        placeholder="Software Engineer"
                                        className="h-10"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <Label className="text-sm font-medium">Start Date</Label>
                                    <Input
                                        value={draftExperience.startDate}
                                        onChange={(e) => setDraftExperience((current) => ({ ...current, startDate: e.target.value }))}
                                        placeholder="MM/YYYY"
                                        className="h-10"
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-sm font-medium">End Date</Label>
                                    <Input
                                        value={draftExperience.endDate}
                                        onChange={(e) => setDraftExperience((current) => ({ ...current, endDate: e.target.value }))}
                                        placeholder="MM/YYYY"
                                        disabled={draftExperience.current}
                                        className="h-10"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="draft-current"
                                    checked={draftExperience.current}
                                    onChange={(e) => setDraftExperience((current) => ({ ...current, current: e.target.checked }))}
                                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                />
                                <label htmlFor="draft-current" className="text-sm text-muted-foreground cursor-pointer">I currently work here</label>
                            </div>

                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Location</Label>
                                <Input
                                    value={draftExperience.location}
                                    onChange={(e) => setDraftExperience((current) => ({ ...current, location: e.target.value }))}
                                    placeholder="Bengaluru, India"
                                    className="h-10"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Description</Label>
                                <Textarea
                                    value={draftExperience.description}
                                    onChange={(e) => setDraftExperience((current) => ({ ...current, description: e.target.value }))}
                                    placeholder="• Built X using Y and improved Z..."
                                    className="min-h-[140px] resize-y"
                                />
                            </div>

                            <div className="flex gap-3">
                                <Button onClick={handleSaveNewExperience} disabled={!draftCanSave} className="flex-1">
                                    Save Experience
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setAddingNew(false);
                                        setDraftExperience(createEmptyExperienceDraft());
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </>
                    )}
                </div>
                {experience.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Expand a role to edit details and bullets. Keep titles and dates easy to scan.
                    </p>
                )}
            </CardContent>

            <AIRewriteModal
                open={rewriteModalOpen}
                onOpenChange={setRewriteModalOpen}
                originalText={currentRewriteText}
                onAccept={handleAcceptRewrite}
                type="bullet"
                mode="quick"
                jobDescription={jobDescription}
            />
        </Card>
    );
}
