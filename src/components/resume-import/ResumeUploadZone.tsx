'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ParsedResumeData } from '@/lib/aiSchemas';

type Props = {
  onParsed: (data: ParsedResumeData) => void;
  onSkip?: () => void;
  className?: string;
  compact?: boolean;
};

type UploadState = 'idle' | 'uploading' | 'processing' | 'error';
type ImportStep = 'upload_received' | 'pdf_text_extract' | 'pdf_link_extract' | 'ai_parse' | 'ready' | 'failed';

const IMPORT_STEP_LABELS: Record<ImportStep, string> = {
  upload_received: 'Upload received',
  pdf_text_extract: 'Extracting text from your resume',
  pdf_link_extract: 'Enriching links and project references',
  ai_parse: 'Structuring sections with AI',
  ready: 'Parsed resume ready for review',
  failed: 'Resume parsing failed',
};

export function ResumeUploadZone({ onParsed, onSkip, className, compact = false }: Props) {
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload_received');
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (file.type !== 'application/pdf') {
        setError('Please upload a PDF file.');
        return;
      }
      setFileName(file.name);
      setState('uploading');
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/resume-import', {
          method: 'POST',
          body: formData,
        });

        const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string; sessionId?: string };
        if (!json.success) {
          throw new Error(json.error ?? 'Failed to parse resume');
        }
        if (!json.sessionId) {
          throw new Error('Resume import session was not created.');
        }
        setSessionId(json.sessionId);
        setCurrentStep('upload_received');
        setState('processing');
      } catch (err: unknown) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    },
    []
  );

  useEffect(() => {
    if (!sessionId || state !== 'processing') return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        const statusResponse = await fetch(`/api/resume-import/${encodeURIComponent(sessionId)}/status`, {
          cache: 'no-store',
        });
        const statusJson = await statusResponse.json().catch(() => ({})) as {
          success?: boolean;
          error?: string;
          session?: { status?: string; currentStep?: ImportStep; errorMessage?: string | null };
        };

        if (!statusJson.success || !statusJson.session) {
          throw new Error(statusJson.error ?? 'Failed to read import status.');
        }

        const nextStep = statusJson.session.currentStep ?? 'upload_received';
        setCurrentStep(nextStep);

        if (statusJson.session.status === 'failed') {
          throw new Error(statusJson.session.errorMessage ?? statusJson.error ?? 'Resume import failed.');
        }

        if (statusJson.session.status === 'ready' || statusJson.session.status === 'completed') {
          const resultResponse = await fetch(`/api/resume-import/${encodeURIComponent(sessionId)}/result`, {
            cache: 'no-store',
          });
          const resultJson = await resultResponse.json().catch(() => ({})) as {
            success?: boolean;
            error?: string;
            result?: { data?: ParsedResumeData };
          };
          if (!resultJson.success || !resultJson.result?.data) {
            throw new Error(resultJson.error ?? 'Failed to load parsed resume.');
          }

          if (cancelled) return;
          setState('idle');
          setSessionId(null);
          onParsed(resultJson.result.data);
          return;
        }

        timeoutId = window.setTimeout(() => {
          void poll();
        }, 1500);
      } catch (err: unknown) {
        if (cancelled) return;
        setState('error');
        setSessionId(null);
        setError(err instanceof Error ? err.message : 'Resume import failed');
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [onParsed, sessionId, state]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const reset = () => {
    setState('idle');
    setError(null);
    setFileName(null);
    setSessionId(null);
    setCurrentStep('upload_received');
  };

  const isLoading = state === 'uploading' || state === 'processing';
  const statusText = state === 'uploading'
    ? 'Uploading your resume...'
    : state === 'processing'
      ? IMPORT_STEP_LABELS[currentStep]
      : 'Upload PDF resume';

  if (compact) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer',
            isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            isLoading && 'pointer-events-none opacity-60'
          )}
          onClick={() => !isLoading && inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {statusText}
            </p>
            {fileName && (
              <p className="text-xs text-muted-foreground truncate">{fileName}</p>
            )}
          </div>
          {fileName && !isLoading && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
          isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
          isLoading && 'pointer-events-none opacity-60'
        )}
        onClick={() => !isLoading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <FileText className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium">
            {isLoading ? statusText : 'Drag & drop your PDF resume here'}
          </p>
          {!isLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">or click to browse — PDF up to 5MB</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {state === 'processing' ? 'We will open the parsed review as soon as this finishes.' : 'Upload in progress...'}
            </p>
          )}
          {fileName && (
            <p className="mt-2 text-xs text-muted-foreground">{fileName}</p>
          )}
        </div>
        {!isLoading && (
          <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            Choose file
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={reset} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {onSkip && (
        <div className="text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Skip — I&apos;ll fill in my details manually
          </button>
        </div>
      )}

      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
