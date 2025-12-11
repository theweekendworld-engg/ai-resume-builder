'use client';

import { ResumeForm } from '@/components/editor/ResumeForm';
import { ResumePreview } from '@/components/preview/ResumePreview';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Download, FileText } from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { Separator } from '@/components/ui/separator';

export function ResumeBuilder() {

    return (
        <div className="flex flex-col h-screen bg-background">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="flex items-center justify-between px-8 py-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 border border-primary/20">
                                <FileText className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-xl font-semibold text-foreground">Resume Builder</h1>
                                <p className="text-xs text-muted-foreground">Professional resume creation tool</p>
                            </div>
                        </div>
                        <Separator orientation="vertical" className="h-8" />
                        <a 
                            href="/latex-editor" 
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-secondary/50"
                        >
                            LaTeX Editor
                        </a>
                    </div>

                    <div className="flex items-center gap-3">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="hidden sm:flex items-center gap-2"
                                    >
                                        <Download className="w-4 h-4" />
                                        Export
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Download your resume as PDF</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <SignedOut>
                            <SignInButton mode="modal">
                                <Button size="sm" variant="default">
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

            <main className="flex-1 overflow-hidden flex">
                <Tabs defaultValue="editor" className="flex-1 flex flex-col overflow-hidden md:flex-row">
                    <TabsList className="md:hidden h-auto p-1 bg-card border-b border-border rounded-none mx-0 mt-0 mb-0">
                        <TabsTrigger value="editor" className="flex-1">Editor</TabsTrigger>
                        <TabsTrigger value="preview" className="flex-1">Preview</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="editor" className="flex-1 overflow-hidden m-0 md:border-r border-border">
                        <ResumeForm />
                    </TabsContent>

                    <TabsContent value="preview" className="flex-1 overflow-y-auto p-8 m-0 bg-muted/30">
                        <div className="max-w-[210mm] mx-auto">
                            <div className="mb-6">
                                <h2 className="text-2xl font-semibold mb-2 text-foreground">Live Preview</h2>
                                <p className="text-sm text-muted-foreground">Your resume updates in real-time as you edit</p>
                            </div>
                            <div className="bg-card rounded-lg border border-border overflow-hidden min-h-[297mm] shadow-lg print:bg-white print:shadow-none">
                                <ResumePreview />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}
