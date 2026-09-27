'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, Loader2, Sparkles, Upload } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { tailorFromScout } from '@/actions/scout';
import { processChannelGenerate } from '@/actions/channelGenerate';

import { EntitlementNotice } from './EntitlementNotice';

type Question = { id: string; question: string; gap: string };

type State =
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'asking'; sessionId: string; question: Question; resumeId: string | null }
    | { kind: 'generating'; sessionId: string; resumeId: string | null; stage: string | null }
    | { kind: 'done'; resumeId: string }
    | { kind: 'error'; message: string; code: string | null };

/** Codes that mean "there is nothing of yours to tailor yet". */
const NEEDS_RESUME = new Set(['no_base_resume', 'empty_profile']);

/**
 * "Tailor my resume for this job", on a Scout run.
 *
 * Scout already read the posting and filed the job; this turns that into a
 * resume without the user copying anything: a per-job copy of their base
 * resume, generated against the posting, linked to the tracked job. Questions
 * are asked right here, with Skip, and progress is the same generation stream
 * the builder uses.
 */
export function TailorButton({ runId }: { runId: string }) {
    const [state, setState] = React.useState<State>({ kind: 'idle' });
    const [answer, setAnswer] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const streamRef = React.useRef<EventSource | null>(null);

    React.useEffect(() => () => streamRef.current?.close(), []);

    const stream = React.useCallback((sessionId: string, resumeId: string | null) => {
        streamRef.current?.close();
        setState({ kind: 'generating', sessionId, resumeId, stage: null });
        const source = new EventSource(`/api/generate/stream?sessionId=${encodeURIComponent(sessionId)}`);
        streamRef.current = source;
        source.addEventListener('progress', (event) => {
            try {
                const payload = JSON.parse((event as MessageEvent).data) as { stageLabel?: string };
                setState((current) => (current.kind === 'generating' ? { ...current, stage: payload.stageLabel ?? current.stage } : current));
            } catch {
                // A malformed frame is not worth interrupting progress for.
            }
        });
        source.addEventListener('complete', (event) => {
            source.close();
            try {
                const payload = JSON.parse((event as MessageEvent).data) as { resumeId?: string };
                const done = payload.resumeId ?? resumeId;
                setState(done ? { kind: 'done', resumeId: done } : { kind: 'error', message: 'The resume finished but could not be found.', code: null });
            } catch {
                setState(resumeId ? { kind: 'done', resumeId } : { kind: 'error', message: 'The resume finished but could not be found.', code: null });
            }
        });
        source.addEventListener('error', (event) => {
            const data = (event as MessageEvent).data;
            // A native disconnect carries no data and is not a failure: the
            // generation carries on server-side. Only a server `error` frame is.
            if (typeof data !== 'string' || !data.trim()) return;
            source.close();
            try {
                const payload = JSON.parse(data) as { message?: string };
                setState({ kind: 'error', message: payload.message ?? 'Tailoring failed.', code: null });
            } catch {
                setState({ kind: 'error', message: 'Tailoring failed.', code: null });
            }
        });
    }, []);

    const start = async () => {
        setState({ kind: 'starting' });
        const result = await tailorFromScout(runId);
        if (!result.success) {
            setState({ kind: 'error', message: result.error, code: result.code ?? null });
            return;
        }
        const { sessionId, resumeId, status, nextQuestion } = result.data;
        if (status === 'completed' && resumeId) {
            setState({ kind: 'done', resumeId });
            return;
        }
        if (status === 'awaiting_clarification' && nextQuestion) {
            setAnswer('');
            setState({ kind: 'asking', sessionId, question: nextQuestion, resumeId });
            return;
        }
        stream(sessionId, resumeId);
    };

    const respond = async (mode: 'answer' | 'skip' | 'skipAll') => {
        if (state.kind !== 'asking') return;
        if (mode === 'answer' && !answer.trim()) return;
        setBusy(true);
        const result = await processChannelGenerate({
            channel: 'web',
            sessionId: state.sessionId,
            ...(mode === 'answer' ? { message: answer.trim() } : {}),
            ...(mode === 'skip' ? { skip: true } : {}),
            ...(mode === 'skipAll' ? { skipAll: true } : {}),
        });
        setBusy(false);
        if (!result.success) {
            setState({ kind: 'error', message: result.error ?? 'Could not continue.', code: result.code ?? null });
            return;
        }
        if (result.status === 'awaiting_clarification' && result.nextQuestion) {
            setAnswer('');
            setState({ ...state, question: result.nextQuestion });
            return;
        }
        if (result.status === 'completed' && (result.resumeId ?? state.resumeId)) {
            setState({ kind: 'done', resumeId: (result.resumeId ?? state.resumeId)! });
            return;
        }
        stream(state.sessionId, state.resumeId);
    };

    if (state.kind === 'error') {
        if (state.code === 'entitlement_required') {
            return <EntitlementNotice message={state.message} entitlement />;
        }
        return (
            <section role="status" className="surface-work rounded-xl border border-border bg-card p-5">
                <p className={cn(typeStyles.small, 'text-foreground')}>{state.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {state.code && NEEDS_RESUME.has(state.code) ? (
                        <Button asChild size="sm" className="gap-1.5">
                            <Link href="/dashboard?section=profile">
                                <Upload aria-hidden className="size-3.5" />
                                Upload your resume
                            </Link>
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline" onClick={start}>Try again</Button>
                    )}
                </div>
            </section>
        );
    }

    if (state.kind === 'asking') {
        return (
            <section className="surface-work rounded-xl border border-border bg-card p-5">
                <p className={cn(typeStyles.h3, 'text-foreground')}>One question before tailoring</p>
                <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                    Only real, checkable details. Skip it if you have nothing true to add; nothing is made up in its place.
                </p>
                <label className={cn(typeStyles.small, 'mt-3 block font-medium text-foreground')} htmlFor={`tailor-q-${state.question.id}`}>
                    {state.question.question}
                </label>
                <Textarea
                    id={`tailor-q-${state.question.id}`}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    className="mt-2 min-h-[88px] text-sm"
                    disabled={busy}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => respond('answer')} disabled={busy || !answer.trim()}>
                        {busy ? <Loader2 aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : null}
                        Continue
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => respond('skip')} disabled={busy}>Skip this</Button>
                    <Button size="sm" variant="ghost" onClick={() => respond('skipAll')} disabled={busy}>Skip all and tailor</Button>
                </div>
            </section>
        );
    }

    if (state.kind === 'generating') {
        return (
            <section role="status" className="surface-work rounded-xl border border-border bg-card p-5">
                <p className={cn(typeStyles.small, 'flex items-center gap-2 text-foreground')}>
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                    Tailoring your resume for this job{state.stage ? ` · ${state.stage}` : '…'}
                </p>
                <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>
                    Usually under a minute. You can leave this page; it keeps going.
                </p>
            </section>
        );
    }

    if (state.kind === 'done') {
        return (
            <section className="surface-work flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className={cn(typeStyles.small, 'flex items-center gap-2 text-foreground')}>
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
                    Your resume for this job is ready. Your original resume is unchanged.
                </p>
                <Button asChild size="sm" className="shrink-0 gap-1.5">
                    <Link href={`/editor/${state.resumeId}`}>
                        <FileText aria-hidden className="size-3.5" />
                        Open tailored resume
                    </Link>
                </Button>
            </section>
        );
    }

    return (
        <section className="surface-work flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <p className={cn(typeStyles.h3, 'text-foreground')}>Tailor your resume for this job</p>
                <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                    Uses the job description Patronus already read, and only what you have actually done. Your original resume stays as it is.
                </p>
            </div>
            <Button className="shrink-0 gap-1.5" onClick={start} disabled={state.kind === 'starting'}>
                {state.kind === 'starting' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />}
                Tailor my resume
            </Button>
        </section>
    );
}
