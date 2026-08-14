'use client';

import * as React from 'react';
import { Flame } from 'lucide-react';

import { cn } from '@/lib/utils';

import { typeStyles } from './tokens';

export interface StreakBadgeProps {
  /** Consecutive weeks with at least one logged Win. */
  weeks: number;
  className?: string;
}

/**
 * `StreakBadge` — shown only at two weeks or more.
 *
 * It **never resets visibly to zero**. A broken streak simply stops rendering:
 * this component returns `null` below the threshold. Punishing a missed week
 * is how you lose the user who missed a week.
 */
export function StreakBadge({ weeks, className }: StreakBadgeProps) {
  if (!Number.isFinite(weeks) || weeks < 2) return null;

  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-secondary px-2 text-secondary-foreground',
        typeStyles.caption,
        className
      )}
    >
      <Flame aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.5} />
      <span className="num">{weeks}</span>
      <span>{weeks === 1 ? 'week' : 'weeks'}</span>
    </span>
  );
}
