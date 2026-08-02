'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Circle, Lock, Minus, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    completeMission,
    pauseMission,
    resumeMission,
    setStepStatus,
    startMission,
    type HomeView,
    type MissionOption,
    type MissionStepView,
    type MissionView,
} from '@/actions/missions';
import type { MissionResult } from '@/lib/missions/catalog';

/**
 * Home (PRD 05 §5.2) — the active mission and what needs you today.
 *
 * The card is the whole point of Missions: a multi-week program rendered so
 * that the current step is unmistakable and everything else is context.
 *
 * Two things it deliberately does NOT do:
 *
 *   It does not nag. There is no streak, no red, no "you're behind". An
 *   overdue mission says the date has passed and nothing more — §2 rule 2 is
 *   that a paused mission is not a failure state, and a late one is not
 *   either. People pause because life happened, and a UI that punishes it
 *   teaches them to abandon rather than pause.
 *
 *   It does not let you tick what you did not do. Automatic and threshold
 *   steps have no checkbox at all — they complete from the log. A mission that
 *   can be hand-waved is a to-do list, and its claim to evidence is worthless
 *   the first time someone ticks a box they did not earn.
 */

function StepRow({
    step,
    isActive,
    onSetStatus,
    busy,
}: {
    step: MissionStepView;
    isActive: boolean;
    onSetStatus: (key: string, status: 'done' | 'pending' | 'skipped') => void;
    busy: boolean;
}) {
    const done = step.status === 'done';
    const skipped = step.status === 'skipped';

    return (
        <li
            className={cn(
                'flex items-start gap-3 rounded-lg px-3 py-2.5',
                isActive && 'bg-secondary/60',
            )}
        >
            <span className="mt-0.5 shrink-0" aria-hidden>
                {done ? (
                    <Check className="size-4 text-success" />
                ) : skipped ? (
                    <Minus className="size-4 text-muted-foreground" />
                ) : (
                    <Circle
                        className={cn('size-4', isActive ? 'text-primary' : 'text-muted-foreground/50')}
                    />
                )}
            </span>

            <div className="min-w-0 flex-1">
                <p
                    className={cn(
                        'text-sm',
                        done && 'text-muted-foreground line-through',
                        skipped && 'text-muted-foreground',
                        isActive && 'font-medium text-foreground',
                    )}
                >
                    {step.title}
                    <span className="sr-only">
                        {done ? ' — done' : skipped ? ' — skipped' : isActive ? ' — current step' : ''}
                    </span>
                </p>

                {step.hint && !done && !skipped ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>
                ) : null}

                {step.progress ? (
                    <div className="mt-2 flex items-center gap-2">
                        <div
                            className="h-1.5 w-32 overflow-hidden rounded-full bg-border"
                            role="progressbar"
                            aria-valuenow={step.progress.current}
                            aria-valuemin={0}
                            aria-valuemax={step.progress.target}
                            aria-label={`${step.title}: ${step.progress.current} of ${step.progress.target}`}
                        >
                            <div
                                className="h-full rounded-full bg-primary transition-[width]"
                                style={{
                                    width: `${Math.round((step.progress.current / step.progress.target) * 100)}%`,
                                }}
                            />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                            {step.progress.current} of {step.progress.target}
                        </span>
                    </div>
                ) : null}
            </div>

            {/* Only attested steps get a control. Everything else is the log's
                answer, and offering a button would imply otherwise. */}
            {step.userActionable && !skipped ? (
                <Button
                    variant={done ? 'ghost' : 'outline'}
                    size="sm"
                    disabled={busy}
                    onClick={() => onSetStatus(step.key, done ? 'pending' : 'done')}
                    className="shrink-0 text-xs"
                >
                    {done ? 'Undo' : 'Mark done'}
                </Button>
            ) : null}

            {!done && !skipped ? (
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onSetStatus(step.key, 'skipped')}
                    className="shrink-0 text-xs text-muted-foreground"
                >
                    Skip
                </Button>
            ) : null}
        </li>
    );
}

