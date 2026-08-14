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
            toast.error('Please upload a resume PDF first.');
            return;
        }
        const startedAt = Date.now();
        const fileType: 'pdf' | 'docx' =
            file.type === 'application/pdf' ? 'pdf' : 'docx';
        trackFunnelEvent('score_started', {
            hasJD: jobDescription.trim().length > 0,
            fileType,
            fileSizeKb: Math.round(file.size / 1024),
        });
        setStatus('loading');
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (jobDescription.trim()) {
                formData.append('jobDescription', jobDescription.trim());
            }

            const res = await fetch('/api/score', { method: 'POST', body: formData });
            const data: ScoreResponse = await res.json();
            const durationMs = Date.now() - startedAt;

            if (!res.ok || !data.success) {
                const message = !data.success ? data.error : 'Could not score your resume.';
                if (res.status === 429) {
                    trackFunnelEvent('score_rate_limited', { durationMs });
                } else {
                    trackFunnelEvent('score_failed', {
                        durationMs,
                        status: res.status,
                        reason: message,
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
                hasJD: jobDescription.trim().length > 0,
                fileType,
            });
            setResult({ report: data.report, extractedText: data.extractedText });
            setStatus('idle');
        } catch (err) {
            console.error('Score request failed:', err);
            trackFunnelEvent('score_failed', {
                durationMs: Date.now() - startedAt,
                reason: err instanceof Error ? err.message : 'network_or_parse_error',
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
                    Reading your PDF and checking it against ATS best practices.
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
                Your file is processed in memory and never stored.
            </p>
        </div>
    );
}
