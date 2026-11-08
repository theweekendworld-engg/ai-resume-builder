'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dropzone } from '@/components/marketing/score/Dropzone';
import { ScoreReport } from '@/components/marketing/score/ScoreReport';
import type { AnonScoreReport } from '@/lib/anonScoreSchema';
import { trackFunnelEvent } from '@/lib/funnelEvents';

type Status = 'idle' | 'loading';

interface ScoreSuccess {
    success: true;
    report: AnonScoreReport;
    extractedText: string;
}
interface ScoreFailure {
    success: false;
    error: string;
}
type ScoreResponse = ScoreSuccess | ScoreFailure;

/**
 * Did the platform kill the function rather than the route returning an error?
 *
 * Vercel terminates at `maxDuration` and answers with its own HTML error page —
 * status 504 plus an `x-vercel-error` header — so there is no JSON body and no
 * `success: false` to read. The header is checked as well as the status because
 * the status alone is ambiguous: a gateway anywhere in front could also emit
 * 504. Same-origin request, so the header is readable.
 */
function isFunctionTimeout(res: Response): boolean {
    return res.status === 504 || res.headers.get('x-vercel-error') === 'FUNCTION_INVOCATION_TIMEOUT';
}

export function AtsCheckerClient() {
    const [file, setFile] = useState<File | null>(null);
    const [jobDescription, setJobDescription] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [result, setResult] = useState<{ report: AnonScoreReport; extractedText: string } | null>(
        null
    );

    const reset = () => {
        setResult(null);
        setFile(null);
        setJobDescription('');
        setStatus('idle');
    };

    const handleScore = async () => {
        if (!file) {
            toast.error('Choose your resume first: a PDF or DOCX file.');
            return;
        }
        const startedAt = Date.now();
        const fileType: 'pdf' | 'docx' =
            file.type === 'application/pdf' ? 'pdf' : 'docx';
        // Attached to every outcome, not just the start: a timeout rate is only
        // actionable next to the size and shape of what timed out.
        const scoreContext = {
            hasJD: jobDescription.trim().length > 0,
            fileType,
            fileSizeKb: Math.round(file.size / 1024),
        };
        trackFunnelEvent('score_started', scoreContext);
        setStatus('loading');
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (jobDescription.trim()) {
                formData.append('jobDescription', jobDescription.trim());
            }

            const res = await fetch('/api/score', { method: 'POST', body: formData });
            const durationMs = Date.now() - startedAt;

            /*
             * Text first, parse second. `res.json()` throws on any non-JSON
             * body, which is exactly what a function timeout returns — and that
             * threw straight past this branch into the catch below, where every
             * timeout was logged as a network error.
             */
            const raw = await res.text();
            let data: ScoreResponse | null = null;
            try {
                data = JSON.parse(raw) as ScoreResponse;
            } catch {
                data = null;
            }

            if (isFunctionTimeout(res)) {
                trackFunnelEvent('score_timed_out', { durationMs, ...scoreContext });
                toast.error('That took too long to score.', {
                    description: scoreContext.hasJD
                        ? 'Try again without the job description, or use a one- or two-page version of the resume.'
                        : 'Try again with a one- or two-page version, or sign up free and upload it there: the builder reads longer resumes.',
                    action: { label: 'Sign up free', onClick: () => { window.location.href = '/sign-up'; } },
                });
                setStatus('idle');
                return;
            }

            if (!res.ok || !data || !data.success) {
                const message =
                    data && !data.success ? data.error : 'Could not score your resume.';
                if (res.status === 429) {
                    trackFunnelEvent('score_rate_limited', { durationMs });
                    toast.error('You have scored a few resumes in a row.', {
                        description: 'The free check resets within the hour. Sign up free to keep working on this one now.',
                        action: { label: 'Sign up free', onClick: () => { window.location.href = '/sign-up'; } },
                    });
                    setStatus('idle');
                    return;
                } else {
                    trackFunnelEvent('score_failed', {
                        durationMs,
                        status: res.status,
                        // `bodyKind` separates "the route rejected this" from
                        // "something upstream answered instead of the route" —
                        // the distinction the old handler collapsed.
                        bodyKind: data ? 'json' : 'non_json',
                        reason: data ? message : raw.slice(0, 120),
                        ...scoreContext,
                    });
                }
                toast.error(message);
                setStatus('idle');
                return;
            }

            trackFunnelEvent('score_completed', {
                durationMs,
                score: data.report.overall,
                band: data.report.band,
                fixCount: data.report.fixes.length,
                ...scoreContext,
            });
            setResult({ report: data.report, extractedText: data.extractedText });
            setStatus('idle');
        } catch (err) {
            // Reaching here now means the request never completed — fetch itself
            // rejected. Timeouts and non-JSON responses are handled above, so
            // this no longer doubles as the bucket for both.
            console.error('Score request failed:', err);
            trackFunnelEvent('score_failed', {
                durationMs: Date.now() - startedAt,
                reason: err instanceof Error ? err.message : 'request_never_completed',
                bodyKind: 'no_response',
                ...scoreContext,
            });
            toast.error('Something went wrong. Please try again.');
            setStatus('idle');
        }
    };

    if (result) {
        return (
            <ScoreReport
                report={result.report}
                extractedText={result.extractedText}
                onReset={reset}
            />
        );
    }

    if (status === 'loading') {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-20 text-center">
                <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
                <p className="text-base font-medium text-foreground">Scoring your resume…</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    Reading your resume and checking it against ATS best practices.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <Dropzone
                file={file}
                onFileSelected={setFile}
                onClear={() => setFile(null)}
                onError={(msg) => toast.error(msg)}
            />

            <div>
                <label
                    htmlFor="jd"
                    className="mb-1.5 block text-sm font-medium text-foreground"
                >
                    Paste a job description{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                    id="jd"
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Paste the job description to score your resume against this specific role…"
                    rows={5}
                />
            </div>

            <Button size="lg" className="w-full gap-2" onClick={handleScore} disabled={!file}>
                <Sparkles className="h-4 w-4" />
                Score my resume — free
            </Button>

            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your file is processed in memory and not kept, unless you choose Fix all afterwards.
            </p>
        </div>
    );
}
