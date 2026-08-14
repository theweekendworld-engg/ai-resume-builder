'use client';

import * as React from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { focusRing, typeStyles } from './tokens';
import type { WinRecord } from './types';
import { WinCard } from './win-card';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  /**
   * Exactly one primary action. The type is singular on purpose: two primary
   * actions means we do not know what the user should do next.
   */
  action?: EmptyStateAction;
  /** A text link, not a second button. */
  secondary?: EmptyStateAction;
  /**
   * Sample Wins rendered behind a "Sample" caption at 45% opacity, so a
   * first-run user sees what they are building toward.
   */
  samples?: WinRecord[];
  className?: string;
}

/**
 * `EmptyState` — signature surface. One of the few places glow is welcome.
 *
 * Copy rules from foundations §10: never apologize, never an exclamation mark,
 * never "Oops". Labels are nouns, the button is a verb.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondary,
  samples,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        // signature surface: glow + a subtle gradient, per §6.
        'relative overflow-hidden rounded-xl border border-border bg-card px-6 py-16',
        'bg-gradient-to-b from-primary/5 to-transparent patronus-glow-sm',
        className
      )}
    >
      <div className="mx-auto flex max-w-[42ch] flex-col items-center text-center">
        <Icon aria-hidden="true" className="size-8 text-muted-foreground" strokeWidth={1.5} />

        <h2 className={cn(typeStyles.h2, 'mt-4 text-foreground')}>{title}</h2>

        <p className={cn(typeStyles.body, 'mt-2 text-muted-foreground')}>{description}</p>

        {action ? (
          <div className="mt-6">
            {action.href ? (
              <Button asChild>
                <a href={action.href}>{action.label}</a>
              </Button>
            ) : (
              <Button type="button" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
          </div>
        ) : null}

        {secondary ? (
          <div className="mt-3">
            {secondary.href ? (
              <a
                href={secondary.href}
                className={cn(typeStyles.small, focusRing, 'rounded-sm text-muted-foreground hover:text-foreground hover:underline')}
              >
                {secondary.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={secondary.onClick}
                className={cn(typeStyles.small, focusRing, 'rounded-sm text-muted-foreground hover:text-foreground hover:underline')}
              >
                {secondary.label}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {samples && samples.length > 0 ? (
        <div className="mx-auto mt-10 max-w-2xl">
          <p className={cn(typeStyles.caption, 'mb-2 text-center uppercase text-muted-foreground')}>Sample</p>
          <div aria-hidden="true" className="space-y-1 opacity-45">
            {samples.slice(0, 3).map((sample) => (
              <WinCard key={sample.id} win={sample} variant="preview" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
