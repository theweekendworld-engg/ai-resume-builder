'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 flex-1 min-h-0">
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2 col-span-2">
                        <Label htmlFor="fullName" className="text-sm font-medium">Full Name</Label>
                        <Input
                            id="fullName"
                            value={personalInfo.fullName}
                            onChange={(e) => handleChange('fullName', e.target.value)}
                            placeholder="John Doe"
                            className="h-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2 col-span-2">
                        <Label htmlFor="title" className="text-sm font-medium">Professional Title</Label>
                        <Input
                            id="title"
                            value={personalInfo.title}
                            onChange={(e) => handleChange('title', e.target.value)}
                            placeholder="Software Engineer"
                            className="h-10"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={personalInfo.email}
                            onChange={(e) => handleChange('email', e.target.value)}
                            placeholder="john@example.com"
                            className="h-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="phone" className="text-sm font-medium">Phone</Label>
                        <Input
                            id="phone"
                            value={personalInfo.phone}
                            onChange={(e) => handleChange('phone', e.target.value)}
                            placeholder="+1 234 567 890"
                            className="h-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="location" className="text-sm font-medium">Location</Label>
                        <Input
                            id="location"
                            value={personalInfo.location}
                            onChange={(e) => handleChange('location', e.target.value)}
                            placeholder="San Francisco, CA"
                            className="h-10"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="linkedin" className="text-sm font-medium">LinkedIn</Label>
                        <Input
                            id="linkedin"
                            value={personalInfo.linkedin}
                            onChange={(e) => handleChange('linkedin', e.target.value)}
                            placeholder="linkedin.com/in/johndoe"
                            className="h-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="github" className="text-sm font-medium">GitHub</Label>
                        <Input
                            id="github"
                            value={personalInfo.github}
                            onChange={(e) => handleChange('github', e.target.value)}
                            placeholder="github.com/johndoe"
                            className="h-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="website" className="text-sm font-medium">Portfolio / Website</Label>
                        <Input
                            id="website"
                            value={personalInfo.website}
                            onChange={(e) => handleChange('website', e.target.value)}
                            placeholder="johndoe.com"
                            className="h-10"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2 flex-1">
                    <div className="flex justify-between items-center">
                        <Label htmlFor="summary" className="text-sm font-medium">Professional Summary</Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setRewriteModalOpen(true)}
                                        disabled={!personalInfo.summary}
                                        className="h-8 text-xs"
                                    >
                                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                        AI Rewrite
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Use AI to improve your summary</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <Textarea
                        id="summary"
                        value={personalInfo.summary}
                        onChange={(e) => handleChange('summary', e.target.value)}
                        placeholder="Briefly describe your professional background, key achievements, and career objectives..."
                        className="flex-1 min-h-[200px] resize-y"
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
