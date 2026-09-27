'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Loader2, Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { cn } from '@/lib/utils';
import { clearPendingScore, readPendingScore } from '@/lib/pendingScore';
import { trackFunnelEvent } from '@/lib/funnelEvents';
import {
    finishOnboarding,
    skipOnboarding,
    startOnboardingFromStash,
    startOnboardingFromText,
    startOnboardingFromUpload,
    type WelcomeState,
} from '@/actions/onboarding';
import type { StartOutcome } from '@/lib/onboarding/startFromResume';
import { getHome, startMission, type MissionOption } from '@/actions/missions';
import type { ParsedResumeData } from '@/lib/aiSchemas';

/**
 * First run.
 *
 * One job: turn what the user has into a resume they can open. Every way in
 * ends in the editor with a real document, because "we read your history, now
 * paste a job description" left people who came to fix THEIR resume without
 * one (audit 2026-09-27, D).
 *
 *   From `/score` (server stash): one tap, and the fixes open with it.
 *   From `/score` (this tab only): the same, from sessionStorage.
 *   Upload: the upload is the action.
 *   Nothing to hand: skip to the dashboard, which names the next step.
 *
 * Preferences (length, tone) are no longer asked here: nobody has a reason to
 * answer them before seeing a resume, and they live on the dashboard Profile.
 */

type Step = 'history' | 'mission';

export type WelcomeStash = { id: string; score: number; fixes: number };

function StepDots({ total, index }: { total: number; index: number }) {
    if (total < 2) return null;
    return (
        <div className="flex items-center gap-1.5" role="presentation">
            {Array.from({ length: total }, (_, i) => (
                <span key={i} className={cn('h-1 rounded-full transition-all', i === index ? 'w-6 bg-primary' : 'w-1.5 bg-border')} />
            ))}
        </div>
    );
}

function readSummary(outcome: StartOutcome['outcome']): string {
    const parts = [
        outcome.experiences > 0 && `${outcome.experiences} role${outcome.experiences === 1 ? '' : 's'}`,
        outcome.projects > 0 && `${outcome.projects} project${outcome.projects === 1 ? '' : 's'}`,
        outcome.education > 0 && `${outcome.education} qualification${outcome.education === 1 ? '' : 's'}`,
    ].filter(Boolean) as string[];
    return parts.length ? `Read ${parts.join(', ')}.` : 'Read your resume.';
}

