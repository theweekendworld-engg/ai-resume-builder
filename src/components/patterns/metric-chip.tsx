'use client';

import * as React from 'react';
import { Zap } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { typeStyles } from './tokens';
import type { ImpactMetricValue } from './types';

export interface MetricChipProps {
  metric: ImpactMetricValue;
  className?: string;
}

/**
 * `MetricChip` — the quantified outcome, when there is one.
 *
 * Rendered only when an `ImpactMetric` exists. Its *absence* is meaningful:
 * it is the visual cue that drives the "quantify this" prompt, so never
 * substitute a placeholder or a dash.
 */
export function MetricChip({ metric, className }: MetricChipProps) {
  const chip = (
    <span
      className={cn(
        'num inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-info/20 bg-info/10 px-2 text-info',
        typeStyles.caption,
        className
      )}
    >
      <Zap aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.5} />
      <span>{metric.value}</span>
    </span>
  );

  if (!metric.detail) return chip;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-full">
            {chip}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className={cn(typeStyles.small, 'num')}>{metric.detail}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
