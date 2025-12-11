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
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-xl">Education</CardTitle>
                <Button onClick={addEducation} size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Add Education
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                {education.map((item) => (
                    <div key={item.id} className="border border-border rounded-lg p-6 flex flex-col gap-4 relative group bg-card/50">
                        <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button variant="ghost" size="icon" onClick={() => removeEducation(item.id)} className="h-8 w-8">
                                <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Institution</Label>
                                <Input
                                    value={item.institution}
                                    onChange={(e) => updateEducation(item.id, { institution: e.target.value })}
                                    placeholder="University Name"
                                    className="h-10"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Degree</Label>
                                <Input
                                    value={item.degree}
                                    onChange={(e) => updateEducation(item.id, { degree: e.target.value })}
                                    placeholder="Bachelor's"
                                    className="h-10"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Field of Study</Label>
                                <Input
                                    value={item.fieldOfStudy}
                                    onChange={(e) => updateEducation(item.id, { fieldOfStudy: e.target.value })}
                                    placeholder="Computer Science"
                                    className="h-10"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">Start Date</Label>
                                <Input
                                    value={item.startDate}
                                    onChange={(e) => updateEducation(item.id, { startDate: e.target.value })}
                                    placeholder="YYYY"
                                    className="h-10"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium">End Date</Label>
                                <Input
                                    value={item.endDate}
                                    onChange={(e) => updateEducation(item.id, { endDate: e.target.value })}
                                    placeholder="YYYY"
                                    className="h-10"
                                />
                            </div>
                        </div>
                    </div>
                ))}
                {education.length === 0 && (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="text-sm">No education added yet.</p>
                        <p className="text-xs mt-1">Click "Add Education" to get started.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
