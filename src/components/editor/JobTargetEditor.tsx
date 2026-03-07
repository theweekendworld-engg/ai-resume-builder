'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { calculateATSScore } from '@/actions/ai';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { loadResumeFromCloud } from '@/actions/resume';
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
  Info,
  Circle,
} from 'lucide-react';

type PipelineStepId =
  | 'reuse_check'
  | 'jd_parsing'
  | 'semantic_search'
  | 'static_data_load'
  | 'paraphrasing'
  | 'resume_assembly'
  | 'claim_validation'
  | 'ats_scoring'
  | 'pdf_generation'
  | 'completed';

const PIPELINE_STEPS: Array<{ id: PipelineStepId; label: string }> = [
  { id: 'reuse_check', label: 'Checking reusable drafts' },
  { id: 'jd_parsing', label: 'Parsing job requirements' },
  { id: 'semantic_search', label: 'Finding relevant projects and experience' },
  { id: 'static_data_load', label: 'Loading profile context' },
  { id: 'paraphrasing', label: 'Rewriting bullets for impact' },
  { id: 'resume_assembly', label: 'Assembling tailored draft' },
  { id: 'claim_validation', label: 'Validating claims' },
  { id: 'ats_scoring', label: 'Scoring ATS compatibility' },
  { id: 'pdf_generation', label: 'Preparing PDF output' },
];

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

  const streamRef = useRef<EventSource | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clarificationSessionId, setClarificationSessionId] = useState<string | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<{ id: string; question: string; gap: string } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [currentStep, setCurrentStep] = useState<PipelineStepId | null>(null);
  const [stepDetails, setStepDetails] = useState<{
    requiredSkills?: number;
    preferredSkills?: number;
    matchedProjects?: number;
    matchedAchievements?: number;
  } | null>(null);
  const [streamAts, setStreamAts] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.close();
      }
    };
  }, []);

  const currentStepIndex = currentStep ? PIPELINE_STEPS.findIndex((step) => step.id === currentStep) : -1;

  const closeStream = () => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  };

  const applyGeneratedResult = async (resumeId?: string, directResume?: typeof resumeData) => {
    let nextResume = directResume;
    if (!nextResume && resumeId) {
      const loaded = await loadResumeFromCloud(resumeId);
      if (!loaded.success || !loaded.data) {
        throw new Error(loaded.error ?? 'Failed to load generated resume');
      }
      nextResume = loaded.data;
    }

    if (!nextResume) {
      throw new Error('Generation did not return resume data');
    }

    setResumeData(nextResume);
    const score = await calculateATSScore(nextResume, jobDescription);
    setAtsScore(score);
    generateLatexFromData();
    setSuccess('Resume tailored successfully!');
    setTimeout(() => setSuccess(null), 3000);
  };

  const startStreaming = (sessionId: string) => {
    closeStream();
    const source = new EventSource(`/api/generate/stream?sessionId=${encodeURIComponent(sessionId)}`);
    streamRef.current = source;

    source.addEventListener('progress', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          step?: PipelineStepId;
          atsScore?: number | null;
          details?: {
            requiredSkills?: number;
            preferredSkills?: number;
            matchedProjects?: number;
            matchedAchievements?: number;
          };
        };
        if (payload.step) setCurrentStep(payload.step);
        if (typeof payload.atsScore === 'number') setStreamAts(payload.atsScore);
        if (payload.details) setStepDetails(payload.details);
      } catch {
        // Ignore malformed events.
      }
    });

    source.addEventListener('complete', (event) => {
      closeStream();
      setIsGenerating(false);
      setCurrentStep('completed');
      setError(null);
      setClarificationQuestion(null);
      setClarificationAnswer('');
      setClarificationSessionId(null);
      void (async () => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { resumeId?: string };
          await applyGeneratedResult(data.resumeId);
        } catch (streamError: unknown) {
          setError(streamError instanceof Error ? streamError.message : 'Failed to apply generated resume');
        }
      })();
    });

    source.addEventListener('error', (event) => {
      closeStream();
      setIsGenerating(false);
      const data = (event as MessageEvent).data;
      if (typeof data === 'string' && data.trim()) {
        try {
          const payload = JSON.parse(data) as { message?: string };
          setError(payload.message ?? 'Generation failed');
          return;
        } catch {
          // Ignore parse error and use fallback message.
        }
      }
      setError('Generation failed');
    });
  };

  const handleGenerateTailored = () => {
    if (!jobDescription.trim()) {
      setError('Please enter a job description first');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsGenerating(true);
    setClarificationSessionId(null);
    setClarificationQuestion(null);
    setClarificationAnswer('');
    setCurrentStep(null);
    setStepDetails(null);
    setStreamAts(null);

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        message: jobDescription,
        fallbackResumeData: resumeData,
      });

      if (!result.success) {
        setIsGenerating(false);
        setError(result.error ?? 'Failed to generate. Please try again.');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion && result.sessionId) {
        setIsGenerating(false);
        setClarificationSessionId(result.sessionId);
        setClarificationQuestion(result.nextQuestion);
        setSuccess('We found a few gaps. Answer this question to improve accuracy.');
        return;
      }

      if (result.status === 'generating' && result.sessionId) {
        setClarificationSessionId(result.sessionId);
        startStreaming(result.sessionId);
        return;
      }

      if (result.status === 'completed') {
        setIsGenerating(false);
        try {
          await applyGeneratedResult(result.resumeId, result.resume);
        } catch (applyError: unknown) {
          setError(applyError instanceof Error ? applyError.message : 'Failed to apply generated resume');
        }
        return;
      }

      setIsGenerating(false);
      setError('Unexpected generation state');
    });
  };

  const handleSubmitClarification = () => {
    if (!clarificationSessionId || !clarificationAnswer.trim()) {
      setError('Answer the clarification question to continue.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsGenerating(true);

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        sessionId: clarificationSessionId,
        message: clarificationAnswer.trim(),
        fallbackResumeData: resumeData,
      });

      if (!result.success) {
        setIsGenerating(false);
        setError(result.error ?? 'Failed to apply clarification.');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion) {
        setIsGenerating(false);
        setClarificationQuestion(result.nextQuestion);
        setClarificationAnswer('');
        return;
      }

      if (result.status === 'generating') {
        startStreaming(clarificationSessionId);
        return;
      }

      if (result.status === 'completed') {
        setIsGenerating(false);
        setClarificationQuestion(null);
        setClarificationAnswer('');
        setClarificationSessionId(null);
        try {
          await applyGeneratedResult(result.resumeId, result.resume);
        } catch (applyError: unknown) {
          setError(applyError instanceof Error ? applyError.message : 'Failed to apply generated resume');
        }
      }
    });
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
    } catch {
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

  const isBusy = isPending || isGenerating;

  return (
    <TooltipProvider>
      <Card className="flex h-full flex-col">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Target className="h-5 w-5 text-primary" />
            Job Target
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="ml-auto h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Paste a job posting to get a match score and tailor your resume for the specific role</p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4 text-primary" />
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
                  disabled={isBusy || !jobDescription.trim()}
                  className="flex-1"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Tailoring...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
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
                  disabled={isCalculating || isBusy || !jobDescription.trim()}
                  variant="outline"
                >
                  {isCalculating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Target className="mr-2 h-4 w-4" />
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

          {isGenerating && (
            <div className="space-y-2 rounded-lg border border-border bg-card/50 p-4">
              <p className="text-sm font-medium">Generation pipeline</p>
              {PIPELINE_STEPS.map((step, index) => {
                const done = currentStep === 'completed' || (currentStepIndex >= 0 && index < currentStepIndex);
                const active = currentStep === step.id;
                return (
                  <div key={step.id} className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : active ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                    </div>
                    {active && step.id === 'jd_parsing' && stepDetails && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        Found {(stepDetails.requiredSkills ?? 0) + (stepDetails.preferredSkills ?? 0)} targeted skills.
                      </p>
                    )}
                    {active && step.id === 'semantic_search' && stepDetails && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        Matched {stepDetails.matchedProjects ?? 0} projects and {stepDetails.matchedAchievements ?? 0} achievements.
                      </p>
                    )}
                    {active && step.id === 'ats_scoring' && typeof streamAts === 'number' && (
                      <p className="pl-6 text-xs text-muted-foreground">Current ATS estimate: {streamAts}%</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {success}
            </div>
          )}

          {clarificationQuestion && (
            <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Clarification question</p>
                <p className="text-xs text-muted-foreground">Answer with concrete, verifiable details only.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">{clarificationQuestion.question}</Label>
                <Textarea
                  value={clarificationAnswer}
                  onChange={(e) => setClarificationAnswer(e.target.value)}
                  placeholder="Example: Used Docker to containerize 12 services and reduced deployment failures by 40%."
                  className="min-h-[96px] text-sm"
                  disabled={isBusy}
                />
              </div>
              <Button
                onClick={handleSubmitClarification}
                disabled={isBusy || !clarificationAnswer.trim()}
                className="w-full"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Applying Clarification...
                  </>
                ) : (
                  'Continue Generation'
                )}
              </Button>
            </div>
          )}

          {atsScore && (
            <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Match Score
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>How well your resume matches the job requirements. 80%+ is excellent.</p>
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
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-medium">Suggestions:</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
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
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