export function WelcomeFlow({
    initial,
    next,
    stash,
}: {
    initial: WelcomeState;
    /** Where the CTA that started this was going. Honoured on the way out. */
    next: string | null;
    /** A `/score` result held server-side, when they came from "Fix all". */
    stash: WelcomeStash | null;
}) {
    const router = useRouter();
    const [step, setStep] = React.useState<Step>('history');
    const [busy, setBusy] = React.useState(false);
    const [carried, setCarried] = React.useState<{ text: string; score: number; fixes: number } | null>(null);
    const [options, setOptions] = React.useState<MissionOption[]>([]);
    /** Where to go once the mission question (if any) is answered. */
    const [destination, setDestination] = React.useState<string | null>(null);

    // Fallback handoff: only when there is no server stash (the stash POST failed).
    React.useEffect(() => {
        if (stash) return;
        const pending = readPendingScore();
        if (pending?.extractedText) setCarried({ text: pending.extractedText, score: pending.score, fixes: pending.fixes.length });
    }, [stash]);

    React.useEffect(() => {
        if (!initial.missionsEnabled) return;
        void getHome().then((result) => {
            if (result.success) setOptions(result.data.options);
        });
    }, [initial.missionsEnabled]);

    const totalSteps = initial.missionsEnabled ? 2 : 1;

    const finish = async (to: string | null, via: 'finish' | 'skip' = 'finish') => {
        setBusy(true);
        const fn = via === 'skip' ? skipOnboarding : finishOnboarding;
        const result = await fn(to ?? next ?? undefined);
        if (!result.success) {
            setBusy(false);
            toast.error(result.error ?? 'Something went wrong.');
            return;
        }
        router.push(result.data.next);
    };

    /** A resume now exists. Mission question first if it is on, else open it. */
    const opened = async (outcome: StartOutcome, editorPath: string) => {
        toast.success(readSummary(outcome.outcome), {
            description: outcome.fixes > 0 ? `Opening your resume with ${outcome.fixes} fix${outcome.fixes === 1 ? '' : 'es'} ready.` : 'Opening your resume.',
        });
        // The handoff did its job; a later visit must not replay it.
        clearPendingScore();
        // An explicit destination the user chose (e.g. checkout) still wins.
        const to = next ?? editorPath;
        if (initial.missionsEnabled && options.length > 0 && !stash) {
            setDestination(to);
            setBusy(false);
            setStep('mission');
            return;
        }
        await finish(to);
    };

    const useStash = async () => {
        if (!stash) return;
        setBusy(true);
        const result = await startOnboardingFromStash(stash.id);
        if (!result.success) {
            setBusy(false);
            toast.error(result.error);
            return;
        }
        trackFunnelEvent('score_to_signup', { score: Math.round(stash.score), resumeId: result.data.resumeId });
        await opened(result.data, `/editor/${result.data.resumeId}?stash=${stash.id}`);
    };

    const useCarried = async () => {
        if (!carried) return;
        setBusy(true);
        const result = await startOnboardingFromText(carried.text, carried.score);
        if (!result.success) {
            setBusy(false);
            toast.error(result.error);
            return;
        }
        trackFunnelEvent('score_to_signup', { score: Math.round(carried.score), resumeId: result.data.resumeId });
        // The editor seeds the checklist from this tab's handoff, so it is not
        // cleared until the editor has read it.
        toast.success(readSummary(result.data.outcome));
        await finish(next ?? `/editor/${result.data.resumeId}`);
    };

    const onUploaded = async (parsed: ParsedResumeData) => {
        setBusy(true);
        const result = await startOnboardingFromUpload(parsed);
        if (!result.success) {
            setBusy(false);
            toast.error(result.error ?? 'Could not save that resume.');
            return;
        }
        await opened(result.data, `/editor/${result.data.resumeId}`);
    };

    const chooseMission = async (option: MissionOption) => {
        setBusy(true);
        const result = await startMission({ type: option.type });
        if (!result.success) {
            setBusy(false);
            toast.error(result.error);
            return;
        }
        await finish(destination);
    };

    return (
        <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center px-4 py-12">
            <header className="mb-8">
                <StepDots total={totalSteps} index={step === 'history' ? 0 : 1} />
                <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight text-foreground">
                    {step === 'history'
                        ? initial.firstName ? `Welcome, ${initial.firstName}.` : 'Welcome.'
                        : 'What are you working toward?'}
                </h1>
                <p className="mt-1.5 text-muted-foreground">
                    {step === 'history'
                        ? stash || carried
                            ? 'Your resume is already here. One tap and it opens with the fixes from your check.'
                            : 'Start from your current resume. We read it in once, and everything you make builds on your real work.'
                        : 'Pick one and we will pace it with you. You can change it whenever.'}
                </p>
            </header>

            {step === 'history' ? (
                <div className="space-y-4">
                    {stash || carried ? (
                        <Card className="border-primary/30">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Sparkles className="size-4 text-primary" aria-hidden />
                                    The resume you just checked
                                </CardTitle>
                                <CardDescription>
                                    Score {Math.round((stash ?? carried)!.score)}
                                    {(stash ?? carried)!.fixes > 0
                                        ? ` · ${(stash ?? carried)!.fixes} fix${(stash ?? carried)!.fixes === 1 ? '' : 'es'} ready to apply`
                                        : ''}
                                    . No need to upload it again.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <Button className="w-full gap-2" disabled={busy} onClick={stash ? useStash : useCarried}>
                                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                                    {busy ? 'Opening your resume…' : 'Open it and start fixing'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="w-full text-sm text-muted-foreground"
                                    disabled={busy}
                                    onClick={() => {
                                        clearPendingScore();
                                        setCarried(null);
                                        router.replace('/welcome?stash=none');
                                    }}
                                >
                                    Use a different file
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Upload your resume</CardTitle>
                                <CardDescription>
                                    PDF, up to 5MB. We read your roles, projects and dates into your history and
                                    open the resume in the editor. Nothing is shared with anyone.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResumeUploadZone compact onParsed={onUploaded} />
                            </CardContent>
                        </Card>
                    )}

                    <Button
                        variant="ghost"
                        className="w-full text-sm text-muted-foreground"
                        disabled={busy}
                        onClick={() => void finish(null, 'skip')}
                    >
                        I&apos;ll add my history later
                    </Button>
                </div>
            ) : (
                <div className="space-y-2">
                    {options.map((option) => (
                        <button
                            key={option.type}
                            type="button"
                            disabled={busy || !option.available}
                            onClick={() => void chooseMission(option)}
                            className={cn(
                                'group flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors',
                                option.available ? 'hover:border-primary/40 hover:bg-secondary/40' : 'opacity-70',
                            )}
                        >
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                    {option.label}
                                    {!option.available ? <Lock className="size-3 text-muted-foreground" aria-hidden /> : null}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">{option.blurb}</p>
                                <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                                    {option.durationLabel}
                                    {option.requiredPlan ? ` · needs ${option.requiredPlan}` : null}
                                </p>
                            </div>
                            {option.available ? (
                                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                            ) : null}
                        </button>
                    ))}
                    <Button variant="ghost" className="w-full text-sm text-muted-foreground" disabled={busy} onClick={() => void finish(destination)}>
                        Nothing specific right now
                    </Button>
                </div>
            )}
        </div>
    );
}
