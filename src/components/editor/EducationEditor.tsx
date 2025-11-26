'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus } from 'lucide-react';

export function EducationEditor() {
    const { resumeData, addEducation, updateEducation, removeEducation } = useResumeStore();
    const { education } = resumeData;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Education</CardTitle>
                <Button onClick={addEducation} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Education
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
                {education.map((item) => (
                    <div key={item.id} className="border border-border/50 rounded-lg p-1.5 flex flex-col gap-1.5 relative group">
                        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeEducation(item.id)} className="h-6 w-6">
                                <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5">
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Institution</Label>
                                <Input
                                    value={item.institution}
                                    onChange={(e) => updateEducation(item.id, { institution: e.target.value })}
                                    placeholder="University Name"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Degree</Label>
                                <Input
                                    value={item.degree}
                                    onChange={(e) => updateEducation(item.id, { degree: e.target.value })}
                                    placeholder="Bachelor's"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Field of Study</Label>
                                <Input
                                    value={item.fieldOfStudy}
                                    onChange={(e) => updateEducation(item.id, { fieldOfStudy: e.target.value })}
                                    placeholder="Computer Science"
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">Start Date</Label>
                                <Input
                                    value={item.startDate}
                                    onChange={(e) => updateEducation(item.id, { startDate: e.target.value })}
                                    placeholder="YYYY"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Label className="text-xs font-medium">End Date</Label>
                                <Input
                                    value={item.endDate}
                                    onChange={(e) => updateEducation(item.id, { endDate: e.target.value })}
                                    placeholder="YYYY"
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </div>
                ))}
                {education.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                        No education added yet.
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
