'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, FileText, Loader2, Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { cn } from '@/lib/utils';
import { clearPendingScore, readPendingScore } from '@/lib/pendingScore';
import {
    finishOnboarding,
    importResumeText,
    skipOnboarding,
    type ImportOutcome,
    type WelcomeState,
} from '@/actions/onboarding';
import { getHome, startMission, type MissionOption } from '@/actions/missions';
import { importParsedResumeData } from '@/actions/resumeImport';
import type { ParsedResumeData } from '@/lib/aiSchemas';

/**
 * First run.
 *
 * One job: get the user's history in. A profile with a name and no history
 * generates nothing, so everything else — links, target level, preferences —
 * waits until there is a document to apply it to.
 *
 * ── The three ways in, in order of how good they are ────────────────────────
 *
 *   They came from `/score`. Their resume has already been read, so there is
 *   nothing to upload and nothing to type. This is the best onboarding in the
 *   product and until now it was silently broken — `forceRedirectUrl` on the
 *   sign-up page overrode the redirect that would have collected the handoff,
 *   so every one of those users landed on an empty dashboard.
 *
 *   They upload one. Same result, one extra step.
 *
 *   They have nothing to hand. Skipping is a first-class choice, not a
 *   punished one — a wall on the first screen loses the user entirely, and the
 *   builder can collect history too.
 */

type Step = 'history' | 'mission' | 'done';

function StepDots({ step, total, index }: { step: string; total: number; index: number }) {
    return (
        <div className="flex items-center gap-1.5" role="presentation">
            {Array.from({ length: total }, (_, i) => (
                <span
                    key={i}
                    className={cn(
                        'h-1 rounded-full transition-all',
                        i === index ? 'w-6 bg-primary' : 'w-1.5 bg-border',
                    )}
                />
            ))}
            <span className="sr-only">{step}</span>
        </div>
    );
}

/** What we found, named back to them. Proof the tool read the real document. */
function ImportedSummary({ outcome }: { outcome: ImportOutcome }) {
    const parts = [
        outcome.experiences > 0 && `${outcome.experiences} role${outcome.experiences === 1 ? '' : 's'}`,
        outcome.projects > 0 && `${outcome.projects} project${outcome.projects === 1 ? '' : 's'}`,
        outcome.education > 0 && `${outcome.education} qualification${outcome.education === 1 ? '' : 's'}`,
    ].filter(Boolean) as string[];

    return (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Check className="size-4 text-success" aria-hidden />
                {parts.length > 0 ? `Got ${parts.join(', ')}.` : 'Read your resume.'}
            </p>
            {outcome.companies.length > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                    {outcome.companies.join(', ')}
                    {outcome.experiences > outcome.companies.length ? ', and more' : ''}. You can edit
                    any of it later.
                </p>
            ) : null}
        </div>
    );
}

