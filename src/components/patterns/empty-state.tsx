'use client';

import * as React from 'react';
import Link from 'next/link';
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
  /**
   * `inline` sits inside a list container in place of its rows (smaller
   * padding, no box of its own). `page` (default) is the whole view.
   */
  size?: 'page' | 'inline';
  className?: string;
}

/**
 * `EmptyState` — what this place is, and the one thing to do next.
 *
 * Dossier (docs/design/03-dossier.md §5): a ruled box on the page, not a
 * glowing card floating in space. The icon sits in a small square like a
 * file tab, the title is the serif, the description says what will appear
 * here once there is something, and there is exactly one primary button.
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
  size = 'page',
  className,
}: EmptyStateProps) {
  const inline = size === 'inline';
  return (
    <div
      className={cn(
        'relative',
        inline ? 'px-6 py-10' : 'rounded-lg border border-border bg-card px-6 py-14',
        className
      )}
    >
      <div className="mx-auto flex max-w-[44ch] flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-md border border-border bg-background text-muted-foreground"
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>

        <h2 className={cn(typeStyles.h2, 'mt-4 text-foreground')}>{title}</h2>

        <p className={cn(typeStyles.body, 'mt-1.5 text-muted-foreground')}>{description}</p>

        {action ? (
          <div className="mt-5">
            {action.href ? (
              <Button asChild>
                <Link href={action.href}>{action.label}</Link>
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
              <Link
                href={secondary.href}
                className={cn(typeStyles.small, focusRing, 'rounded-sm text-muted-foreground underline decoration-border-strong/60 underline-offset-4 hover:text-foreground hover:decoration-foreground')}
              >
                {secondary.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={secondary.onClick}
                className={cn(typeStyles.small, focusRing, 'rounded-sm text-muted-foreground underline decoration-border-strong/60 underline-offset-4 hover:text-foreground hover:decoration-foreground')}
              >
                {secondary.label}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {samples && samples.length > 0 ? (
        <div className="mx-auto mt-10 max-w-2xl">
          <p className={cn(typeStyles.eyebrow, 'mb-2 text-center')}>Sample</p>
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
