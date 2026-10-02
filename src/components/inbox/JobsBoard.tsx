'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Briefcase, Check, ChevronDown, ChevronRight, ExternalLink, MapPin, Search, X } from 'lucide-react';

import { EmptyState, typeStyles, focusRing } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VerdictChip } from '@/components/scout/parts';
import { VERDICT_LABEL } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import type { BoardColumn, JobBoardItem } from '@/lib/inbox/types';
import type { FitVerdict, WorkMode } from '@/lib/scout/types';

import { JobStatusMenu } from './JobStatusMenu';
import {
    DEFAULT_STATE,
    groupByColumn,
    hasBoardFilters,
    hrefFor,
    jobHref,
    SINCE_OPTIONS,
    toggle,
    type BoardGroup,
    type InboxState,
} from './params';

const VERDICT_FILTERS: FitVerdict[] = ['strong', 'possible', 'stretch', 'not_a_fit'];
const WORK_MODE_FILTERS: { value: WorkMode; label: string }[] = [
    { value: 'remote', label: 'Remote' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'onsite', label: 'Onsite' },
];
const WORK_MODE_LABEL: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite', unknown: '' };

/* ───────────────────────────────────────────────────────────── filters */

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                typeStyles.caption,
                focusRing,
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1',
                active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
        >
            {active ? <Check aria-hidden className="size-3" /> : null}
            {children}
        </button>
    );
}

