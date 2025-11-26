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
        <Card>
            <CardHeader>
                <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                    <Label className="text-xs font-medium">Add Skills (Press Enter)</Label>
                    <Input
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleAddSkill}
                        placeholder="Type a skill and press Enter..."
                        className="h-8 text-sm"
                    />
                </div>
                <div className="flex flex-wrap gap-2 min-h-[50px]">
                    {skills.map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-sm py-1 px-3">
                            {skill}
                            <button
                                onClick={() => removeSkill(skill)}
                                className="ml-2 hover:text-destructive focus:outline-none"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </Badge>
                    ))}
                    {skills.length === 0 && (
                        <span className="text-muted-foreground text-sm italic">No skills added yet.</span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
