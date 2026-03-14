'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Loader2, Sparkles, AlertCircle, Circle } from 'lucide-react';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { getGitHubIntegrationStatus, syncTopGitHubProjects } from '@/actions/github';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type StreamDetails = {
  requiredSkills?: number;
  preferredSkills?: number;
  matchedProjects?: number;
  matchedAchievements?: number;
};

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
  { id: 'resume_assembly', label: 'Assembling your baseline resume' },
  { id: 'claim_validation', label: 'Validating claims' },
  { id: 'ats_scoring', label: 'Scoring ATS compatibility' },
  { id: 'pdf_generation', label: 'Generating export-ready PDF' },
];

function extractStepHint(step: PipelineStepId, details: StreamDetails | null, currentAts: number | null): string | null {
  if (!details) {
    return step === 'ats_scoring' && typeof currentAts === 'number' ? `Current ATS estimate: ${currentAts}%` : null;
  }
  if (step === 'jd_parsing') {
    const skillCount = (details.requiredSkills ?? 0) + (details.preferredSkills ?? 0);
    return skillCount > 0 ? `Found ${skillCount} targeted skills.` : null;
  }
  if (step === 'semantic_search') {
    const projects = details.matchedProjects ?? 0;
    const achievements = details.matchedAchievements ?? 0;
    if (projects > 0 || achievements > 0) {
      return `Matched ${projects} projects and ${achievements} achievements.`;
    }
  }
  if (step === 'ats_scoring' && typeof currentAts === 'number') {
    return `Current ATS estimate: ${currentAts}%`;
  }
  return null;
}