export function WelcomeFlow({ initial }: { initial: WelcomeState }) {
    const router = useRouter();

    const [step, setStep] = React.useState<Step>(initial.hasHistory ? 'mission' : 'history');
    const [busy, setBusy] = React.useState(false);
    const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null);
    const [carried, setCarried] = React.useState<string | null>(null);
    const [options, setOptions] = React.useState<MissionOption[]>([]);

    // The `/score` handoff. Read once on mount and left in place until it is
    // actually used, so a refresh mid-flow does not lose it.
    React.useEffect(() => {
        const pending = readPendingScore();
        if (pending?.extractedText) setCarried(pending.extractedText);
    }, []);

    React.useEffect(() => {
        if (!initial.missionsEnabled) return;
        void getHome().then((result) => {
            if (result.success) setOptions(result.data.options);
        });
    }, [initial.missionsEnabled]);

    const totalSteps = initial.missionsEnabled ? 2 : 1;

    const leave = async (fn: () => Promise<{ success: boolean; data?: { next: string }; error?: string }>) => {
        setBusy(true);
        const result = await fn();
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'Something went wrong.');
            return;
        }
        router.push(result.data!.next);
    };

    const advance = () => {
        if (initial.missionsEnabled) {
            setStep('mission');
            return;
        }
        void leave(finishOnboarding);
    };

    const useCarried = async () => {
        if (!carried) return;
        setBusy(true);
        const result = await importResumeText(carried);
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        clearPendingScore();
        setOutcome(result.data);
    };

    const onUploaded = async (parsed: ParsedResumeData) => {
        setBusy(true);
        const result = await importParsedResumeData(parsed, {
            mergeProfile: true,
            sections: { experience: true, education: true, projects: true, achievements: true },
        });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'Could not save that resume.');
            return;
        }
        setOutcome({
            experiences: result.summary?.experience.created ?? 0,
            projects: result.summary?.projects.created ?? 0,
            education: result.summary?.education.created ?? 0,
            companies: parsed.experiences
                .map((item) => item.company?.trim())
                .filter((company): company is string => Boolean(company))
                .slice(0, 4),
        });
    };

    const chooseMission = async (option: MissionOption) => {
        setBusy(true);
        const result = await startMission({ type: option.type });
        setBusy(false);
        if (!result.success) {
            // A locked mission is not a dead end — finishing still works, and
            // Home shows the plan that unlocks it.
            toast.error(result.error);
            return;
        }
        void leave(finishOnboarding);
    };

    return (
        <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center px-4 py-12">
            <header className="mb-8">
                <StepDots
                    step={step}
                    total={totalSteps}
                    index={step === 'history' ? 0 : 1}
                />
                <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight text-foreground">
                    {step === 'history'
                        ? initial.firstName
                            ? `Welcome, ${initial.firstName}.`
                            : 'Welcome.'
                        : 'What are you working toward?'}
                </h1>
                <p className="mt-1.5 text-muted-foreground">
                    {step === 'history'
                        ? 'Everything here works off what you have actually done, so that is the one thing we need.'
                        : 'Pick one and we will pace it with you. You can change it whenever.'}
                </p>
            </header>

            {step === 'history' ? (
                <div className="space-y-4">
                    {outcome ? (
                        <>
                            <ImportedSummary outcome={outcome} />
                            <Button className="w-full gap-2" disabled={busy} onClick={advance}>
                                Continue
                                <ArrowRight className="size-4" aria-hidden />
                            </Button>
                        </>
                    ) : carried ? (
                        // The good path. They gave us this file a minute ago.
                        <Card className="border-primary/30">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Sparkles className="size-4 text-primary" aria-hidden />
                                    We kept the resume you just checked
                                </CardTitle>
                                <CardDescription>
                                    No need to upload it again. We will read it into your history so
                                    everything you make from here is built on your real work.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <Button className="w-full gap-2" disabled={busy} onClick={useCarried}>
                                    {busy ? (
                                        <Loader2 className="size-4 animate-spin" aria-hidden />
                                    ) : (
                                        <FileText className="size-4" aria-hidden />
                                    )}
                                    {busy ? 'Reading it…' : 'Use it'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="w-full text-sm text-muted-foreground"
                                    disabled={busy}
                                    onClick={() => {
                                        clearPendingScore();
                                        setCarried(null);
                                    }}
                                >
                                    Use a different file
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Start from your current resume</CardTitle>
                                <CardDescription>
                                    We read it into your history — roles, projects, dates. It is the
                                    fastest way in, and nothing is shared with anyone.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResumeUploadZone compact onParsed={onUploaded} />
                            </CardContent>
                        </Card>
                    )}

                    {!outcome ? (
                        <Button
                            variant="ghost"
                            className="w-full text-sm text-muted-foreground"
                            disabled={busy}
                            onClick={() => void leave(skipOnboarding)}
                        >
                            I&apos;ll add my history later
                        </Button>
                    ) : null}
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
                                option.available
                                    ? 'hover:border-primary/40 hover:bg-secondary/40'
                                    : 'opacity-70',
                            )}
                        >
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                    {option.label}
                                    {!option.available ? (
                                        <Lock className="size-3 text-muted-foreground" aria-hidden />
                                    ) : null}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">{option.blurb}</p>
                                <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                                    {option.durationLabel}
                                    {option.requiredPlan ? ` · needs ${option.requiredPlan}` : null}
                                </p>
                            </div>
                            {option.available ? (
                                <ArrowRight
                                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                    aria-hidden
                                />
                            ) : null}
                        </button>
                    ))}

                    {/*
                        §5.3 lists this alongside the seven. It is a real answer
                        — the resting state everyone already has — not a way to
                        dismiss the question.
                    */}
                    <Button
                        variant="ghost"
                        className="w-full text-sm text-muted-foreground"
                        disabled={busy}
                        onClick={() => void leave(finishOnboarding)}
                    >
                        Nothing specific right now
                    </Button>
                </div>
            )}
        </div>
    );
}
