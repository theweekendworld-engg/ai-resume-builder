'use client';

import * as React from 'react';
import {
    AlertTriangle,
    BookOpen,
    Briefcase,
    Building2,
    CheckCircle2,
    CircleDashed,
    CircleSlash,
    ExternalLink,
    HelpCircle,
    Loader2,
    Megaphone,
    Newspaper,
    NotebookPen,
    UserRoundSearch,
    type LucideIcon,
} from 'lucide-react';

import { typeStyles, focusRing } from '@/components/patterns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { StoredSection } from '@/lib/agent/run';
import type { FitVerdict, ScoutKind } from '@/lib/scout/types';

import { domainOf, RUN_STATUS_LABEL, safeHref, sectionReason, sectionState, shortDate, VERDICT_LABEL, type RunStatus } from './format';

/* ─────────────────────────────────────────────────────────────── icons */

/** Categories get icons, not colors (docs/design/00 §3.3). */
export const KIND_ICON: Record<ScoutKind, LucideIcon> = {
    job_posting: Briefcase,
    hiring_post: Megaphone,
    company_signal: Building2,
    knowledge: BookOpen,
    work_note: NotebookPen,
    other: Newspaper,
};

/** Verdicts are one of the few places colour carries meaning (docs/design/00 §3.2). */
export const VERDICT_TONE: Record<FitVerdict, string> = {
    strong: 'text-success',
    possible: 'text-foreground',
    stretch: 'text-warning',
    not_a_fit: 'text-warning',
    unknown: 'text-muted-foreground',
};

/** The one coloured element on a job card: verdict word plus score. */
export function VerdictChip({ verdict, score, className }: { verdict: FitVerdict | null; score: number | null; className?: string }) {
    if (!verdict && score === null) return null;
    const v = verdict ?? 'unknown';
    return (
        <span className={cn(typeStyles.caption, 'num inline-flex items-center gap-1 font-medium', VERDICT_TONE[v], className)}>
            {VERDICT_LABEL[v]}
            {score !== null ? <span>· {score}</span> : null}
        </span>
    );
}

export function KindIcon({ kind, className }: { kind: ScoutKind | null; className?: string }) {
    const Icon = kind ? KIND_ICON[kind] : UserRoundSearch;
    return <Icon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.5} />;
}

/**
 * Run status. Colour is reserved for verdicts, so status is an icon and a
 * word; only `failed` borrows the warning tone, because it is the one state
 * that asks the user to do something.
 */
export function RunStatusLabel({ status, className }: { status: RunStatus; className?: string }) {
    const Icon =
        status === 'queued' || status === 'running'
            ? Loader2
            : status === 'awaiting_input'
              ? HelpCircle
              : status === 'failed'
                ? AlertTriangle
                : CheckCircle2;
    return (
        <span
            className={cn(
                typeStyles.caption,
                'inline-flex items-center gap-1.5',
                status === 'failed' ? 'text-warning' : 'text-muted-foreground',
                className,
            )}
        >
            <Icon aria-hidden className={cn('size-3.5', status === 'running' || status === 'queued' ? 'animate-spin' : '')} />
            {RUN_STATUS_LABEL[status]}
        </span>
    );
}

/* ───────────────────────────────────────────────────────────── sources */

/**
 * An external link, labelled by its domain. Every external claim on these
 * screens renders one of these next to it — a figure without its source is
 * the thing Scout exists not to show.
 */
export function SourceLink({
    url,
    title,
    date,
    className,
}: {
    url: string | null | undefined;
    title?: string | null;
    date?: string | null;
    className?: string;
}) {
    const href = safeHref(url);
    if (!href) return null;
    const domain = domainOf(href);
    const when = shortDate(date);
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={title ?? href}
            className={cn(
                typeStyles.caption,
                focusRing,
                'inline-flex max-w-full items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground hover:underline',
                className,
            )}
        >
            <ExternalLink aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{domain}</span>
            {when ? <span className="shrink-0">· {when}</span> : null}
        </a>
    );
}

/* ───────────────────────────────────────────────────────────── shells */

/**
 * One section of a run. Owns the five non-data states so each section
 * renderer only has to describe its data:
 *
 *   pending      → skeleton (or "Waiting" once the run has stopped)
 *   unavailable  → the stored reason, as information, not apology
 *   skipped      → the stored reason (budget, not applicable)
 *   failed       → the stored reason, in the warning tone
 *   needs_input  → a pointer to the question card
 */
export function SectionShell({
    title,
    icon: Icon,
    section,
    live,
    children,
    aside,
}: {
    title: string;
    icon: LucideIcon;
    section: StoredSection | undefined;
    /** Whether the run is still going; decides skeleton vs "not run". */
    live: boolean;
    children?: React.ReactNode;
    aside?: React.ReactNode;
}) {
    const state = sectionState(section);
    const reason = sectionReason(section);

    return (
        <section className="surface-work rounded-xl border border-border bg-card p-5" aria-busy={state === 'pending' && live}>
            <header className="flex items-start justify-between gap-3">
                <h2 className={cn(typeStyles.h3, 'flex items-center gap-2 text-foreground')}>
                    <Icon aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.5} />
                    {title}
                </h2>
                {aside}
            </header>

            <div className="mt-4">
                {state === 'ok' ? children : null}

                {state === 'pending' ? (
                    live ? (
                        <div className="space-y-2" aria-label={`${title}: in progress`}>
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                        </div>
                    ) : (
                        <p className={cn(typeStyles.small, 'flex items-center gap-1.5 text-muted-foreground')}>
                            <CircleDashed aria-hidden className="size-3.5" />
                            Not run.
                        </p>
                    )
                ) : null}

                {state === 'unavailable' || state === 'skipped' ? (
                    <div>
                        <p className={cn(typeStyles.small, 'flex items-start gap-1.5 text-muted-foreground')}>
                            <CircleSlash aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                            <span>{reason ?? 'Nothing to show for this link.'}</span>
                        </p>
                        {/* Partial data the section chose to keep alongside its reason. */}
                        {section && 'data' in section && section.data ? <div className="mt-3">{children}</div> : null}
                    </div>
                ) : null}

                {state === 'failed' ? (
                    <p className={cn(typeStyles.small, 'flex items-start gap-1.5 text-warning')}>
                        <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>{reason ?? 'This part did not finish.'}</span>
                    </p>
                ) : null}

                {state === 'needs_input' ? (
                    <p className={cn(typeStyles.small, 'flex items-start gap-1.5 text-muted-foreground')}>
                        <HelpCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>Waiting on your answer above.</span>
                    </p>
                ) : null}
            </div>
        </section>
    );
}

/** A labelled value row. Renders nothing when the value is empty. */
export function Fact({ label, value, source }: { label: string; value: React.ReactNode; source?: React.ReactNode }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <dt className={cn(typeStyles.small, 'text-muted-foreground')}>{label}</dt>
            <dd className={cn(typeStyles.body, 'num flex flex-wrap items-baseline gap-x-2 text-right text-foreground')}>
                <span>{value}</span>
                {source}
            </dd>
        </div>
    );
}

export function SubHeading({ children }: { children: React.ReactNode }) {
    return <h3 className={cn(typeStyles.caption, 'mb-2 mt-4 uppercase text-muted-foreground first:mt-0')}>{children}</h3>;
}
