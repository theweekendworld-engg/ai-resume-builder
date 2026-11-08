import * as React from 'react';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { JobStage, JobStageStatus } from '@/lib/jobStages';

/**
 * `ProgressRail` — where something is in a fixed sequence of stages, drawn as
 * a horizontal rail of nodes (Dossier, docs/design/03-dossier.md §5).
 *
 * Built for a job's four stages (Analyzed → Tailored → Email ready →
 * Applied; derive them with `jobStages()` from `@/lib/jobStages`), but any
 * ordered steps work.
 *
 *   done      filled blue node with a check, blue connector after it
 *   current   blue ring with a dot; warning when `tone="attention"` (it waits
 *             on the user, e.g. a drafted email nobody has sent)
 *   upcoming  hollow node on a ruled line
 *   skipped   dashed hollow node with a dash — the step was passed over, and
 *             the rail says so instead of pretending it happened
 *
 * Never colour-only: each step carries its status in text for screen readers
 * (`aria-current="step"` on the current one), and the default size prints
 * every label. `compact` is for list rows: nodes only, plus the next step in
 * words beside them.
 */

export type ProgressRailStatus = JobStageStatus;

export interface ProgressRailStep {
    key: string;
    label: string;
    status: ProgressRailStatus;
    /** A short fact under the label: "Nov 4", "v3", "82 fit". */
    detail?: React.ReactNode;
    /** `attention` marks a current step that is waiting on the user. */
    tone?: 'default' | 'attention';
}

export interface ProgressRailProps {
    steps: ProgressRailStep[] | JobStage[];
    /** Accessible name: "Progress for Senior Engineer at Plivo". */
    label: string;
    size?: 'default' | 'compact';
    className?: string;
}

const STATUS_TEXT: Record<ProgressRailStatus, string> = {
    done: 'done',
    current: 'current step',
    upcoming: 'not started',
    skipped: 'skipped',
};

function Node({ status, tone, compact }: { status: ProgressRailStatus; tone: 'default' | 'attention'; compact: boolean }) {
    const attention = tone === 'attention' && status === 'current';
    if (compact) {
        return (
            <span
                aria-hidden
                className={cn(
                    'block size-2.5 shrink-0 rounded-full transition-colors duration-150',
                    status === 'done' && 'bg-primary',
                    status === 'current' && (attention ? 'border-2 border-warning bg-card' : 'border-2 border-primary bg-card'),
                    status === 'upcoming' && 'border border-border-strong bg-card',
                    status === 'skipped' && 'border border-dashed border-border-strong bg-transparent',
                )}
            />
        );
    }
    return (
        <span
            aria-hidden
            className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-150',
                status === 'done' && 'bg-primary text-primary-foreground',
                status === 'current' && (attention ? 'border-2 border-warning bg-card' : 'border-2 border-primary bg-card'),
                status === 'upcoming' && 'border border-border-strong/70 bg-card',
                status === 'skipped' && 'border border-dashed border-border-strong/70 bg-card text-muted-foreground',
            )}
        >
            {status === 'done' ? <Check className="size-3" strokeWidth={3} /> : null}
            {status === 'current' ? <span className={cn('size-2 rounded-full', attention ? 'bg-warning' : 'bg-primary')} /> : null}
            {status === 'skipped' ? <Minus className="size-3" strokeWidth={2.5} /> : null}
        </span>
    );
}

export function ProgressRail({ steps, label, size = 'default', className }: ProgressRailProps) {
    const compact = size === 'compact';
    const list = steps as ProgressRailStep[];
    const current = list.find((step) => step.status === 'current');
    const allDone = list.length > 0 && list.every((step) => step.status === 'done' || step.status === 'skipped');

    if (compact) {
        return (
            <div className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
                <ol aria-label={label} className="flex shrink-0 items-center">
                    {list.map((step, index) => (
                        <li key={step.key} aria-current={step.status === 'current' ? 'step' : undefined} className="flex items-center">
                            {index > 0 ? (
                                <span aria-hidden className={cn('h-px w-3', list[index - 1].status === 'done' ? 'bg-primary' : 'bg-border-strong/50')} />
                            ) : null}
                            <Node status={step.status} tone={step.tone ?? 'default'} compact />
                            <span className="sr-only">
                                {step.label}, {STATUS_TEXT[step.status]}
                                {index < list.length - 1 ? '; ' : ''}
                            </span>
                        </li>
                    ))}
                </ol>
                <span aria-hidden className={cn('truncate text-xs', current?.tone === 'attention' ? 'font-medium text-warning' : 'text-muted-foreground')}>
                    {current ? current.label : allDone ? list[list.length - 1]?.label : null}
                </span>
            </div>
        );
    }

    return (
        <ol aria-label={label} className={cn('flex w-full items-start', className)}>
            {list.map((step, index) => {
                const last = index === list.length - 1;
                const tone = step.tone ?? 'default';
                return (
                    <li
                        key={step.key}
                        aria-current={step.status === 'current' ? 'step' : undefined}
                        className={cn('flex min-w-0 flex-col', last ? 'flex-none' : 'flex-1')}
                    >
                        <div className="flex items-center">
                            <Node status={step.status} tone={tone} compact={false} />
                            {!last ? (
                                <span
                                    aria-hidden
                                    className={cn('mx-2 h-px flex-1 transition-colors duration-150', step.status === 'done' ? 'bg-primary' : 'bg-border-strong/40')}
                                />
                            ) : null}
                        </div>
                        <span
                            className={cn(
                                'mt-2 pr-2 text-xs leading-4',
                                step.status === 'done' && 'text-foreground',
                                step.status === 'current' && (tone === 'attention' ? 'font-semibold text-warning' : 'font-semibold text-foreground'),
                                (step.status === 'upcoming' || step.status === 'skipped') && 'text-muted-foreground',
                            )}
                        >
                            {step.label}
                            <span className="sr-only">, {STATUS_TEXT[step.status]}</span>
                        </span>
                        {step.detail ? <span className="ledger mt-0.5 pr-2 text-[11px] leading-4 text-muted-foreground">{step.detail}</span> : null}
                    </li>
                );
            })}
        </ol>
    );
}
