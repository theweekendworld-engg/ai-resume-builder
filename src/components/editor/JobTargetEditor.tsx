'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { calculateATSScore } from '@/actions/ai';
import { startClarificationSession, submitClarificationAnswers } from '@/actions/clarify';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
    Sparkles, 
    Loader2, 
    Target,
    CheckCircle2,
    AlertCircle,
    Zap,
    Info
} from 'lucide-react';

export function JobTargetEditor() {
    const { 
        resumeData,
        jobDescription, 
        setJobDescription, 
        setResumeData,
        setAtsScore,
        atsScore,
        generateLatexFromData,
    } = useResumeStore();
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [isClarifying, setIsClarifying] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [clarificationSessionId, setClarificationSessionId] = useState<string | null>(null);
    const [clarificationQuestions, setClarificationQuestions] = useState<Array<{ id: string; question: string; gap: string }>>([]);
    const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

    const handleGenerateTailored = async () => {
        if (!jobDescription.trim()) {
            setError('Please enter a job description first');
            return;
        }
        
        setError(null);
        setSuccess(null);
        setIsGenerating(true);
        setClarificationQuestions([]);
        setClarificationAnswers({});
        setClarificationSessionId(null);
        
        try {
            const clarification = await startClarificationSession({
                jobDescription,
                fallbackResumeData: resumeData,
            });

            if (!clarification.success) {
                throw new Error(clarification.error || 'Failed to start clarification');
            }

            if (
                clarification.status === 'awaiting_clarification'
                && clarification.sessionId
                && clarification.questions
                && clarification.questions.length > 0
            ) {
                setClarificationSessionId(clarification.sessionId);
                setClarificationQuestions(clarification.questions);
                setSuccess('We found a few gaps. Answer these questions to improve accuracy.');
                return;
            }

            if (!clarification.resume) {
                throw new Error('Resume generation did not return data');
            }
            
            setResumeData(clarification.resume);
            
            const score = await calculateATSScore(clarification.resume, jobDescription);
            setAtsScore(score);
            generateLatexFromData();
            
            setSuccess('Resume tailored successfully!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: unknown) {
            console.error(err);
            setError('Failed to generate. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSubmitClarifications = async () => {
        if (!clarificationSessionId) {
            setError('Clarification session expired. Please generate again.');
            return;
        }

        setError(null);
        setSuccess(null);
        setIsClarifying(true);

        try {
            const result = await submitClarificationAnswers({
                sessionId: clarificationSessionId,
                answers: clarificationAnswers,
                fallbackResumeData: resumeData,
            });

            if (!result.success || !result.resume) {
                throw new Error(result.error || 'Failed to generate resume from clarifications');
            }

            setResumeData(result.resume);
            const score = await calculateATSScore(result.resume, jobDescription);
            setAtsScore(score);
            generateLatexFromData();

            setClarificationSessionId(null);
            setClarificationQuestions([]);
            setClarificationAnswers({});
            setSuccess('Resume tailored with your clarifications!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: unknown) {
            console.error(err);
            setError('Failed to apply clarifications. Please try again.');
        } finally {
            setIsClarifying(false);
        }
    };

    const handleCalculateScore = async () => {
        if (!jobDescription.trim()) {
            setError('Please enter a job description first');
            return;
        }
        
        setError(null);
        setIsCalculating(true);
        
        try {
            const score = await calculateATSScore(resumeData, jobDescription);
            setAtsScore(score);
        } catch (err: unknown) {
            console.error(err);
            setError('Failed to calculate score.');
        } finally {
            setIsCalculating(false);
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-400';
        if (score >= 60) return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <TooltipProvider>
            <Card className="h-full flex flex-col">
                <CardHeader className="pb-4">
                    <CardTitle className="text-xl flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary" />
                        Job Target
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="w-4 h-4 text-muted-foreground cursor-help ml-auto" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <p>Paste a job posting to get a match score and tailor your resume for the specific role</p>
                            </TooltipContent>
                        </Tooltip>
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
                    <div className="space-y-3">
                        <Label className="text-sm font-medium flex items-center gap-2">
                            <Zap className="w-4 h-4 text-primary" />
                            Job Description
                        </Label>
                        <Textarea
                            value={jobDescription}
                            onChange={(e) => setJobDescription(e.target.value)}
                            placeholder="Paste the job posting here. Include requirements, responsibilities, and qualifications for best results..."
                            className="min-h-[200px] resize-y text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                            Paste a job description to tailor your resume and see your match score.
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={handleGenerateTailored}
                                    disabled={isGenerating || isClarifying || !jobDescription.trim()}
                                    className="flex-1"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Tailoring...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4 mr-2" />
                                            Tailor Resume
                                        </>
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Automatically adjust your resume to match this job</p>
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={handleCalculateScore}
                                    disabled={isCalculating || !jobDescription.trim()}
                                    variant="outline"
                                >
                                    {isCalculating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <>
                                            <Target className="w-4 h-4 mr-2" />
                                            Score
                                        </>
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Calculate how well your resume matches this job</p>
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    {error && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm text-green-400 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            {success}
                        </div>
                    )}

                    {clarificationQuestions.length > 0 && (
                        <div className="border border-border rounded-lg p-4 space-y-4 bg-card/50">
                            <div className="space-y-1">
                                <p className="text-sm font-medium">Clarification questions</p>
                                <p className="text-xs text-muted-foreground">
                                    Answer briefly with real, verifiable details only.
                                </p>
                            </div>

                            <div className="space-y-3">
                                {clarificationQuestions.map((item) => (
                                    <div key={item.id} className="space-y-2">
                                        <Label className="text-xs font-medium">{item.question}</Label>
                                        <Textarea
                                            value={clarificationAnswers[item.id] || ''}
                                            onChange={(e) =>
                                                setClarificationAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))
                                            }
                                            placeholder="Example: Built a Kubernetes deployment pipeline for 15 microservices and reduced deploy time by 35%."
                                            className="min-h-[84px] text-sm"
                                        />
                                    </div>
                                ))}
                            </div>

                            <Button
                                onClick={handleSubmitClarifications}
                                disabled={isClarifying}
                                className="w-full"
                            >
                                {isClarifying ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Applying Clarifications...
                                    </>
                                ) : (
                                    'Generate With Clarifications'
                                )}
                            </Button>
                        </div>
                    )}

                    {atsScore && (
                        <div className="border border-border rounded-lg p-4 space-y-4 bg-card/50">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium flex items-center gap-2">
                                    Match Score
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <p>How well your resume matches the job requirements. 80%+ is excellent!</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                                <span className={`text-2xl font-bold ${getScoreColor(atsScore.overall)}`}>
                                    {atsScore.overall}%
                                </span>
                            </div>
                            
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Keyword Match</span>
                                        <span>{atsScore.breakdown.keywordMatch}%</span>
                                    </div>
                                    <Progress value={atsScore.breakdown.keywordMatch} className="h-1.5" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Skills Match</span>
                                        <span>{atsScore.breakdown.skillsMatch}%</span>
                                    </div>
                                    <Progress value={atsScore.breakdown.skillsMatch} className="h-1.5" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Experience Relevance</span>
                                        <span>{atsScore.breakdown.experienceRelevance}%</span>
                                    </div>
                                    <Progress value={atsScore.breakdown.experienceRelevance} className="h-1.5" />
                                </div>
                            </div>

                            {atsScore.suggestions.length > 0 && (
                                <div className="pt-3 border-t border-border">
                                    <p className="text-xs font-medium mb-2">Suggestions:</p>
                                    <ul className="text-xs text-muted-foreground space-y-1">
                                        {atsScore.suggestions.slice(0, 3).map((suggestion, i) => (
                                            <li key={i} className="flex items-start gap-1">
                                                <span className="text-primary">•</span>
                                                {suggestion}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {!jobDescription && (
                        <div className="bg-secondary/30 rounded-lg p-4 text-center">
                            <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">
                                Paste a job description to unlock tailoring and match scoring
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}
