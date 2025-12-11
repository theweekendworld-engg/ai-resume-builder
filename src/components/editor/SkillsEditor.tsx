'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useState } from 'react';

export function SkillsEditor() {
    const { resumeData, updateSkills } = useResumeStore();
    const { skills } = resumeData;
    const [inputValue, setInputValue] = useState('');

    const handleAddSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            if (!skills.includes(inputValue.trim())) {
                updateSkills([...skills, inputValue.trim()]);
            }
            setInputValue('');
        }
    };

    const removeSkill = (skillToRemove: string) => {
        updateSkills(skills.filter(skill => skill !== skillToRemove));
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Skills</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <Label className="text-sm font-medium">Add Skills</Label>
                    <Input
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleAddSkill}
                        placeholder="Type a skill and press Enter..."
                        className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Press Enter to add a skill</p>
                </div>
                <div className="flex flex-col gap-3">
                    <Label className="text-sm font-medium">Your Skills</Label>
                    <div className="flex flex-wrap gap-2 min-h-[50px] p-4 border border-border rounded-lg bg-card/50">
                        {skills.map((skill) => (
                            <Badge key={skill} variant="secondary" className="text-sm py-1.5 px-3">
                                {skill}
                                <button
                                    onClick={() => removeSkill(skill)}
                                    className="ml-2 hover:text-destructive focus:outline-none transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </Badge>
                        ))}
                        {skills.length === 0 && (
                            <span className="text-muted-foreground text-sm">No skills added yet. Start typing above to add skills.</span>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
