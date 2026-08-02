'use client';

/**
 * The repo picker — design/02 §A2b.
 *
 * Mandatory before the first sync. A user must be able to answer "what can this
 * thing see?" in one screen, and the acceptance criterion is a hard number:
 * 500 repos, searchable, under 300ms interactive (§12).
 *
 * ── Why a hand-rolled window and not a virtualization library ─────────────
 * Rows are a fixed height and the list is flat, which is the one case where
 * windowing is twenty lines. Adding `react-window` would mean a dependency, a
 * bundle, and a measurement pass we do not need. The two things that actually
 * cost time at 500 rows are (a) rendering 500 DOM nodes and (b) re-filtering on
 * every keystroke; this fixes the first with a window and the second with a
 * memo over a lowercase substring match (`filterRepoOptions`).
 */

import * as React from 'react';
import { Lock, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { REPO_PICKER_COPY } from '@/lib/capture/consent';
import { filterRepoOptions, type RepoOption } from '@/lib/capture/views';

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 352; // 8 rows
const OVERSCAN = 6;

export interface RepoPickerProps {
    repos: RepoOption[];
    onSubmit: (selected: string[]) => void | Promise<void>;
    submitting?: boolean;
    /** Server-side failure, rendered inline. Never a toast (§A2b). */
    error?: string | null;
    className?: string;
}

function relativePush(date: Date | null, now: number | null): string {
    if (!date) return 'no recent pushes';
    if (now === null) return 'recently';
    const days = Math.max(0, Math.round((now - date.getTime()) / 86_400_000));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 14) return 'last week';
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
}

export function RepoPicker({ repos, onSubmit, submitting = false, error = null, className }: RepoPickerProps) {
    const [query, setQuery] = React.useState('');
    const [selected, setSelected] = React.useState<Set<string>>(
        () => new Set(repos.filter((repo) => repo.selected).map((repo) => repo.fullName)),
    );
    const [scrollTop, setScrollTop] = React.useState(0);
    // Read the clock in an effect, not in render: a value that changes between
    // two renders of the same input is exactly what makes a component impure,
    // and "3 days ago" is not worth that. Until it lands, rows say "recently".
    const [now, setNow] = React.useState<number | null>(null);
    React.useEffect(() => setNow(Date.now()), []);

    const visible = React.useMemo(() => filterRepoOptions(repos, query), [repos, query]);

    // Reset the scroll offset when the result set shrinks under the current
    // window, otherwise a search lands the user in blank space below the list.
    React.useEffect(() => {
        setScrollTop(0);
    }, [query]);

    const total = visible.length;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(total, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
    const rows = visible.slice(first, last);

    const toggle = React.useCallback((fullName: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(fullName)) next.delete(fullName);
            else next.add(fullName);
            return next;
        });
    }, []);

    const selectedCount = selected.size;
    const canSubmit = selectedCount > 0 && !submitting;

    return (
        <div className={cn('flex flex-col gap-4', className)}>
            <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-lg font-medium">{REPO_PICKER_COPY.heading}</h2>
                <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                    {selectedCount} of {repos.length} selected
                </p>
            </div>

            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                />
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={REPO_PICKER_COPY.searchPlaceholder}
                    className="pl-9"
                    aria-label={REPO_PICKER_COPY.searchPlaceholder}
                />
            </div>

            <div
                className="overflow-y-auto rounded-md border"
                style={{ height: VIEWPORT_HEIGHT }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                role="group"
                aria-label="Repositories"
            >
                {total === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No repos match “{query}”.</p>
                ) : (
                    <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
                        <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
                            {rows.map((repo) => {
                                const checked = selected.has(repo.fullName);
                                return (
                                    <label
                                        key={repo.fullName}
                                        className="flex cursor-pointer items-center gap-3 border-b px-3 last:border-b-0"
                                        style={{ height: ROW_HEIGHT }}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggle(repo.fullName)}
                                            aria-label={repo.fullName}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm">{repo.fullName}</span>
                                        {repo.private ? (
                                            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Private" />
                                        ) : null}
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {repo.contributions !== null ? `${repo.contributions} commits, ` : ''}
                                            {relativePush(repo.lastPushedAt, now)}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <p className="text-sm text-muted-foreground">{REPO_PICKER_COPY.hint}</p>

            {/* Zero selected disables the button with inline text, not a toast. */}
            {selectedCount === 0 ? (
                <p className="text-sm text-amber-600 dark:text-amber-500">{REPO_PICKER_COPY.emptyError}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => void onSubmit([...selected])}
                className="self-start"
            >
                {submitting ? 'Starting…' : REPO_PICKER_COPY.cta}
            </Button>
        </div>
    );
}
