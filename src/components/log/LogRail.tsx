'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';

import {
  CATEGORY_META,
  CategoryChip,
  StatTile,
  StreakBadge,
  WIN_CATEGORIES,
  typeStyles,
  type WinCategoryValue,
} from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { LogSummary } from '@/actions/wins.types';
import { recordSpanYears } from './adapt';

export interface LogRailProps {
  summary: LogSummary;
  /** Fixed reference date, so the record span is stable between renders. */
  now: Date;
  onGeneratePacket: () => void;
  /**
   * `rail` — the ≥1024px sidebar. `stacked` — the 640–1023px block above the
   * list. `strip` — the <640px two-up StatTile row, and nothing else: a phone
   * is for capture, not for reading your category mix.
   */
  variant?: 'rail' | 'stacked' | 'strip';
  className?: string;
}

export function LogRail({
  summary,
  now,
  onGeneratePacket,
  variant = 'rail',
  className,
}: LogRailProps) {
  const years = recordSpanYears(summary.recordStart, now);

  const tiles = (
    <>
      <StatTile
        value={summary.totalConfirmed}
        label="wins logged"
        hint="Confirmed wins in your record. Drafts are not counted until you confirm them."
        variant={variant === 'rail' ? 'wide' : 'default'}
      />
      <StatTile
        value={summary.withEvidence}
        label="with evidence"
        hint="Wins with at least one source behind them — a pull request, a document, a link, or something you confirmed yourself."
        variant={variant === 'rail' ? 'wide' : 'default'}
      />
    </>
  );

  if (variant === 'strip') {
    return (
      <div className={cn('grid grid-cols-2 gap-2', className)}>
        {tiles}
        {summary.streakWeeks >= 2 ? (
          <div className="col-span-2 flex justify-center">
            <StreakBadge weeks={summary.streakWeeks} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside
      aria-label="Your record"
      className={cn(variant === 'rail' ? 'space-y-4' : 'space-y-3', className)}
    >
      <div className={cn(variant === 'rail' ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2')}>
        {tiles}
      </div>

      {summary.streakWeeks >= 2 ? <StreakBadge weeks={summary.streakWeeks} /> : null}

      <RecordStatement summary={summary} years={years} />

      <CategoryMix summary={summary} />

      <Button type="button" variant="outline" className="w-full" onClick={onGeneratePacket}>
        Generate review packet
      </Button>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The standing value statement (PRD 09 §4 M3).
 *
 * This is the sentence that makes the log feel like an asset rather than a
 * list, so it names what the record is already good for. It renders only once
 * there is a record to describe — a first-run user reading "0 wins · 0 years"
 * is being told they have nothing, which is exactly wrong at that moment.
 *
 * Three rules govern the copy and none of them are stylistic:
 *   - Outcome framing, never storage framing. "74 wins saved" is a chore
 *     reporting on itself; "enough for a promotion packet" is an asset.
 *   - It ends "on demand", because availability is the whole claim — the
 *     record's value is that it is ready the day you need it, not that it exists.
 *   - Real numbers only. There is nothing to round up to here.
 */
function RecordStatement({ summary, years }: { summary: LogSummary; years: number }) {
  if (summary.totalConfirmed === 0 || years === 0) return null;

  return (
    <div className="surface-work rounded-lg border border-border bg-card p-4">
      <p className={cn(typeStyles.caption, 'uppercase tracking-[0.08em] text-muted-foreground')}>
        Your record
      </p>
      <p className={cn(typeStyles.small, 'mt-2 text-foreground')}>
        <span className="num">{summary.totalConfirmed}</span> wins ·{' '}
        <span className="num">{years}</span> {years === 1 ? 'year' : 'years'} ·{' '}
        <span className="num">{summary.withEvidence}</span> with evidence — enough for a promotion
        packet, a resume, and a negotiation dossier, on demand.
      </p>
    </div>
  );
}

/**
 * Category mix.
 *
 * All eight categories always render, including the zeroes. A missing row
 * looks like a rendering bug; a row reading `grew · 0` is the diagnosis the
 * coaching line below then explains.
 */
function CategoryMix({ summary }: { summary: LogSummary }) {
  const counts = new Map(summary.categoryMix.map((entry) => [entry.category, entry.count]));
  const rows = WIN_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
    thin: summary.gaps.includes(category),
  })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const max = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;

  // The thinnest gap, not the first: naming the category with two wins while
  // another has none is advice nobody can act on.
  const gap = rows.filter((row) => row.thin).sort((a, b) => a.count - b.count)[0];

  return (
    <div className="surface-work space-y-3 rounded-lg border border-border bg-card p-4">
      <p className={cn(typeStyles.caption, 'uppercase tracking-[0.08em] text-muted-foreground')}>
        Category mix
      </p>

      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.category} className="flex items-center gap-2">
            <span className="w-[10ch] shrink-0">
              <CategoryChip category={row.category} appearance="inline" />
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
            >
              <span
                className={cn(
                  'block h-full rounded-full',
                  row.count === 0
                    ? 'bg-transparent'
                    : row.thin
                      ? 'bg-warning'
                      : 'bg-muted-foreground/45',
                )}
                style={{ width: `${Math.round((row.count / max) * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                typeStyles.caption,
                'num w-[3ch] shrink-0 text-right',
                row.thin ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              {row.count}
            </span>
          </li>
        ))}
      </ul>

      {gap ? <CoachingLine category={gap.category} count={gap.count} /> : null}
    </div>
  );
}

/**
 * One line, one gap. Naming three gaps at once is a dashboard alert; naming
 * the one that matters is a colleague telling you something useful.
 */
function CoachingLine({ category, count }: { category: WinCategoryValue; count: number }) {
  const label = CATEGORY_META[category].label;
  return (
    <p className={cn(typeStyles.small, 'flex items-start gap-2 text-muted-foreground')}>
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-warning"
        strokeWidth={1.5}
      />
      <span>
        {count === 0 ? (
          <>
            No <code className="font-mono text-foreground">{label}</code> wins this quarter.
          </>
        ) : (
          <>
            Only <span className="num">{count}</span>{' '}
            <code className="font-mono text-foreground">{label}</code> win this quarter.
          </>
        )}{' '}
        Senior reviews usually need 2–3.
      </span>
    </p>
  );
}
