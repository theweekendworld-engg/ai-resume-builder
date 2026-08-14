'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { CATEGORY_META } from './category-meta';
import { focusRing, typeStyles } from './tokens';
import type { WinCategoryValue } from './types';

export interface CategoryChipProps {
  category: WinCategoryValue;
  /**
   * `chip` — the filter/pill form: `h-5 px-2`, `bg-secondary`, `rounded-full`.
   * `inline` — bare icon + label for a card meta row, `--muted-foreground`.
   */
  appearance?: 'chip' | 'inline';
  /** Icon only. The label stays available to screen readers. */
  iconOnly?: boolean;
  /** Present it as a filter toggle. Requires `onClick`. */
  onClick?: () => void;
  /** Filter toggles render their on-state. */
  active?: boolean;
  className?: string;
}

/**
 * `CategoryChip` — one of eight Win categories, as an icon plus a label.
 * Clickable variant filters the log.
 */
export function CategoryChip({
  category,
  appearance = 'chip',
  iconOnly = false,
  onClick,
  active = false,
  className,
}: CategoryChipProps) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const interactive = typeof onClick === 'function';

  const content = (
    <>
      <Icon
        aria-hidden="true"
        className={appearance === 'inline' ? 'size-3.5 shrink-0' : 'size-3 shrink-0'}
        strokeWidth={1.5}
      />
      {iconOnly ? (
        <span className="sr-only">{meta.label}</span>
      ) : (
        <span className="truncate">{meta.label}</span>
      )}
    </>
  );

  const shared = cn(
    'inline-flex items-center gap-1',
    typeStyles.caption,
    appearance === 'chip'
      ? cn(
          'h-5 rounded-full border border-transparent px-2',
          active
            ? 'bg-secondary text-secondary-foreground border-border'
            : 'bg-secondary text-muted-foreground'
        )
      : 'text-muted-foreground',
    className
  );

  if (!interactive) {
    return <span className={shared}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        shared,
        focusRing,
        'transition-colors duration-[120ms] ease-out hover:text-foreground',
        appearance === 'chip' && 'hover:border-border'
      )}
    >
      {content}
    </button>
  );
}
