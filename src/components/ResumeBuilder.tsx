'use client';

import { useState } from 'react';
import { ResumeForm } from '@/components/editor/ResumeForm';
import { ResumePreview } from '@/components/preview/ResumePreview';
import { Button } from '@/components/ui/button';
import { Eye, Edit, Download, Sparkles } from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export function ResumeBuilder() {
    const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

    return (
        <div className="flex flex-col h-screen bg-background relative z-10">
            {/* Turbo AI inspired Header */}
            <header className="border-b border-border/50 sticky top-0 z-50 glass">
                <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
                            <Sparkles className="w-6 h-6 text-primary relative" />
                        </div>
                        <h1 className="text-xl font-bold gradient-text">AI Resume Builder</h1>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Mobile Tab Switcher */}
                        <div className="md:hidden flex bg-secondary/50 rounded-lg p-1 border border-border/50">
                            <Button
                                variant={activeTab === 'editor' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setActiveTab('editor')}
                                className="rounded-md"
                            >
                                <Edit className="w-4 h-4 mr-1.5" /> Editor
                            </Button>
                            <Button
                                variant={activeTab === 'preview' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setActiveTab('preview')}
                                className="rounded-md"
                            >
                                <Eye className="w-4 h-4 mr-1.5" /> Preview
                            </Button>
                        </div>

                        <Button
                            variant="ghost"
                            size="sm"
                            className="hidden sm:flex items-center gap-2 hover:bg-secondary/50"
                        >
                            <Download className="w-4 h-4" />
                            Export
                        </Button>

                        <SignedOut>
                            <SignInButton mode="modal">
                                <Button size="sm" variant="default" className="glow-purple">
                                    Sign In
                                </Button>
                            </SignInButton>
                        </SignedOut>
                        <SignedIn>
                            <UserButton />
                        </SignedIn>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden flex relative z-10">
                {/* Editor Section */}
                <div className={`flex-1 overflow-hidden ${activeTab === 'preview' ? 'hidden md:flex' : 'flex'}`}>
                    <ResumeForm />
                </div>

                {/* Preview Section */}
                <div className={`flex-1 overflow-y-auto p-6 border-l border-border/50 ${activeTab === 'editor' ? 'hidden md:block' : ''}`}>
                    <div className="max-w-[210mm] mx-auto">
                        <div className="mb-6">
                            <h2 className="text-lg font-semibold mb-1 text-foreground">Live Preview</h2>
                            <p className="text-sm text-muted-foreground">See your resume in real-time</p>
                        </div>
                        <div className="bg-white rounded-lg border border-border/50 overflow-hidden min-h-[297mm] shadow-2xl">
                            <ResumePreview />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
