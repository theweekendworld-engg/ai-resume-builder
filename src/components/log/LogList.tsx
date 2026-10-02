'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';

import {
  DensityProvider,
  WinCard,
  WinCardSkeleton,
  focusRingOutline,
  typeStyles,
} from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { WinView } from '@/actions/wins.types';
import { countLabel, groupByMonth, toWinRecord } from './adapt';

export interface LogListProps {
  wins: WinView[];
  /** The Win whose drawer is open. Kept visually active so the list keeps place. */
  openWinId: string | null;
  onOpen: (win: WinView) => void;
  /** Wins outside the plan's history window. Renders the locked boundary. */
  hiddenByPlan: number;
  onSeePlans: () => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
  className?: string;
}

/**
 * The month-grouped log.
 *
 * Month headers are sticky and carry their count: scrolling three years of
 * record without constant positional feedback is how people lose their place
 * and stop scrolling. `bg-background` and no blur — this is a list that has to
 * hold 60fps, and a blurred sticky header is one compositing layer per frame.
 */
export function LogList({
  wins,
  openWinId,
  onOpen,
  hiddenByPlan,
  onSeePlans,
  onLoadMore,
  loadingMore = false,
  hasMore = false,
  className,
}: LogListProps) {
  const groups = React.useMemo(() => groupByMonth(wins), [wins]);

  return (
    <DensityProvider density="default" className={cn('space-y-4', className)}>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`month-${group.key}`}>
          <h2
            id={`month-${group.key}`}
            className="sticky top-[var(--shell-top,0px)] z-20 flex items-center gap-3 bg-background py-2"
          >
            <span
              className={cn(
                typeStyles.caption,
                'shrink-0 uppercase tracking-[0.08em] text-muted-foreground',
              )}
            >
              {group.label}
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span className={cn(typeStyles.caption, 'num shrink-0 text-muted-foreground')}>
              {countLabel(group.wins.length, 'win')}
            </span>
          </h2>

          <div className="space-y-1">
            {group.wins.map((win) => (
              <WinCard
                key={win.id}
                id={`win-row-${win.id}`}
                win={toWinRecord(win)}
                variant="list"
                state={win.status === 'draft' ? 'draft' : 'default'}
                active={win.id === openWinId}
                onOpen={() => onOpen(win)}
              />
            ))}
          </div>
        </section>
      ))}

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading' : 'Show more'}
          </Button>
        </div>
      ) : hiddenByPlan > 0 ? (
        <HistoryBoundary count={hiddenByPlan} onSeePlans={onSeePlans} />
      ) : null}
    </DensityProvider>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The free-tier history boundary.
 *
 * Locked, not lost. The copy is verbatim from design/02 §B and the word
 * "deleted" must never appear near it — these Wins are the user's record and
 * implying we throw them away is the single fastest way to lose their trust.
 */
export function HistoryBoundary({
  count,
  onSeePlans,
}: {
  count: number;
  onSeePlans: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className={cn(typeStyles.caption, 'num shrink-0 text-muted-foreground')}>
          +{count} older {count === 1 ? 'win' : 'wins'}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <p className={cn(typeStyles.small, 'text-center text-muted-foreground')}>
        Your full record is saved. Career unlocks it.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onSeePlans}>
        See plans
      </Button>
    </div>
  );
}

/**
 * Skeleton rows matching the final geometry — never a spinner.
 *
 * The month header is part of the skeleton on purpose: without it the list
 * jumps 32px when data lands, and a layout shift on the surface people open
 * every day reads as a slow product even when it is fast.
 */
export function LogListSkeleton({ groups = 2, rows = 4 }: { groups?: number; rows?: number }) {
  return (
    <DensityProvider density="default" className="space-y-4">
      <div aria-hidden="true" className="space-y-4">
        {Array.from({ length: groups }, (_, groupIndex) => (
          <section key={groupIndex}>
            <div className="flex items-center gap-3 py-2">
              <Skeleton className="h-3 w-24" />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="space-y-1">
              {Array.from({ length: rows }, (_, rowIndex) => (
                <WinCardSkeleton key={rowIndex} density="default" />
              ))}
            </div>
          </section>
        ))}
      </div>
      <span className="sr-only">Loading your work log</span>
    </DensityProvider>
  );
}

/**
 * Sync failure is an inline banner, never a blank list. The Wins already in
 * the record are still true; only the newest ones are missing.
 */
export function SyncErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      className="surface-work flex items-start gap-3 rounded-xl border-warning/30 bg-warning/8 p-3"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <p className={cn(typeStyles.small, 'text-foreground')}>{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            typeStyles.caption,
            // The banner carries `.surface-work`, which zeroes box-shadow — so
            // a ring here would be silently invisible. Outline is a different
            // property and survives. See tokens.ts.
            focusRingOutline,
            'shrink-0 rounded-sm text-foreground hover:underline',
          )}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
