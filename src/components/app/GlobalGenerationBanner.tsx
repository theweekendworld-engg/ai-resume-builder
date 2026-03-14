'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageSquareMore, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useGenerationMonitorStore } from '@/store/generationMonitorStore';

export function GlobalGenerationBanner() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const {
    sessionId,
    status,
    sourcePath,
    stageLabel,
    progressPercent,
    elapsedMs,
    detailLines,
    resumeId,
    errorMessage,
    updateProgress,
    markCompleted,
    markFailed,
    clear,
  } = useGenerationMonitorStore();

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId || status !== 'generating') {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const source = new EventSource(`/api/generate/stream?sessionId=${encodeURIComponent(sessionId)}`);
    eventSourceRef.current = source;

    source.addEventListener('progress', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          step?: string;
          stageLabel?: string;
          progressPercent?: number;
          elapsedMs?: number;
          detailLines?: string[];
          atsScore?: number | null;
        };

        updateProgress({
          step: payload.step,
          stageLabel: payload.stageLabel,
          progressPercent: payload.progressPercent,
          elapsedMs: payload.elapsedMs,
          detailLines: Array.isArray(payload.detailLines) ? payload.detailLines : undefined,
          atsScore: payload.atsScore,
        });
      } catch {
        // Ignore malformed payloads.
      }
    });

    source.addEventListener('complete', (event) => {
      source.close();
      eventSourceRef.current = null;
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          resumeId?: string;
          atsScore?: number | null;
        };
        markCompleted({
          resumeId: payload.resumeId,
          atsScore: payload.atsScore,
        });
      } catch {
        markCompleted({});
      }
    });

    source.addEventListener('error', (event) => {
      source.close();
      eventSourceRef.current = null;
      const data = (event as MessageEvent).data;
      if (typeof data === 'string' && data.trim()) {
        try {
          const payload = JSON.parse(data) as { message?: string };
          markFailed(payload.message ?? 'Generation failed');
          return;
        } catch {
          // Fall through to generic error.
        }
      }
      markFailed('Generation failed');
    });

    return () => {
      source.close();
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null;
      }
    };
  }, [markCompleted, markFailed, sessionId, status, updateProgress]);

  const bannerTone = useMemo(() => {
    if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10';
    if (status === 'failed') return 'border-destructive/40 bg-destructive/10';
    if (status === 'awaiting_clarification') return 'border-amber-500/30 bg-amber-500/10';
    return 'border-border bg-card/90';
  }, [status]);

  if (!sessionId || status === 'idle') {
    return null;
  }

  const primaryHref = resumeId ? `/editor/${resumeId}` : (sourcePath ?? '/build');
  const primaryLabel =
    status === 'completed'
      ? 'Open resume'
      : status === 'awaiting_clarification'
        ? 'Answer clarification'
        : 'View progress';

  return (
    <div className={`border-b px-4 py-3 ${bannerTone}`}>
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {status === 'completed' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : status === 'failed' ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : status === 'awaiting_clarification' ? (
            <MessageSquareMore className="h-5 w-5 text-amber-500" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">
              {status === 'generating' && `Resume generation in progress: ${stageLabel}`}
              {status === 'awaiting_clarification' && 'Resume generation is waiting for your clarification'}
              {status === 'completed' && 'Resume generation completed'}
              {status === 'failed' && 'Resume generation failed'}
            </p>
            {status === 'generating' && (
              <span className="text-xs text-muted-foreground">
                {Math.max(0, Math.round(elapsedMs / 1000))}s elapsed
              </span>
            )}
          </div>

          {status === 'generating' && (
            <div className="mt-2 max-w-xl">
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          {status === 'failed' && errorMessage && (
            <p className="mt-1 text-xs text-destructive">{errorMessage}</p>
          )}

          {detailLines.length > 0 && status !== 'failed' && (
            <div className="mt-1 flex flex-col gap-1">
              {detailLines.slice(0, 2).map((line) => (
                <p key={line} className="text-xs text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href={primaryHref}>
            <Button size="sm" variant={status === 'completed' ? 'default' : 'outline'}>
              {primaryLabel}
            </Button>
          </Link>
          <Button size="icon" variant="ghost" onClick={clear} aria-label="Dismiss generation banner">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
