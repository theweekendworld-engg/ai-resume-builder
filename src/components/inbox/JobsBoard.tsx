'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Briefcase, Check, ExternalLink, ListFilter, Search, X } from 'lucide-react';

import { EmptyState, InitialAvatar, Pill, Segmented, focusRing } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { VERDICT_LABEL } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import { BOARD_COLUMNS, COLUMN_LABELS, COLUMN_OF_STATUS, type BoardColumn, type JobBoardItem } from '@/lib/inbox/types';
import type { FitVerdict, WorkMode } from '@/lib/scout/types';

import { JobStatusMenu } from './JobStatusMenu';
import { DEFAULT_STATE, hasBoardFilters, hrefFor, jobHref, SINCE_OPTIONS, toggle, type InboxState } from './params';

/**
 * The jobs list (redesign 2026-10-03).
 *
 * It was a five-column board: with a handful of jobs that is four columns of
 * "Nothing here." and role titles wrapped three words a line. A list with a
 * status switch reads like Linear's issues: one row per job, the fit as a
 * quiet pill, the status menu in the row, and every filter behind one button.
 */

const VERDICT_FILTERS: FitVerdict[] = ['strong', 'possible', 'stretch', 'not_a_fit'];
const WORK_MODE_FILTERS: { value: WorkMode; label: string }[] = [
    { value: 'remote', label: 'Remote' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'onsite', label: 'Onsite' },
];
const WORK_MODE_LABEL: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite', unknown: '' };

const VERDICT_DOT: Record<FitVerdict, 'success' | 'info' | 'warning' | 'muted'> = {
    strong: 'success',
    possible: 'info',
    stretch: 'warning',
    not_a_fit: 'muted',
    unknown: 'muted',
};

type View = 'open' | BoardColumn;

export function FitPill({ verdict, score }: { verdict: FitVerdict | null; score: number | null }) {
    if (!verdict && score === null) return null;
    const v = verdict ?? 'unknown';
    return (
        <Pill dot={VERDICT_DOT[v]}>
            {VERDICT_LABEL[v]}
            {score !== null ? <span className="text-muted-foreground">{score}</span> : null}
        </Pill>
    );
}

/* ───────────────────────────────────────────────────────────── toolbar */

function OptionChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                focusRing,
                'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors',
                active ? 'border-foreground/30 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
        >
            {active ? <Check aria-hidden className="size-3" /> : null}
            {children}
        </button>
    );
}

function FilterMenu({ state, active }: { state: InboxState; active: number }) {
    const router = useRouter();
    const [location, setLocation] = React.useState(state.location);
    React.useEffect(() => setLocation(state.location), [state.location]);
    // replace, not push: tweaking a filter is not a place to go back to.
    const go = (patch: Partial<InboxState>) => router.replace(hrefFor(state, patch), { scroll: false });

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                    <ListFilter aria-hidden className="size-3.5" />
                    Filter
                    {active > 0 ? <span className="num rounded bg-foreground px-1 text-[10px] text-background">{active}</span> : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4 p-4">
                <fieldset>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">Fit</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {VERDICT_FILTERS.map((verdict) => (
                            <OptionChip key={verdict} active={state.verdicts.includes(verdict)} onClick={() => go({ verdicts: toggle(state.verdicts, verdict) })}>
                                {VERDICT_LABEL[verdict]}
                            </OptionChip>
                        ))}
                    </div>
                </fieldset>
                <fieldset>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">Work mode</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {WORK_MODE_FILTERS.map((mode) => (
                            <OptionChip key={mode.value} active={state.workModes.includes(mode.value)} onClick={() => go({ workModes: toggle(state.workModes, mode.value) })}>
                                {mode.label}
                            </OptionChip>
                        ))}
                    </div>
                </fieldset>
                <fieldset>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">Added</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {SINCE_OPTIONS.map((days) => (
                            <OptionChip key={days} active={state.sinceDays === days} onClick={() => go({ sinceDays: state.sinceDays === days ? null : days })}>
                                Last {days} days
                            </OptionChip>
                        ))}
                    </div>
                </fieldset>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        go({ location: location.trim() });
                    }}
                >
                    <label htmlFor="job-location" className="mb-2 block text-xs font-medium text-muted-foreground">Location</label>
                    <Input
                        id="job-location"
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                        onBlur={() => {
                            if (location.trim() !== state.location) go({ location: location.trim() });
                        }}
                        placeholder="Bengaluru, Remote…"
                        maxLength={80}
                        className="h-8 text-base sm:text-[13px]"
                    />
                </form>
                {active > 0 ? (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => router.replace(hrefFor(DEFAULT_STATE), { scroll: false })}>
                        <X aria-hidden className="size-3" /> Clear filters
                    </Button>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}

