'use client';

import * as React from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { focusRing, typeStyles } from './tokens';

export interface StatTileProps {
  /** The number itself. Pre-formatted; the tile does not do maths. */
  value: string | number;
  label: string;
  /** Change over the period: "+8 this month". */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  /** Six or so points; rendered as a 40x16 sparkline. */
  sparkline?: number[];
  /** Caption beside the sparkline: "6 mo". */
  sparklineLabel?: string;
  /**
   * Explanation of how the number is derived. Every derived stat must be
   * explainable — the same trust rule as the Radar band methodology.
   */
  hint?: string;
  variant?: 'default' | 'wide' | 'verdict';
  /** `verdict` only: filled dots out of five, for competency coverage. */
  dots?: number;
  className?: string;
}

/**
 * `StatTile` — a number, what it means, and why it is that number.
 */
export function StatTile({
  value,
  label,
  delta,
  sparkline,
  sparklineLabel,
  hint,
  variant = 'default',
  dots,
  className,
}: StatTileProps) {
  const wide = variant === 'wide';

  const valueEl = (
    <span className={cn('num font-heading text-2xl font-semibold leading-[30px] text-foreground')}>
      {value}
    </span>
  );

  const labelEl = (
    <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{label}</span>
  );

  return (
    <div
      className={cn(
        'surface-work rounded-lg border border-border bg-card p-4',
        wide && 'flex items-center justify-between gap-4',
        className
      )}
    >
      <div className={cn(wide ? 'flex items-baseline gap-2' : 'flex flex-col')}>
        <div className="flex items-center gap-1.5">
          {valueEl}
          {hint ? <StatHint hint={hint} label={label} /> : null}
        </div>
        {labelEl}
      </div>

      <div className={cn(wide ? 'flex items-center gap-3' : 'mt-2 flex items-center gap-2')}>
        {delta ? (
          <span
            className={cn(
              typeStyles.caption,
              'num',
              delta.direction === 'up'
                ? 'text-success'
                : delta.direction === 'down'
                  ? 'text-danger'
                  : 'text-muted-foreground'
            )}
          >
            {delta.value}
          </span>
        ) : null}

        {sparkline && sparkline.length > 1 ? (
          <span className="inline-flex items-center gap-1.5">
            <Sparkline points={sparkline} />
            {sparklineLabel ? (
              <span className={cn(typeStyles.caption, 'num text-muted-foreground')}>{sparklineLabel}</span>
            ) : null}
          </span>
        ) : null}

        {variant === 'verdict' ? <DotMeter filled={dots ?? 0} label={label} /> : null}
      </div>
    </div>
  );
}

function StatHint({ hint, label }: { hint: string; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`How ${label} is calculated`}
          className={cn(
            'inline-flex size-4 items-center justify-center rounded-full text-muted-foreground',
            'transition-colors duration-[120ms] ease-out hover:text-foreground',
            focusRing
          )}
        >
          <Info aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className={cn(typeStyles.small, 'text-muted-foreground')}>{hint}</p>
      </PopoverContent>
    </Popover>
  );
}

/** 40x16, `--primary` at 50%. Decorative: the number beside it carries the meaning. */
function Sparkline({ points }: { points: number[] }) {
  const width = 40;
  const height = 16;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / span) * (height - 2) - 1;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className="shrink-0"
    >
      <path d={path} stroke="currentColor" className="text-primary/50" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Five dots: filled in `--success`, empty in `--border`. */
function DotMeter({ filled, label }: { filled: number; label: string }) {
  const total = 5;
  const safe = Math.max(0, Math.min(total, Math.round(filled)));
  return (
    <span
      role="img"
      aria-label={`${label}: ${safe} of ${total}`}
      className="inline-flex items-center gap-1"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn('size-1.5 rounded-full', index < safe ? 'bg-success' : 'bg-border')}
        />
      ))}
    </span>
  );
}
