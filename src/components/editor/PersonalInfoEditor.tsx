'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { AIRewriteModal } from './AIRewriteModal';
import { useState } from 'react';

export function PersonalInfoEditor() {
    const { resumeData, updatePersonalInfo } = useResumeStore();
    const { personalInfo } = resumeData;
    const [rewriteModalOpen, setRewriteModalOpen] = useState(false);

    const handleChange = (field: keyof typeof personalInfo, value: string) => {
        updatePersonalInfo({ [field]: value });
    };

    const handleAcceptRewrite = (rewrittenText: string) => {
        updatePersonalInfo({ summary: rewrittenText });
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <CardTitle>Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 flex-1 min-h-0">
                <div className="grid grid-cols-3 gap-1.5">
                    <div className="flex flex-col gap-0.5 col-span-2">
                        <Label htmlFor="fullName" className="text-xs font-medium">Full Name</Label>
                        <Input
                            id="fullName"
                            value={personalInfo.fullName}
                            onChange={(e) => handleChange('fullName', e.target.value)}
                            placeholder="John Doe"
                            className="h-8 text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="title" className="text-xs font-medium">Title / Role</Label>
                        <Input
                            id="title"
                            value={personalInfo.title}
                            onChange={(e) => handleChange('title', e.target.value)}
                            placeholder="Software Engineer"
                            className="h-8 text-sm"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="email" className="text-xs font-medium">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={personalInfo.email}
                            onChange={(e) => handleChange('email', e.target.value)}
                            placeholder="john@example.com"
                            className="h-8 text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="phone" className="text-xs font-medium">Phone</Label>
                        <Input
                            id="phone"
                            value={personalInfo.phone}
                            onChange={(e) => handleChange('phone', e.target.value)}
                            placeholder="+1 234 567 890"
                            className="h-8 text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="location" className="text-xs font-medium">Location</Label>
                        <Input
                            id="location"
                            value={personalInfo.location}
                            onChange={(e) => handleChange('location', e.target.value)}
                            placeholder="San Francisco, CA"
                            className="h-8 text-sm"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="linkedin" className="text-xs font-medium">LinkedIn</Label>
                        <Input
                            id="linkedin"
                            value={personalInfo.linkedin}
                            onChange={(e) => handleChange('linkedin', e.target.value)}
                            placeholder="linkedin.com/in/johndoe"
                            className="h-8 text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="github" className="text-xs font-medium">GitHub</Label>
                        <Input
                            id="github"
                            value={personalInfo.github}
                            onChange={(e) => handleChange('github', e.target.value)}
                            placeholder="github.com/johndoe"
                            className="h-8 text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="website" className="text-xs font-medium">Portfolio / Website</Label>
                        <Input
                            id="website"
                            value={personalInfo.website}
                            onChange={(e) => handleChange('website', e.target.value)}
                            placeholder="johndoe.com"
                            className="h-8 text-sm"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-0.5 flex-1">
                    <div className="flex justify-between items-center">
                        <Label htmlFor="summary" className="text-xs font-medium">Professional Summary</Label>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRewriteModalOpen(true)}
                            disabled={!personalInfo.summary}
                            className="h-6 text-xs px-2"
                        >
                            <Sparkles className="w-3 h-3 mr-1" />
                            AI Rewrite
                        </Button>
                    </div>
                    <Textarea
                        id="summary"
                        value={personalInfo.summary}
                        onChange={(e) => handleChange('summary', e.target.value)}
                        placeholder="Briefly describe your professional background..."
                        className="flex-1 min-h-[200px] text-sm resize-y"
                    />
                </div>
            </CardContent>

            <AIRewriteModal
                open={rewriteModalOpen}
                onOpenChange={setRewriteModalOpen}
                originalText={personalInfo.summary}
                onAccept={handleAcceptRewrite}
                type="summary"
            />
        </Card>
    );
}