function MissionCard({ mission, onChanged }: { mission: MissionView; onChanged: () => void }) {
    const [busy, setBusy] = React.useState(false);
    const paused = mission.status === 'paused';

    const run = async (work: () => Promise<{ success: boolean; error?: string }>) => {
        setBusy(true);
        const result = await work();
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'That did not work');
            return;
        }
        onChanged();
    };

    const onComplete = async (result: MissionResult) => {
        await run(() => completeMission({ missionId: mission.id, result }));
    };

    return (
        <section className="rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                    <h2 className="font-heading text-lg font-semibold text-foreground">{mission.title}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {mission.percent}% complete
                        {mission.targetDate ? (
                            <>
                                {' · '}
                                {/* Stated, never scolded. */}
                                {mission.overdue ? 'target date passed' : `target ${formatDate(mission.targetDate)}`}
                            </>
                        ) : null}
                        {paused ? ' · paused' : null}
                    </p>
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                        run(() => (paused ? resumeMission(mission.id) : pauseMission(mission.id)))
                    }
                    className="shrink-0 gap-1.5 text-xs"
                >
                    {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                    {paused ? 'Resume' : 'Pause'}
                </Button>
            </header>

            <div
                className="h-1 bg-border"
                role="progressbar"
                aria-valuenow={mission.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${mission.title} progress`}
            >
                <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${mission.percent}%` }}
                />
            </div>

            <ul className="divide-y divide-border/60 p-2">
                {mission.steps.map((step) => (
                    <StepRow
                        key={step.key}
                        step={step}
                        isActive={step.key === mission.activeStepKey && !paused}
                        busy={busy}
                        onSetStatus={(key, status) =>
                            run(() => setStepStatus({ missionId: mission.id, stepKey: key, status }))
                        }
                    />
                ))}
            </ul>

            {/*
                §2 rule 4 — completion always asks for the outcome. Three plain
                answers, no scoring, and "not yet" sits level with "I got it"
                rather than below it. This is the highest-intent moment in the
                product and the one most easily ruined by making the honest
                answer feel like the losing one.
            */}
            {mission.readyToComplete ? (
                <div className="border-t border-border px-5 py-4">
                    <p className="text-sm font-medium text-foreground">
                        That is everything. How did it go?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy} onClick={() => onComplete('achieved')}>
                            I got it
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onComplete('not_yet')}
                        >
                            Not yet
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onComplete('changed_course')}
                        >
                            I changed course
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function OptionCard({
    option,
    onStart,
    busy,
}: {
    option: MissionOption;
    onStart: (option: MissionOption) => void;
    busy: boolean;
}) {
    return (
        <button
            type="button"
            disabled={busy || !option.available}
            onClick={() => onStart(option)}
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
                    {/* Names the plan, never the tier enum. */}
                    {option.requiredPlan ? ` · needs ${option.requiredPlan}` : null}
                </p>
            </div>
            {option.available ? (
                <ChevronRight
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                />
            ) : null}
        </button>
    );
}

export function HomeScreen({ initial }: { initial: HomeView }) {
    const router = useRouter();
    const [busy, setBusy] = React.useState(false);

    const onStart = async (option: MissionOption) => {
        setBusy(true);
        const result = await startMission({ type: option.type });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        router.refresh();
    };

    return (
        <div className="mx-auto w-full max-w-[760px] px-4 py-8">
            {initial.mission ? (
                <MissionCard mission={initial.mission} onChanged={() => router.refresh()} />
            ) : (
                <section>
                    <h1 className="font-heading text-xl font-semibold text-foreground">
                        What are you working toward?
                    </h1>
                    {/*
                        §5.3: this single question does more for activation than
                        any tour. "Nothing specific" is a real answer, not a
                        dismissal — it selects the resting state, which every
                        user already has running.
                    */}
                    <p className="mt-1 text-sm text-muted-foreground">
                        Pick one and we will pace it with you. Nothing specific right now is a fine
                        answer — the log keeps working either way.
                    </p>

                    <div className="mt-5 space-y-2">
                        {initial.options.map((option) => (
                            <OptionCard
                                key={option.type}
                                option={option}
                                onStart={onStart}
                                busy={busy}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
