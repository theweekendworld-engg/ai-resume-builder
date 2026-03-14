'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, Sparkles } from 'lucide-react';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useGenerationMonitorStore } from '@/store/generationMonitorStore';

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
  { id: 'static_data_load', label: 'Loading your profile context' },
  { id: 'paraphrasing', label: 'Rewriting bullets for impact' },
  { id: 'resume_assembly', label: 'Assembling resume draft' },
  { id: 'claim_validation', label: 'Validating claims' },
  { id: 'ats_scoring', label: 'Scoring ATS compatibility' },
  { id: 'pdf_generation', label: 'Generating PDF' },
];

export function DashboardCopilot() {
  const router = useRouter();
  const [jd, setJd] = useState('');
  const [isPending, startTransition] = useTransition();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<PipelineStepId | null>(null);
  const [atsEstimate, setAtsEstimate] = useState<number | null>(null);
  const [stepDetails, setStepDetails] = useState<{ requiredSkills?: number; preferredSkills?: number; matchedProjects?: number; matchedAchievements?: number } | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<{
    id: string;
    question: string;
    gap: string;
  } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const trackGenerationSession = useGenerationMonitorStore((state) => state.trackSession);
  const markGenerationCompleted = useGenerationMonitorStore((state) => state.markCompleted);
  const markGenerationFailed = useGenerationMonitorStore((state) => state.markFailed);

  const handleStartGeneration = () => {
    const trimmed = jd.trim();
    if (!trimmed) {
      toast.error('Paste a job description to continue.');
      return;
    }
    setSessionId(null);
    setStatus(null);
    setCurrentStep(null);
    setAtsEstimate(null);
    setStepDetails(null);
    setClarificationQuestion(null);
    setClarificationAnswer('');

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        message: trimmed,
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to start generation');
        if (sessionId) {
          markGenerationFailed(result.error ?? 'Failed to start generation');
        }
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion && result.sessionId) {
        setSessionId(result.sessionId);
        setStatus('awaiting_clarification');
        setClarificationQuestion(result.nextQuestion);
        trackGenerationSession({
          sessionId: result.sessionId,
          status: 'awaiting_clarification',
          sourcePath: '/dashboard',
        });
        return;
      }

      if (result.status === 'generating' && result.sessionId) {
        setSessionId(result.sessionId);
        setStatus('generating');
        trackGenerationSession({
          sessionId: result.sessionId,
          status: 'generating',
          sourcePath: '/dashboard',
        });
        startStreaming(result.sessionId);
        return;
      }

      if (result.status === 'completed' && result.resumeId) {
        markGenerationCompleted({
          resumeId: result.resumeId,
          atsScore: result.atsEstimate,
        });
        toast.success('Resume ready');
        router.push(`/editor/${result.resumeId}`);
        return;
      }

      setStatus(result.status ?? null);
    });
  };

  const handleSubmitClarification = () => {
    if (!sessionId || !clarificationQuestion || !clarificationAnswer.trim()) return;

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        sessionId,
        message: clarificationAnswer.trim(),
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to submit');
        markGenerationFailed(result.error ?? 'Failed to submit');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion) {
        setClarificationQuestion(result.nextQuestion);
        setClarificationAnswer('');
        trackGenerationSession({
          sessionId,
          status: 'awaiting_clarification',
          sourcePath: '/dashboard',
        });
        return;
      }

      if (result.status === 'generating') {
        setClarificationQuestion(null);
        setClarificationAnswer('');
        setStatus('generating');
        trackGenerationSession({
          sessionId,
          status: 'generating',
          sourcePath: '/dashboard',
        });
        startStreaming(sessionId);
        return;
      }

      if (result.status === 'completed' && result.resumeId) {
        markGenerationCompleted({
          resumeId: result.resumeId,
          atsScore: result.atsEstimate,
        });
        toast.success('Resume ready');
        router.push(`/editor/${result.resumeId}`);
      }
    });
  };

  const startStreaming = (sid: string) => {
    const url = `/api/generate/stream?sessionId=${encodeURIComponent(sid)}`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          step?: PipelineStepId;
          atsScore?: number | null;
          details?: { requiredSkills?: number; preferredSkills?: number; matchedProjects?: number; matchedAchievements?: number };
        };
        if (data.step) {
          setCurrentStep(data.step);
        }
        if (typeof data.atsScore === 'number') {
          setAtsEstimate(data.atsScore);
        }
        if (data.details) {
          setStepDetails(data.details);
        }
      } catch {
        // Ignore malformed events.
      }
    });

    eventSource.addEventListener('complete', (e) => {
      eventSource.close();
      setCurrentStep('completed');
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (typeof data.atsScore === 'number') {
          setAtsEstimate(data.atsScore);
        }
        if (data.resumeId) {
          router.push(`/editor/${data.resumeId}`);
        }
        toast.success('Resume ready');
      } catch {
        toast.success('Generation complete');
        router.refresh();
      }
    });

    eventSource.addEventListener('error', (e) => {
      eventSource.close();
      if ((e as MessageEvent).data) {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          toast.error(data.message ?? 'Generation failed');
        } catch {
          toast.error('Generation failed');
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resume Copilot</h1>
        <p className="text-muted-foreground">
          Paste a job description to generate a tailored resume. We&apos;ll use your profile and project library.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job description</CardTitle>
          <CardDescription>Paste the full job posting below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Paste job description here..."
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={10}
            className="resize-none"
            disabled={isPending || status === 'generating'}
          />

          {clarificationQuestion ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{clarificationQuestion.question}</p>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Your answer..."
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
                rows={3}
                disabled={isPending}
              />
              <Button
                onClick={handleSubmitClarification}
                disabled={isPending || !clarificationAnswer.trim()}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Submit &amp; continue
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleStartGeneration}
              disabled={isPending || status === 'generating' || !jd.trim()}
            >
              {isPending || status === 'generating' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {status === 'generating' ? 'Generating…' : 'Generate resume'}
            </Button>
          )}

          {status === 'generating' && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
              {PIPELINE_STEPS.map((step, index) => {
                const currentIndex = currentStep ? PIPELINE_STEPS.findIndex((item) => item.id === currentStep) : -1;
                const done = currentIndex > index || currentStep === 'completed';
                const active = currentStep === step.id;
                return (
                  <div key={step.id} className="text-sm">
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
                        Found {(stepDetails.requiredSkills ?? 0) + (stepDetails.preferredSkills ?? 0)} target skills.
                      </p>
                    )}
                    {active && step.id === 'semantic_search' && stepDetails && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        Matched {stepDetails.matchedProjects ?? 0} projects and {stepDetails.matchedAchievements ?? 0} achievements.
                      </p>
                    )}
                    {active && step.id === 'ats_scoring' && typeof atsEstimate === 'number' && (
                      <p className="pl-6 text-xs text-muted-foreground">Current ATS estimate: {atsEstimate}%</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