export function BuildWizard() {
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [stage, setStage] = useState<'target' | 'generate'>('target');
  const [jobDescription, setJobDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'awaiting_clarification' | 'generating' | 'completed' | 'failed'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<PipelineStepId | null>(null);
  const [stepDetails, setStepDetails] = useState<StreamDetails | null>(null);
  const [atsEstimate, setAtsEstimate] = useState<number | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<{ id: string; question: string; gap: string } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [syncGitHub, setSyncGitHub] = useState(true);
  const [syncingGitHub, setSyncingGitHub] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<{
    loading: boolean;
    linked: boolean;
    linkedHandle: string;
    setupPath: string;
    message: string | null;
  }>({
    loading: true,
    linked: false,
    linkedHandle: '',
    setupPath: '/dashboard',
    message: null,
  });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const integration = await getGitHubIntegrationStatus();
      if (!mounted) return;

      if (integration.success && integration.linked && integration.linkedHandle) {
        setGithubStatus({
          loading: false,
          linked: true,
          linkedHandle: integration.linkedHandle,
          setupPath: integration.setupPath ?? '/dashboard',
          message: null,
        });
        return;
      }

      setGithubStatus({
        loading: false,
        linked: false,
        linkedHandle: '',
        setupPath: integration.setupPath ?? '/dashboard',
        message: integration.error ?? 'GitHub is not connected yet.',
      });
      setSyncGitHub(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const currentStepIndex = useMemo(
    () => (currentStep ? PIPELINE_STEPS.findIndex((step) => step.id === currentStep) : -1),
    [currentStep]
  );

  const closeStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const startStreaming = (sid: string) => {
    closeStream();
    const source = new EventSource(`/api/generate/stream?sessionId=${encodeURIComponent(sid)}`);
    eventSourceRef.current = source;

    source.addEventListener('progress', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          status?: string;
          step?: PipelineStepId;
          atsScore?: number | null;
          details?: StreamDetails;
        };
        if (payload.step) {
          setCurrentStep(payload.step);
        }
        if (typeof payload.atsScore === 'number') {
          setAtsEstimate(payload.atsScore);
        }
        if (payload.details && typeof payload.details === 'object') {
          setStepDetails(payload.details);
        }
      } catch {
        // Ignore malformed event payloads.
      }
    });

    source.addEventListener('complete', (event) => {
      closeStream();
      setStatus('completed');
      setCurrentStep('completed');
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { resumeId?: string; atsScore?: number | null };
        if (payload.resumeId) {
          setResumeId(payload.resumeId);
        }
        if (typeof payload.atsScore === 'number') {
          setAtsEstimate(payload.atsScore);
        }
      } catch {
        // Ignore malformed event payloads.
      }
    });

    source.addEventListener('error', (event) => {
      closeStream();
      setStatus('failed');
      const data = (event as MessageEvent).data;
      if (typeof data === 'string' && data.trim()) {
        try {
          const payload = JSON.parse(data) as { message?: string };
          setError(payload.message ?? 'Generation failed.');
          return;
        } catch {
          // Fallback to generic error.
        }
      }
      setError('Generation failed.');
    });
  };

  const startGitHubSyncIfNeeded = async () => {
    if (!syncGitHub || !githubStatus.linked || syncingGitHub) return;
    setSyncingGitHub(true);
    setSyncSummary(null);

    const syncResult = await syncTopGitHubProjects({ limit: 10 });
    if (!syncResult.success) {
      setSyncSummary(syncResult.error ?? 'GitHub sync failed.');
      setSyncingGitHub(false);
      return;
    }

    setSyncSummary(
      `GitHub sync finished: ${syncResult.imported ?? 0} imported, ${syncResult.deduped ?? 0} already in library, ${syncResult.failed ?? 0} skipped.`
    );
    setSyncingGitHub(false);
  };

  const beginGeneration = () => {
    const trimmed = jobDescription.trim();
    if (!trimmed) {
      toast.error('Paste a job description to continue.');
      return;
    }

    setStage('generate');
    setStatus('generating');
    setError(null);
    setSessionId(null);
    setResumeId(null);
    setCurrentStep(null);
    setStepDetails(null);
    setAtsEstimate(null);
    setClarificationQuestion(null);
    setClarificationAnswer('');

    startTransition(async () => {
      await startGitHubSyncIfNeeded();

      const result = await processChannelGenerate({
        channel: 'web' as const,
        message: trimmed,
      });

      if (!result.success) {
        setStatus('failed');
        setError(result.error ?? 'Failed to start generation.');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion && result.sessionId) {
        setStatus('awaiting_clarification');
        setSessionId(result.sessionId);
        setClarificationQuestion(result.nextQuestion);
        return;
      }

      if (result.status === 'generating' && result.sessionId) {
        setStatus('generating');
        setSessionId(result.sessionId);
        startStreaming(result.sessionId);
        return;
      }

      if (result.status === 'completed') {
        setStatus('completed');
        if (result.resumeId) {
          setResumeId(result.resumeId);
        }
        if (typeof result.atsEstimate === 'number') {
          setAtsEstimate(result.atsEstimate);
        }
        return;
      }

      setStatus('failed');
      setError('Generation returned an unexpected status.');
    });
  };

  const submitClarification = () => {
    if (!sessionId || !clarificationQuestion || !clarificationAnswer.trim()) return;

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        sessionId,
        message: clarificationAnswer.trim(),
      });

      if (!result.success) {
        setStatus('failed');
        setError(result.error ?? 'Failed to submit clarification.');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion) {
        setStatus('awaiting_clarification');
        setClarificationQuestion(result.nextQuestion);
        setClarificationAnswer('');
        return;
      }

      if (result.status === 'generating') {
        setStatus('generating');
        setClarificationQuestion(null);
        setClarificationAnswer('');
        startStreaming(sessionId);
        return;
      }

      if (result.status === 'completed') {
        setStatus('completed');
        setClarificationQuestion(null);
        if (result.resumeId) {
          setResumeId(result.resumeId);
        }
        if (typeof result.atsEstimate === 'number') {
          setAtsEstimate(result.atsEstimate);
        }
      }
    });
  };

  const resetWizard = () => {
    closeStream();
    setStage('target');
    setStatus('idle');
    setSessionId(null);
    setResumeId(null);
    setError(null);
    setCurrentStep(null);
    setStepDetails(null);
    setAtsEstimate(null);
    setClarificationQuestion(null);
    setClarificationAnswer('');
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Step {stage === 'target' ? '1' : '2'} of 2
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {stage === 'target' ? 'Define your target role' : 'Building your baseline resume'}
          </h1>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
        </Link>
      </div>

      {stage === 'target' ? (
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Step 1: Paste the Job Description</CardTitle>
              <CardDescription>
                Include responsibilities, requirements, and skills so matching is accurate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                placeholder="Paste the full job post here..."
                rows={14}
              />
              <div className="flex justify-end">
                <Button onClick={beginGeneration} disabled={isPending || !jobDescription.trim()}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Build baseline resume
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Optional: Sync GitHub Projects (OAuth)</CardTitle>
              <CardDescription>Skippable now, helpful for better project matching.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {githubStatus.loading ? (
                <p className="text-muted-foreground">Checking GitHub integration…</p>
              ) : githubStatus.linked ? (
                <>
                  <p className="text-muted-foreground">
                    Connected account: <span className="font-medium text-foreground">@{githubStatus.linkedHandle}</span>
                  </p>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={syncGitHub}
                      onChange={(event) => setSyncGitHub(event.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Sync top 10 repos before generation
                  </label>
                  {syncSummary && (
                    <div className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
                      {syncSummary}
                    </div>
                  )}
                  {syncingGitHub && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Syncing GitHub projects...
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    {githubStatus.message ?? 'GitHub is not connected yet.'}
                  </p>
                  <Link href={githubStatus.setupPath}>
                    <Button variant="secondary" size="sm">Open account settings</Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Step 2: Generation Pipeline</CardTitle>
              <CardDescription>
                We expose each stage so you can see exactly what is happening.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {clarificationQuestion ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="text-sm font-medium">{clarificationQuestion.question}</p>
                  <Input
                    value={clarificationAnswer}
                    onChange={(event) => setClarificationAnswer(event.target.value)}
                    placeholder="Example: Built Dockerized services and reduced deploy errors by 40%."
                    disabled={isPending}
                  />
                  <Button onClick={submitClarification} disabled={isPending || !clarificationAnswer.trim()}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Continue
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {PIPELINE_STEPS.map((step, index) => {
                    const done = status === 'completed' || (currentStepIndex >= 0 && index < currentStepIndex);
                    const active = status === 'generating' && currentStep === step.id;
                    const hint = extractStepHint(step.id, stepDetails, atsEstimate);
                    return (
                      <div key={step.id} className="rounded-lg border border-border bg-card/60 p-3">
                        <div className="flex items-center gap-2 text-sm">
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : active ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                        </div>
                        {hint && (
                          <p className="mt-1 pl-6 text-xs text-muted-foreground">{hint}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <p>{error}</p>
                </div>
              )}

              {status === 'completed' && (
                <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Baseline resume is ready.
                  </p>
                  {typeof atsEstimate === 'number' && (
                    <p className="text-xs text-muted-foreground">Initial ATS estimate: {atsEstimate}%</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (resumeId) {
                          router.push(`/editor/${resumeId}`);
                        }
                      }}
                      disabled={!resumeId}
                    >
                      Open editor
                    </Button>
                    <Button variant="outline" onClick={resetWizard}>Build another</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
