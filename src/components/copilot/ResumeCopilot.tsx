'use client';

import { useState, useCallback } from 'react';
import { useResumeStore, CopilotProposal } from '@/store/resumeStore';
import { useKnowledgeBaseStore } from '@/store/knowledgeBaseStore';
import { proposeResumePatch, scoreReposForJob, CopilotContext } from '@/actions/copilot';
import { fetchGitHubRepos } from '@/actions/github';
import { searchKnowledgeBase } from '@/actions/kb';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProposedChangesCard } from '@/components/copilot';
import { CopilotQuickActions } from '@/components/copilot/CopilotQuickActions';
import { 
    Sparkles, 
    Loader2, 
    Bot,
    CheckCircle2,
    Search,
    AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';

interface WorkLogMessage {
    id: string;
    type: 'info' | 'success' | 'error';
    message: string;
    timestamp: Date;
}

interface ResumeCopilotProps {
    embedded?: boolean;
}

export function ResumeCopilot({ embedded = false }: ResumeCopilotProps) {
    const {
        resumeData,
        jobDescription,
        setJobDescription,
        copilotProposal,
        setCopilotProposal,
        copilotOpen,
        setCopilotOpen,
        setAtsScore,
    } = useResumeStore();

    const { searchItems } = useKnowledgeBaseStore();

    const [workLog, setWorkLog] = useState<WorkLogMessage[]>([]);

    const addWorkLog = useCallback((type: WorkLogMessage['type'], message: string) => {
        setWorkLog(prev => [...prev, {
            id: uuidv4(),
            type,
            message,
            timestamp: new Date(),
        }]);
    }, []);


    const handleApplyAll = () => {
        const store = useResumeStore.getState();
        store.applyCopilotAll();
        
        if (copilotProposal) {
            setAtsScore({
                overall: copilotProposal.proposedAtsScore,
                breakdown: {
                    keywordMatch: copilotProposal.proposedAtsScore,
                    skillsMatch: copilotProposal.proposedAtsScore,
                    experienceRelevance: copilotProposal.proposedAtsScore,
                    formattingScore: 90,
                },
                matchedKeywords: [],
                missingKeywords: [],
                suggestions: copilotProposal.rationale,
            });
        }
        
        setWorkLog([]);
        toast.success('All changes applied!');
    };

    const handleReject = () => {
        setCopilotProposal(null);
        setWorkLog([]);
        toast.info('Changes rejected');
    };

    const content = (
        <div className="space-y-6">
                        {/* Context-aware one-click actions */}
                        <CopilotQuickActions />

                        {/*
                          The job-description box, the GitHub hint and the
                          "Tailor Resume" button used to live here.
                          Removed: rebuilding the whole document is not an
                          editing operation. Someone in Review & Improve has a
                          resume they mostly like and wants part of it better,
                          and this panel made a full re-tailor the only route —
                          a full round trip to change one paragraph, replacing
                          sections nobody complained about.

                          Targeted asks above do that job now. The posting still
                          reaches them: `jobDescription` comes from the store,
                          entered once in Job Target, so the same context is
                          used without asking for it twice on a page whose
                          purpose is editing.

                          Generating a resume FROM a posting still exists, at
                          /build, where starting from nothing is the point.
                        */}

                        {/* Work Log */}
                        {workLog.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                                    Activity Log
                                </Label>
                                <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                                    {workLog.map((log) => (
                                        <div 
                                            key={log.id} 
                                            className={cn(
                                                "flex items-start gap-2 text-xs",
                                                log.type === 'success' && "text-success",
                                                log.type === 'error' && "text-destructive",
                                                log.type === 'info' && "text-muted-foreground"
                                            )}
                                        >
                                            {log.type === 'info' && <Search className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                                            {log.type === 'success' && <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                                            {log.type === 'error' && <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                                            <span>{log.message}</span>
                                        </div>
                                    ))}
                                    
                                </div>
                            </div>
                        )}

                        {/* Proposed Changes */}
                        {copilotProposal && (
                            <ProposedChangesCard
                                proposal={copilotProposal}
                                onApplyAll={handleApplyAll}
                                onReject={handleReject}
                            />
                        )}

                        {/* Empty State */}
                        {!copilotProposal && workLog.length === 0 && (
                            <div className="text-center py-8">
                                <Sparkles className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                                <p className="text-sm text-muted-foreground">
                                    Enter a job description and click &quot;Tailor Resume&quot; to get AI-powered suggestions
                                </p>
                            </div>
                        )}
                    </div>
    );

    if (embedded) {
        return (
            <Card className="h-full">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        Resume Copilot
                    </CardTitle>
                    <CardDescription>Tailor your resume for a target role with AI assistance.</CardDescription>
                </CardHeader>
                <CardContent className="h-[calc(100%-5rem)] overflow-auto">
                    {content}
                </CardContent>
            </Card>
        );
    }

    return (
        <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
            <SheetTrigger asChild>
                <Button variant="secondary" size="sm" className="gap-2">
                    <Bot className="w-4 h-4" />
                    <span className="hidden sm:inline">AI Copilot</span>
                </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:w-[540px] sm:max-w-[540px] p-0 flex flex-col">
                <SheetHeader className="p-6 pb-4 border-b border-border">
                    <SheetTitle className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        Resume Copilot
                    </SheetTitle>
                    <SheetDescription>
                        Tailor your resume for the job with AI assistance
                    </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    <div className="p-6">{content}</div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