function SortMenu({ state }: { state: InboxState }) {
    const router = useRouter();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Sort">
                    <ArrowUpDown aria-hidden className="size-3.5" />
                    <span className="hidden sm:inline">{state.sort === 'recent' ? 'Newest' : 'Best fit'}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={state.sort} onValueChange={(value) => router.replace(hrefFor(state, { sort: value as InboxState['sort'] }), { scroll: false })}>
                    <DropdownMenuRadioItem value="fit">Best fit</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="recent">Newest</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/* ─────────────────────────────────────────────────────────────── row */

function formatDay(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function JobRow({ item, onChanged }: { item: JobBoardItem; onChanged: () => void }) {
    const target = jobHref(item);
    const title = item.role || 'Untitled role';
    const meta = [item.company || 'Unknown company', item.location, item.workMode ? WORK_MODE_LABEL[item.workMode] : null].filter(Boolean).join(' · ');
    // The strongest reason, or else the first concern: the row's one line of why.
    const why = item.topStrength ?? item.topConcern;

    // The title link covers the row (after:inset-0); the controls sit above it.
    const titleNode = target ? (
        target.external ? (
            <a href={target.href} target="_blank" rel="noopener noreferrer nofollow" className={cn(focusRing, 'rounded-sm after:absolute after:inset-0')}>
                {title}
                <ExternalLink aria-hidden className="ml-1 inline size-3 text-muted-foreground" />
            </a>
        ) : (
            <Link href={target.href} className={cn(focusRing, 'rounded-sm after:absolute after:inset-0')}>{title}</Link>
        )
    ) : (
        title
    );

    return (
        <li className="relative flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/50 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <InitialAvatar name={item.company} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{titleNode}</p>
                    <p className="truncate text-[13px] text-muted-foreground">{meta}</p>
                    {why ? (
                        <p className="mt-1 hidden truncate text-xs text-muted-foreground lg:block" title={why}>
                            {item.topStrength ? <Check aria-hidden className="mr-1 inline size-3 text-success" /> : null}
                            {why}
                        </p>
                    ) : null}
                </div>
            </div>
            {/* Fixed widths from md, so the columns line up row to row like a table. */}
            <div className="relative z-10 flex items-center gap-3 pl-12 sm:pl-0">
                <span className="md:flex md:w-32 md:justify-end">
                    <FitPill verdict={item.verdict} score={item.fitScore} />
                </span>
                {/* The service writes the hint with its source host; shown as-is. */}
                <span className="num hidden w-44 truncate text-xs text-muted-foreground xl:inline" title={item.compHint ?? undefined}>
                    {item.compHint ?? ''}
                </span>
                <span className="md:flex md:w-32 md:justify-end">
                    <JobStatusMenu target={{ workspaceId: item.workspaceId }} status={item.status} size="xs" onChanged={onChanged} />
                </span>
                <span className="num hidden w-12 text-right text-xs text-muted-foreground md:inline">{formatDay(item.updatedAt)}</span>
            </div>
        </li>
    );
}

/* ─────────────────────────────────────────────────────────────── list */

export function JobsBoard({ state, items }: { state: InboxState; items: JobBoardItem[] }) {
    const router = useRouter();
    const refresh = React.useCallback(() => router.refresh(), [router]);
    const [view, setView] = React.useState<View>('open');
    const activeFilters = state.verdicts.length + state.workModes.length + (state.location ? 1 : 0) + (state.sinceDays ? 1 : 0);

    if (items.length === 0 && !hasBoardFilters(state)) {
        return (
            <EmptyState
                icon={Briefcase}
                title="No jobs yet"
                description="Paste a job link in chat or with Add job, or send one to the Telegram bot. It lands here scored against your record."
                action={{ label: 'Open chat', href: '/chat' }}
                secondary={{ label: 'Link Telegram', href: '/settings/channels' }}
            />
        );
    }

    const columnOf = (item: JobBoardItem) => COLUMN_OF_STATUS[item.status];
    const open = items.filter((item) => columnOf(item) !== 'closed');
    const visible = view === 'open' ? open : items.filter((item) => columnOf(item) === view);
    const options: { value: View; label: string; count: number }[] = [
        { value: 'open', label: 'Open', count: open.length },
        ...BOARD_COLUMNS.map((column) => ({
            value: column as View,
            label: COLUMN_LABELS[column],
            count: items.filter((item) => columnOf(item) === column).length,
        })),
    ];

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented label="Job status" options={options} value={view} onChange={setView} />
                <div className="flex items-center gap-2">
                    <FilterMenu state={state} active={activeFilters} />
                    <SortMenu state={state} />
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
                    <Search aria-hidden className="size-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                        {activeFilters > 0 ? 'No jobs match these filters.' : `No jobs in ${options.find((o) => o.value === view)?.label ?? 'this view'}.`}
                    </p>
                    {activeFilters > 0 ? (
                        <Button asChild variant="outline" size="sm">
                            <Link href={hrefFor(DEFAULT_STATE)}>Clear filters</Link>
                        </Button>
                    ) : null}
                </div>
            ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {visible.map((item) => (
                        <JobRow key={item.workspaceId} item={item} onChanged={refresh} />
                    ))}
                </ul>
            )}
        </div>
    );
}
