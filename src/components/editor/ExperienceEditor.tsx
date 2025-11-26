'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
            <CardHeader className="flex flex-row items-center justify-between flex-shrink-0">
                <CardTitle>Experience</CardTitle>
                <Button onClick={addExperience} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Position
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto">
                {experience.map((item) => (
                    <div key={item.id} className="border border-border/50 rounded-lg p-1.5 flex flex-col gap-1.5 relative group">
                        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeExperience(item.id)} className="h-6 w-6">
                                <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                            <div className="flex flex-col gap-0.5 col-span-2">
                                <Label className="text-xs font-medium">Company</Label>
                                <Input
                                    value={item.company}
                                    onChange={(e) => updateExperience(item.id, { company: e.target.value })}
                                    placeholder="Company Name"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5 col-span-2">
                                <Label className="text-xs font-medium">Role</Label>
                                <Input
                                    value={item.role}
                                    onChange={(e) => updateExperience(item.id, { role: e.target.value })}
                                    placeholder="Software Engineer"
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Start Date</Label>
                                <Input
                                    value={item.startDate}
                                    onChange={(e) => updateExperience(item.id, { startDate: e.target.value })}
                                    placeholder="MM/YYYY"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">End Date</Label>
                                <Input
                                    value={item.endDate}
                                    onChange={(e) => updateExperience(item.id, { endDate: e.target.value })}
                                    placeholder="MM/YYYY"
                                    disabled={item.current}
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5 col-span-2 justify-end">
                                <div className="flex items-center gap-1.5 h-8">
                                    <input
                                        type="checkbox"
                                        id={`current-${item.id}`}
                                        checked={item.current}
                                        onChange={(e) => updateExperience(item.id, { current: e.target.checked })}
                                        className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <label htmlFor={`current-${item.id}`} className="text-xs text-muted-foreground">I currently work here</label>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-0.5 flex-1">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs font-medium">Description</Label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenRewrite(item.id, item.description)}
                                    disabled={!item.description}
                                    className="h-6 text-xs px-2"
                                >
                                    <Sparkles className="w-3 h-3 mr-1" />
                                    AI Rewrite
                                </Button>
                            </div>
                            <Textarea
                                value={item.description}
                                onChange={(e) => updateExperience(item.id, { description: e.target.value })}
                                placeholder="• Achieved X by doing Y..."
                                className="flex-1 min-h-[200px] text-sm resize-y"
                            />
                        </div>
                    </div>
                ))}
                {experience.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                        No experience added yet.
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