function Filters({ state }: { state: InboxState }) {
    const router = useRouter();
    const [location, setLocation] = React.useState(state.location);
    React.useEffect(() => setLocation(state.location), [state.location]);

    // replace, not push: tweaking a filter is not a place to go back to.
    const go = (patch: Partial<InboxState>) => router.replace(hrefFor(state, patch), { scroll: false });

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn(typeStyles.caption, 'mr-1 text-muted-foreground')}>Fit</span>
                {VERDICT_FILTERS.map((verdict) => (
                    <FilterChip key={verdict} active={state.verdicts.includes(verdict)} onClick={() => go({ verdicts: toggle(state.verdicts, verdict) })}>
                        {VERDICT_LABEL[verdict]}
                    </FilterChip>
                ))}
                <span className={cn(typeStyles.caption, 'ml-3 mr-1 text-muted-foreground')}>Work mode</span>
                {WORK_MODE_FILTERS.map((mode) => (
                    <FilterChip key={mode.value} active={state.workModes.includes(mode.value)} onClick={() => go({ workModes: toggle(state.workModes, mode.value) })}>
                        {mode.label}
                    </FilterChip>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <form
                    className="relative"
                    onSubmit={(event) => {
                        event.preventDefault();
                        go({ location: location.trim() });
                    }}
                >
                    <MapPin aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Filter by location"
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                        onBlur={() => {
                            if (location.trim() !== state.location) go({ location: location.trim() });
                        }}
                        placeholder="Location"
                        className="h-8 w-44 pl-8 text-[13px]"
                        maxLength={80}
                    />
                </form>
                <span className={cn(typeStyles.caption, 'ml-2 mr-1 text-muted-foreground')}>Added</span>
                {SINCE_OPTIONS.map((days) => (
                    <FilterChip key={days} active={state.sinceDays === days} onClick={() => go({ sinceDays: state.sinceDays === days ? null : days })}>
                        Last {days} days
                    </FilterChip>
                ))}
                <span className={cn(typeStyles.caption, 'ml-2 mr-1 text-muted-foreground')}>Sort</span>
                <FilterChip active={state.sort === 'fit'} onClick={() => go({ sort: 'fit' })}>Best fit</FilterChip>
                <FilterChip active={state.sort === 'recent'} onClick={() => go({ sort: 'recent' })}>Newest</FilterChip>
                {hasBoardFilters(state) ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => go({ verdicts: [], workModes: [], location: '', sinceDays: null })}
                    >
                        <X aria-hidden className="size-3" /> Clear
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────── card */

export function JobCard({ item, onChanged }: { item: JobBoardItem; onChanged: () => void }) {
    const target = jobHref(item);
    const where = [item.location, item.workMode ? WORK_MODE_LABEL[item.workMode] : null].filter(Boolean).join(' · ');
    const title = item.role || 'Untitled role';

    const heading = target ? (
        target.external ? (
            <a href={target.href} target="_blank" rel="noopener noreferrer nofollow" className={cn(focusRing, 'rounded-sm hover:underline')}>
                {title}
                <ExternalLink aria-hidden className="ml-1 inline size-3 text-muted-foreground" />
            </a>
        ) : (
            <Link href={target.href} className={cn(focusRing, 'rounded-sm hover:underline')}>{title}</Link>
        )
    ) : (
        title
    );

    return (
        <article className="surface-work rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className={cn(typeStyles.h3, 'text-foreground')}>{heading}</h3>
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>{item.company || 'Unknown company'}</p>
                </div>
                <VerdictChip verdict={item.verdict} score={item.fitScore} className="shrink-0 pt-0.5" />
            </div>

            {where ? (
                <p className={cn(typeStyles.caption, 'mt-1.5 flex items-center gap-1 text-muted-foreground')}>
                    <MapPin aria-hidden className="size-3" /> {where}
                </p>
            ) : null}
            {/* The service writes the hint with its source host; it is shown as-is, never reformatted. */}
            {item.compHint ? <p className={cn(typeStyles.caption, 'num mt-1 text-foreground')}>{item.compHint}</p> : null}

            {item.topStrength ? (
                <p className={cn(typeStyles.caption, 'mt-2 flex items-start gap-1.5 text-foreground')}>
                    <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2">{item.topStrength}</span>
                </p>
            ) : null}
            {item.topConcern ? (
                <p className={cn(typeStyles.caption, 'mt-1 flex items-start gap-1.5 text-muted-foreground')}>
                    <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
                    <span className="line-clamp-2">{item.topConcern}</span>
                </p>
            ) : null}

            <div className="mt-3">
                <JobStatusMenu target={{ workspaceId: item.workspaceId }} status={item.status} size="xs" onChanged={onChanged} />
            </div>
        </article>
    );
}

/* ────────────────────────────────────────────────────────────── column */

function Column({ group, onChanged, collapsible }: { group: BoardGroup; onChanged: () => void; collapsible: boolean }) {
    const [open, setOpen] = React.useState(!collapsible);
    const regionId = React.useId();
    const body = (
        <div id={regionId} className="space-y-2">
            {group.items.length === 0 ? (
                <p className={cn(typeStyles.caption, 'rounded-lg border border-dashed border-border p-3 text-muted-foreground')}>Nothing here.</p>
            ) : (
                group.items.map((item) => <JobCard key={item.workspaceId} item={item} onChanged={onChanged} />)
            )}
        </div>
    );

    return (
        <section aria-label={group.label} className="flex min-w-0 flex-col gap-2">
            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={regionId}
                    onClick={() => setOpen((value) => !value)}
                    className={cn(typeStyles.small, focusRing, 'num flex items-center gap-1 rounded-sm font-medium text-muted-foreground hover:text-foreground')}
                >
                    {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                    {group.label} · {group.items.length}
                </button>
            ) : (
                <h2 className={cn(typeStyles.small, 'num font-medium text-muted-foreground')}>
                    {group.label} · {group.items.length}
                </h2>
            )}
            {open ? body : null}
        </section>
    );
}

/* ─────────────────────────────────────────────────────────────── board */

/**
 * The job board. Desktop: the five columns side by side (scrolling sideways
 * when the window is narrow). Mobile: one column at a time, picked from a
 * switcher, because five 150px columns on a phone are five unreadable ones.
 * Closed is collapsed by default: it is history, not work.
 */
export function JobsBoard({ state, items }: { state: InboxState; items: JobBoardItem[] }) {
    const router = useRouter();
    const groups = groupByColumn(items);
    const firstNonEmpty = groups.find((group) => group.items.length > 0)?.column ?? 'to_review';
    const [mobileColumn, setMobileColumn] = React.useState<BoardColumn>(firstNonEmpty);
    const refresh = React.useCallback(() => router.refresh(), [router]);

    const filtered = hasBoardFilters(state);

    if (items.length === 0 && !filtered) {
        return (
            <EmptyState
                icon={Briefcase}
                title="No jobs yet"
                description="Send a job link to the Patronus bot on Telegram, or paste one above, and it lands here scored against your record."
                action={{ label: 'Link Telegram', href: '/settings/channels' }}
                secondary={{ label: 'Set your job-search preferences', href: '/settings/job-search' }}
            />
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <Filters state={state} />

            {items.length === 0 ? (
                <div className="flex flex-col items-start gap-2">
                    <p className={cn(typeStyles.small, 'flex items-center gap-1.5 text-muted-foreground')}>
                        <Search aria-hidden className="size-3.5" /> No jobs match these filters.
                    </p>
                    <Button asChild variant="outline" size="sm">
                        <Link href={hrefFor(DEFAULT_STATE)}>Show all jobs</Link>
                    </Button>
                </div>
            ) : (
                <>
                    {/* Mobile: one column, chosen here. */}
                    <div className="flex gap-1 overflow-x-auto md:hidden" role="tablist" aria-label="Board column">
                        {groups.map((group) => (
                            <button
                                key={group.column}
                                type="button"
                                role="tab"
                                aria-selected={mobileColumn === group.column}
                                onClick={() => setMobileColumn(group.column)}
                                className={cn(
                                    typeStyles.caption,
                                    focusRing,
                                    'num shrink-0 rounded-full border px-2.5 py-1',
                                    mobileColumn === group.column ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground',
                                )}
                            >
                                {group.label} · {group.items.length}
                            </button>
                        ))}
                    </div>
                    <div className="md:hidden">
                        {groups
                            .filter((group) => group.column === mobileColumn)
                            .map((group) => (
                                <Column key={group.column} group={group} onChanged={refresh} collapsible={false} />
                            ))}
                    </div>

                    {/* Desktop: all columns. */}
                    <div className="hidden overflow-x-auto pb-2 md:block">
                        <div className="grid min-w-[1000px] grid-cols-5 gap-3">
                            {groups.map((group) => (
                                <Column key={group.column} group={group} onChanged={refresh} collapsible={group.column === 'closed'} />
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
