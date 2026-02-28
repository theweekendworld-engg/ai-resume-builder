'use client';

import { useState, useCallback } from 'react';
import { useResumeStore, CopilotProposal } from '@/store/resumeStore';
import { useKnowledgeBaseStore } from '@/store/knowledgeBaseStore';
import { proposeResumePatch, scoreReposForJob, CopilotContext } from '@/actions/copilot';
import { fetchGitHubRepos } from '@/actions/github';
import { searchKnowledgeBase } from '@/actions/kb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProposedChangesCard } from '@/components/copilot';
import { 
    Sparkles, 
    Loader2, 
    Bot,
    CheckCircle2,
    Github,
    FileText,
    Search,
    Wand2,
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
        githubUsername,
        setGithubUsername,
        copilotProposal,
        setCopilotProposal,
        copilotOpen,
        setCopilotOpen,
        setAtsScore,
    } = useResumeStore();

    const { searchItems } = useKnowledgeBaseStore();

    const [isProcessing, setIsProcessing] = useState(false);
    const [workLog, setWorkLog] = useState<WorkLogMessage[]>([]);
    const [localJD, setLocalJD] = useState(jobDescription);
    const [localGithub, setLocalGithub] = useState(githubUsername);

    const addWorkLog = useCallback((type: WorkLogMessage['type'], message: string) => {
        setWorkLog(prev => [...prev, {
            id: uuidv4(),
            type,
            message,
            timestamp: new Date(),
        }]);
    }, []);

    const handleTailorResume = async () => {
        if (!localJD.trim()) {
            toast.error('Please enter a job description');
            return;
        }

        setJobDescription(localJD);
        setGithubUsername(localGithub);
        setIsProcessing(true);
        setWorkLog([]);
        setCopilotProposal(null);

        try {
            addWorkLog('info', 'Starting resume analysis...');

            // Gather KB bullets
            addWorkLog('info', 'Searching knowledge base for relevant achievements...');
            let kbBullets: string[] = [];
            try {
                const cloudResults = await searchKnowledgeBase(localJD);
                kbBullets = cloudResults.map((r) => String(r.content)).filter(Boolean);
            } catch {
                const localResults = searchItems(localJD);
                kbBullets = localResults.map((r) => r.content);
            }
            
            if (kbBullets.length > 0) {
                addWorkLog('success', `Found ${kbBullets.length} relevant achievements`);
            } else {
                addWorkLog('info', 'No stored achievements found');
            }

            // Fetch GitHub repos if username provided
            let scoredRepos: Array<{ name: string; description: string | null; html_url: string; language: string | null; stargazers_count: number; topics: string[]; updated_at: string; fork: boolean; id: number; relevanceScore: number }> = [];
            
            if (localGithub.trim()) {
                addWorkLog('info', `Fetching GitHub repos for ${localGithub}...`);
                try {
                    const repos = await fetchGitHubRepos({ 
                        username: localGithub,
                        perPage: 30,
                        excludeForks: true,
                    });
                    
                    if (repos.length > 0) {
                        addWorkLog('info', `Found ${repos.length} repos, scoring relevance...`);
                        scoredRepos = await scoreReposForJob(repos, localJD);
                        const topRepos = scoredRepos.slice(0, 5);
                        addWorkLog('success', `Selected ${topRepos.length} most relevant repos`);
                    } else {
                        addWorkLog('info', 'No public repos found (continuing without GitHub data)');
                    }
                } catch {
                    addWorkLog('info', 'GitHub unavailable, continuing without repos');
                }
            }

            // Generate proposal
            addWorkLog('info', 'Analyzing resume and generating improvements...');
            
            const context: CopilotContext = {
                resumeData,
                jobDescription: localJD,
                kbBullets: kbBullets.slice(0, 10),
                githubRepos: scoredRepos.slice(0, 5),
            };

            const patch = await proposeResumePatch(context);
            
            addWorkLog('success', 'Generated resume improvements!');
            addWorkLog('info', `Estimated ATS score: ${patch.proposedAtsScore}%`);

            setCopilotProposal(patch as CopilotProposal);

        } catch (error) {
            console.error('Copilot error:', error);
            addWorkLog('error', 'Failed to generate improvements. Please try again.');
            toast.error('Failed to generate improvements');
        } finally {
            setIsProcessing(false);
        }
    };

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

    const needsJobDescription = !localJD.trim();

    const content = (
        <div className="space-y-6">
                        {/* Job Description Input */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Job Description
                                {needsJobDescription && (
                                    <span className="text-xs text-destructive">(required)</span>
                                )}
                            </Label>
                            <Textarea
                                value={localJD}
                                onChange={(e) => setLocalJD(e.target.value)}
                                placeholder="Paste the job description here..."
                                className="min-h-[120px] resize-y text-sm"
                                disabled={isProcessing}
                            />
                        </div>

                        {/* GitHub Username Input */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Github className="w-4 h-4" />
                                GitHub Username
                                <span className="text-xs text-muted-foreground">(optional)</span>
                            </Label>
                            <Input
                                value={localGithub}
                                onChange={(e) => setLocalGithub(e.target.value)}
                                placeholder="your-github-username"
                                disabled={isProcessing}
                            />
                            <p className="text-xs text-muted-foreground">
                                We&apos;ll find relevant projects to highlight
                            </p>
                        </div>

                        {/* Tailor Button */}
                        <Button
                            onClick={handleTailorResume}
                            disabled={isProcessing || needsJobDescription}
                            className="w-full gap-2"
                            size="lg"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="w-4 h-4" />
                                    Tailor Resume
                                </>
                            )}
                        </Button>

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
                                                log.type === 'success' && "text-green-400",
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
                                    {isProcessing && (
                                        <div className="flex items-center gap-2 text-xs text-primary">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            <span>Working...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Proposed Changes */}
                        {copilotProposal && !isProcessing && (
                            <ProposedChangesCard
                                proposal={copilotProposal}
                                onApplyAll={handleApplyAll}
                                onReject={handleReject}
                            />
                        )}

                        {/* Empty State */}
                        {!isProcessing && !copilotProposal && workLog.length === 0 && (
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
