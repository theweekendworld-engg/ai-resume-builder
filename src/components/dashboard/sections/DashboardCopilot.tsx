'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export function DashboardCopilot() {
  const router = useRouter();
  const [jd, setJd] = useState('');
  const [isPending, startTransition] = useTransition();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<{
    id: string;
    question: string;
    gap: string;
  } | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const handleStartGeneration = () => {
    const trimmed = jd.trim();
    if (!trimmed) {
      toast.error('Paste a job description to continue.');
      return;
    }
    setSessionId(null);
    setStatus(null);
    setClarificationQuestion(null);
    setClarificationAnswer('');

    startTransition(async () => {
      const result = await processChannelGenerate({
        channel: 'web' as const,
        message: trimmed,
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to start generation');
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion && result.sessionId) {
        setSessionId(result.sessionId);
        setStatus('awaiting_clarification');
        setClarificationQuestion(result.nextQuestion);
        return;
      }

      if (result.status === 'generating' && result.sessionId) {
        setSessionId(result.sessionId);
        setStatus('generating');
        startStreaming(result.sessionId);
        return;
      }

      if (result.status === 'completed' && result.resumeId) {
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
        return;
      }

      if (result.status === 'awaiting_clarification' && result.nextQuestion) {
        setClarificationQuestion(result.nextQuestion);
        setClarificationAnswer('');
        return;
      }

      if (result.status === 'generating') {
        setClarificationQuestion(null);
        setClarificationAnswer('');
        setStatus('generating');
        startStreaming(sessionId);
        return;
      }

      if (result.status === 'completed' && result.resumeId) {
        toast.success('Resume ready');
        router.push(`/editor/${result.resumeId}`);
      }
    });
  };

  const startStreaming = (sid: string) => {
    const url = `/api/generate/stream?sessionId=${encodeURIComponent(sid)}`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener('complete', (e) => {
      eventSource.close();
      try {
        const data = JSON.parse((e as MessageEvent).data);
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
        </CardContent>
      </Card>
    </div>
  );
}
