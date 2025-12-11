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
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-xl">Projects</CardTitle>
                <Button onClick={() => addProject()} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Project
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                {projects.map((item) => (
                    <div key={item.id} className="border border-border rounded-lg p-6 flex flex-col gap-4 relative group bg-card/50">
                        <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeProject(item.id)} className="h-8 w-8">
                                <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Project Name</Label>
                                <Input
                                    value={item.name}
                                    onChange={(e) => updateProject(item.id, { name: e.target.value })}
                                    placeholder="Project Name"
                                    className="h-10"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Project URL</Label>
                                <Input
                                    value={item.url}
                                    onChange={(e) => updateProject(item.id, { url: e.target.value })}
                                    placeholder="https://..."
                                    className="h-10"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 flex-1">
                            <div className="flex justify-between items-center">
                                <Label className="text-sm font-medium">Description</Label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenRewrite(item.id, item.description)}
                                    disabled={!item.description}
                                    className="h-8 text-xs"
                                >
                                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                    AI Rewrite
                                </Button>
                            </div>
                            <Textarea
                                value={item.description}
                                onChange={(e) => updateProject(item.id, { description: e.target.value })}
                                placeholder="Describe the project, your role, technologies used, and key achievements..."
                                className="flex-1 min-h-[200px] resize-y"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium">Technologies</Label>
                            <Input
                                value={item.technologies.join(', ')}
                                onChange={(e) => updateProject(item.id, { technologies: e.target.value.split(',').map(s => s.trim()) })}
                                placeholder="React, Node.js, TypeScript"
                                className="h-10"
                            />
                            <p className="text-xs text-muted-foreground">Separate technologies with commas</p>
                        </div>
                    </div>
                ))}
                {projects.length === 0 && (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="text-sm">No projects added yet.</p>
                        <p className="text-xs mt-1">Click "Add Project" to get started.</p>
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
