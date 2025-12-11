'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Trash2, Plus, Sparkles } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';
import { useState } from 'react';

export function ExperienceEditor() {
    const { resumeData, addExperience, updateExperience, removeExperience } = useResumeStore();
    const { experience } = resumeData;
    const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
    const [currentRewriteId, setCurrentRewriteId] = useState<string | null>(null);
    const [currentRewriteText, setCurrentRewriteText] = useState('');

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

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-xl">Work Experience</CardTitle>
                <Button onClick={addExperience} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Position
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                {experience.map((item) => (
                    <div key={item.id} className="border border-border rounded-lg p-6 flex flex-col gap-4 relative group bg-card/50">
                        <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeExperience(item.id)} className="h-8 w-8">
                                <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                        </div>

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

                        <div className="grid grid-cols-2 gap-4">
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

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id={`current-${item.id}`}
                                checked={item.current}
                                onChange={(e) => updateExperience(item.id, { current: e.target.checked })}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            />
                            <label htmlFor={`current-${item.id}`} className="text-sm text-muted-foreground cursor-pointer">I currently work here</label>
                        </div>

                        <div className="flex flex-col gap-2 flex-1">
                            <div className="flex justify-between items-center">
                                <Label className="text-sm font-medium">Job Description</Label>
<TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ai"
                                            size="sm"
                                            onClick={() => handleOpenRewrite(item.id, item.description)}
                                            disabled={!item.description}
                                            className="h-8 text-xs gap-1.5"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">Enhance</span>
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
                                className="flex-1 min-h-[200px] resize-y"
                            />
                        </div>
                    </div>
                ))}
                {experience.length === 0 && (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="text-sm">No work experience added yet.</p>
                        <p className="text-xs mt-1">Click "Add Position" to get started.</p>
                    </div>
                )}
            </CardContent>

            <AIRewriteModal
                open={rewriteModalOpen}
                onOpenChange={setRewriteModalOpen}
                originalText={currentRewriteText}
                onAccept={handleAcceptRewrite}
                type="bullet"
            />
        </Card>
    );
}
