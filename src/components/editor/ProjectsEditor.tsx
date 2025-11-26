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

export function ProjectsEditor() {
    const { resumeData, addProject, updateProject, removeProject } = useResumeStore();
    const { projects } = resumeData;
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
            updateProject(currentRewriteId, { description: rewrittenText });
            setCurrentRewriteId(null);
        }
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between flex-shrink-0">
                <CardTitle>Projects</CardTitle>
                <Button onClick={() => addProject()} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Project
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto">
                {projects.map((item) => (
                    <div key={item.id} className="border border-border/50 rounded-lg p-1.5 flex flex-col gap-1.5 relative group">
                        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeProject(item.id)} className="h-6 w-6">
                                <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5">
                            <div className="flex flex-col gap-0.5 col-span-2">
                                <Label className="text-xs font-medium">Project Name</Label>
                                <Input
                                    value={item.name}
                                    onChange={(e) => updateProject(item.id, { name: e.target.value })}
                                    placeholder="Project Name"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Project URL</Label>
                                <Input
                                    value={item.url}
                                    onChange={(e) => updateProject(item.id, { url: e.target.value })}
                                    placeholder="https://..."
                                    className="h-8 text-sm"
                                />
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
                                onChange={(e) => updateProject(item.id, { description: e.target.value })}
                                placeholder="Describe the project..."
                                className="flex-1 min-h-[200px] text-sm resize-y"
                            />
                        </div>

                        <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium">Technologies (comma separated)</Label>
                            <Input
                                value={item.technologies.join(', ')}
                                onChange={(e) => updateProject(item.id, { technologies: e.target.value.split(',').map(s => s.trim()) })}
                                placeholder="React, Node.js, TypeScript"
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>
                ))}
                {projects.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                        No projects added yet.
                    </div>
                )}
            </CardContent>

            <AIRewriteModal
                open={rewriteModalOpen}
                onOpenChange={setRewriteModalOpen}
                originalText={currentRewriteText}
                onAccept={handleAcceptRewrite}
                type="project"
            />
        </Card>
    );
}
