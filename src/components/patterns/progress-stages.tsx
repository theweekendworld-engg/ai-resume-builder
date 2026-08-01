'use client';

import * as React from 'react';
import { Check, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

import { duration, typeStyles } from './tokens';
import { usePrefersReducedMotion } from './use-reduced-motion';

export type ProgressStageStatus = 'done' | 'active' | 'pending' | 'error';

export interface ProgressStage {
  id: string;
  /**
   * The stage label. In product code these come from
   * `getGenerationStageLabel()` in `src/lib/generationProgress.ts` — passed in
   * rather than imported so this component stays free of Prisma enums and
   * usable from any surface.
   */
  label: string;
  status: ProgressStageStatus;
  /** What the stage produced, shown inline: "found 5 themes". */
  result?: string;
}

export interface ProgressStagesProps {
  stages: ProgressStage[];
  /** Optional heading above the list. */
  title?: string;
  className?: string;
}

/**
 * `ProgressStages` — the generation theater.
 *
 * Never a bare spinner. A 60-second wait that shows its work reads as premium;
 * a silent one reads as broken.
 */
export function ProgressStages({ stages, title, className }: ProgressStagesProps) {
  const reduced = usePrefersReducedMotion();
  const activeStage = stages.find((stage) => stage.status === 'active');

  return (
    <div className={cn('surface-work rounded-xl border border-border bg-card p-4', className)}>
      {title ? <h2 className={cn(typeStyles.h2, 'mb-3 text-foreground')}>{title}</h2> : null}

      {/* One polite announcement per stage change, not per repaint. */}
      <div aria-live="polite" className="sr-only">
        {activeStage ? activeStage.label : null}
      </div>

      <ol className="space-y-2">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-start gap-2.5">
            <StageGlyph status={stage.status} reduced={reduced} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  typeStyles.small,
                  stage.status === 'pending' && 'text-muted-foreground',
                  stage.status === 'active' && 'text-foreground',
                  stage.status === 'done' && 'text-foreground',
                  stage.status === 'error' && 'text-danger'
                )}
              >
                <span
                  className={cn(stage.status === 'active' && !reduced && 'animate-pulse')}
                  style={
                    stage.status === 'active' && !reduced
                      ? { animationDuration: `${duration.ambient}ms` }
                      : undefined
                  }
                >
                  {stage.label}
                </span>
              </p>
              {stage.result ? (
                <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>{stage.result}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageGlyph({ status, reduced }: { status: ProgressStageStatus; reduced: boolean }) {
  if (status === 'done') {
    return (
      <span
        role="img"
        aria-label="Done"
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
      >
        <Check aria-hidden="true" className="size-3" strokeWidth={2} />
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        role="img"
        aria-label="Failed"
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger"
      >
        <TriangleAlert aria-hidden="true" className="size-3" strokeWidth={1.5} />
      </span>
    );
  }

  if (status === 'active') {
    return (
      <span
        role="img"
        aria-label="In progress"
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center"
      >
        <span
          className={cn('size-2 rounded-full bg-primary', !reduced && 'animate-pulse')}
          style={!reduced ? { animationDuration: `${duration.ambient}ms` } : undefined}
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label="Pending"
      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center"
    >
      <span className="size-2 rounded-full border border-border" />
    </span>
  );
}
