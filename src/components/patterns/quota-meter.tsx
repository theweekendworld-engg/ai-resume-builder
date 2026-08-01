'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatWinDate } from './format';
import { typeStyles } from './tokens';

export interface QuotaMeterProps {
  used: number;
  limit: number;
  /** When the period rolls over. */
  resetsOn?: Date | string;
  /** What is being counted: "tailored resumes", "packets". */
  unit?: string;
  className?: string;
}

/**
 * `QuotaMeter` — a thin bar and a sentence.
 *
 * Always visible on `/settings/plan`: nobody should discover a limit by
 * hitting it. Turns `--warning` at 80% and `--danger` at 100%.
 */
export function QuotaMeter({ used, limit, resetsOn, unit, className }: QuotaMeterProps) {
  const safeLimit = Math.max(1, limit);
  const ratio = used / safeLimit;
  const percent = Math.min(100, Math.max(0, ratio * 100));

  const tone = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'neutral';
  const barClass =
    tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-primary';
  const textClass =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground';

  const sentence = `${used} of ${limit}${unit ? ` ${unit}` : ''} this period`;
  const reset = resetsOn ? `resets ${formatWinDate(resetsOn)}` : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${sentence}${reset ? `, ${reset}` : ''}`}
        className="h-1 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-[180ms]', barClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className={cn(typeStyles.caption, textClass)}>
        <span className="num">{sentence}</span>
        {reset ? (
          <>
            <span aria-hidden="true" className="mx-1 text-muted-foreground/50">
              ·
            </span>
            <span className="num text-muted-foreground">{reset}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
