'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleSlash, Loader2, MinusCircle } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';
import type { ScoutStepView } from '@/actions/scout';
import { SCOUT_SECTION_LABELS, type ScoutSectionName } from '@/lib/scout/types';

import { formatLatency } from './format';
import { SourceLink } from './parts';

/**
 * "How this was made" — the run's step ledger, the same rows an operator sees.
 *
 * Collapsed by default: the answer is the product, the trace is what makes it
 * checkable. Each row is one attempt, so a retried step shows twice, which is
 * the honest picture of what happened.
 */

const STATUS_ICON = {
    running: Loader2,
    succeeded: CheckCircle2,
    unavailable: CircleSlash,
    skipped: MinusCircle,
    failed: AlertTriangle,
} as const;

const STATUS_WORD: Record<string, string> = {
    running: 'running',
    succeeded: 'done',
    unavailable: 'unavailable',
    skipped: 'skipped',
    failed: 'failed',
};

function stepLabel(name: string): string {
    return SCOUT_SECTION_LABELS[name as ScoutSectionName] ?? name;
}

/**
 * No cost figures here, deliberately: supplier cost is admin-only
 * (`src/lib/costPrivacy.test.ts`). The operator sees it at /admin/runs.
 */
export function StepTimeline({ steps }: { steps: ScoutStepView[] }) {
    const [open, setOpen] = React.useState(false);
    const regionId = React.useId();

    if (steps.length === 0) return null;

    const totalMs = steps.reduce((sum, step) => sum + (step.latencyMs ?? 0), 0);
    const sourceCount = new Set(steps.flatMap((step) => step.sources.map((source) => source.url))).size;
    const summary = [
        `${steps.length} step${steps.length === 1 ? '' : 's'}`,
        sourceCount ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} read` : null,
        formatLatency(totalMs) ? `${formatLatency(totalMs)} of work` : null,
    ].filter(Boolean).join(' · ');

    return (
        <section className="surface-work rounded-xl border border-border bg-card">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={regionId}
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-3 rounded-xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span>
                    <span className={cn(typeStyles.h3, 'block text-foreground')}>How this was made</span>
                    <span className={cn(typeStyles.caption, 'num mt-0.5 block text-muted-foreground')}>{summary}</span>
                </span>
                <ChevronRight
                    aria-hidden
                    className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open ? 'rotate-90' : '')}
                />
            </button>

            {open ? (
                <ol id={regionId} className="border-t border-border px-5 py-3">
                    {steps.map((step) => {
                        const Icon = STATUS_ICON[step.status as keyof typeof STATUS_ICON] ?? MinusCircle;
                        const meta = [
                            STATUS_WORD[step.status] ?? step.status,
                            step.attempt > 1 ? `attempt ${step.attempt}` : null,
                            formatLatency(step.latencyMs),
                        ].filter(Boolean).join(' · ');
                        return (
                            <li key={step.id} className="flex gap-3 py-2.5">
                                <Icon
                                    aria-hidden
                                    className={cn(
                                        'mt-0.5 size-4 shrink-0',
                                        step.status === 'running' ? 'animate-spin text-muted-foreground' : '',
                                        step.status === 'failed' ? 'text-warning' : 'text-muted-foreground',
                                    )}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                        <p className={cn(typeStyles.small, 'text-foreground')}>{stepLabel(step.name)}</p>
                                        <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>{meta}</p>
                                    </div>
                                    {step.reason && step.status !== 'succeeded' ? (
                                        <p className={cn(typeStyles.caption, 'mt-0.5 text-muted-foreground')}>{step.reason}</p>
                                    ) : null}
                                    {step.sources.length ? (
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                            {step.sources.slice(0, 8).map((source) => (
                                                <SourceLink key={source.url} url={source.url} title={source.title} />
                                            ))}
                                            {step.sources.length > 8 ? (
                                                <span className={cn(typeStyles.caption, 'text-muted-foreground')}>
                                                    +{step.sources.length - 8} more
                                                </span>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            ) : null}
        </section>
    );
}
