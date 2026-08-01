'use client';

import * as React from 'react';
import {
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCw,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { CATEGORY_META } from './category-meta';
import { densityPadding, useDensity, type Density } from './density';
import { formatWinDate } from './format';
import { MetricChip } from './metric-chip';
import { SourceChip, SourceChipGroup } from './source-chip';
import {
  duration,
  easing,
  focusRing,
  focusRingOutline,
  focusRingOutlineStatic,
  touchTarget,
  typeStyles,
} from './tokens';
import type { WinRecord } from './types';
import {
  fadeDuration,
  motionDuration,
  usePrefersReducedMotion,
} from './use-reduced-motion';

/* -------------------------------------------------------------------------- */
/* Confirm timeline — foundations §7.2                                         */
/* -------------------------------------------------------------------------- */

export type ConfirmPhase = 'press' | 'flash' | 'fade' | 'collapse' | 'done';

const PHASE_RANK: Record<ConfirmPhase, number> = {
  press: 0,
  flash: 1,
  fade: 2,
  collapse: 3,
  done: 4,
};

/** Full motion: the frame-by-frame schedule from §7.2, in ms. */
const TIMELINE: Array<[number, ConfirmPhase]> = [
  [60, 'flash'],
  [100, 'fade'],
  [180, 'collapse'],
  [360, 'done'],
];

/** Reduced motion (§7.3): flash, then remove. The feedback survives; the movement does not. */
const TIMELINE_REDUCED: Array<[number, ConfirmPhase]> = [
  [0, 'flash'],
  [100, 'collapse'],
  [120, 'done'],
];

function useConfirmTimeline(
  active: boolean,
  controlled: ConfirmPhase | undefined,
  reduced: boolean,
  onEnd?: () => void
): ConfirmPhase {
  const [phase, setPhase] = React.useState<ConfirmPhase>('press');
  const onEndRef = React.useRef(onEnd);

  // Kept in a ref so a new callback identity does not restart the timeline
  // mid-collapse. Declared before the timeline effect so it is current first.
  React.useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  React.useEffect(() => {
    if (!active || controlled) return;
    setPhase('press');
    const schedule = reduced ? TIMELINE_REDUCED : TIMELINE;
    const timers = schedule.map(([ms, next]) =>
      setTimeout(() => {
        setPhase(next);
        if (next === 'done') onEndRef.current?.();
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [active, controlled, reduced]);

  if (controlled) return controlled;
  return active ? phase : 'press';
}

/**
 * The checkmark whose fill sweeps left to right over 140ms. A plain glyph
 * swap reads as a repaint; the sweep reads as an action completing.
 */
function SweepCheck({ swept, reduced }: { swept: boolean; reduced: boolean }) {
  const length = 24;
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none">
      <path
        d="M3 8.5 L6.5 12 L13 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={swept ? 0 : length}
        style={{
          transition: `stroke-dashoffset ${motionDuration(140, reduced)}ms ${easing.state}`,
        }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* WinCard                                                                     */
/* -------------------------------------------------------------------------- */

export type WinCardVariant = 'list' | 'review' | 'compact' | 'preview';

export type WinCardState =
  | 'default'
  | 'draft'
  | 'confirming'
  | 'confirmed'
  | 'dismissed'
  | 'editing'
  | 'skeleton'
  | 'error';

export type WinCardMenuAction =
  | 'edit'
  | 'change-date'
  | 'change-sensitivity'
  | 'duplicate'
  | 'delete';

export interface WinCardProps {
  win: WinRecord;
  variant?: WinCardVariant;
  state?: WinCardState;
  density?: Density;

  /** Opens the drawer. The whole card is the target; action buttons stop propagation. */
  onOpen?: () => void;
  onConfirm?: () => void;
  onDismiss?: () => void;
  /** Enter edit mode. The card handles the input; this fires on save. */
  onEditSave?: (nextTitle: string) => void;
  onEditCancel?: () => void;
  onUndo?: () => void;
  onRetry?: () => void;
  onMenuAction?: (action: WinCardMenuAction) => void;

  /** Fires at the end of the confirm collapse (t=360, or t=120 reduced). */
  onConfirmEnd?: () => void;
  /** Freeze the confirm animation on one frame. Static previews and tests only. */
  confirmPhase?: ConfirmPhase;

  /** Message shown in the `error` state. */
  errorMessage?: string;
  /** Row is disabled during a bulk action; shows a spinner instead of actions. */
  busy?: boolean;

  /**
   * The card owns DOM focus. Set `false` inside `ReviewQueue`, where the
   * listbox container holds focus and rows are addressed by
   * `aria-activedescendant`.
   */
  focusable?: boolean;
  /**
   * Visual treatment for the active row of a listbox. Purely presentational:
   * `role="option"` and `aria-selected` belong on the element the listbox
   * owns, which is `ReviewQueue`'s wrapper, not this card.
   */
  active?: boolean;
  /**
   * Whether the row's action buttons are in the tab order. `false` inside a
   * virtual-focus listbox, where Tab must not walk into every row.
   */
  actionsFocusable?: boolean;

  /**
   * Forces the hover or focus treatment for static rendering. Used by
   * `/dev/patterns` to show interaction states in a gallery; not for product code.
   */
  forceVisualState?: 'hover' | 'focused';

  id?: string;
  className?: string;
}

export function WinCard({
  win,
  variant = 'list',
  state = 'default',
  density: densityProp,
  onOpen,
  onConfirm,
  onDismiss,
  onEditSave,
  onEditCancel,
  onUndo,
  onRetry,
  onMenuAction,
  onConfirmEnd,
  confirmPhase,
  errorMessage = "That didn't save.",
  busy = false,
  focusable = true,
  active = false,
  actionsFocusable = true,
  forceVisualState,
  id,
  className,
}: WinCardProps) {
  const density = useDensity(densityProp);
  const reduced = usePrefersReducedMotion();
  const reactId = React.useId();
  const titleId = `${id ?? reactId}-title`;

  const confirming = state === 'confirming';
  const phase = useConfirmTimeline(confirming, confirmPhase, reduced, onConfirmEnd);
  const rank = PHASE_RANK[phase];

  /* --- confirmed: 8s tint, then normal ---------------------------------- */
  const [justConfirmed, setJustConfirmed] = React.useState(state === 'confirmed');
  React.useEffect(() => {
    if (state !== 'confirmed') {
      setJustConfirmed(false);
      return;
    }
    setJustConfirmed(true);
    const timer = setTimeout(() => setJustConfirmed(false), 8000);
    return () => clearTimeout(timer);
  }, [state]);

  /* --- confirm button press: scale 1 -> 0.92 -> 1 over 90ms ------------- */
  const [pressed, setPressed] = React.useState(false);
  React.useEffect(() => {
    if (!confirming || reduced) return;
    setPressed(true);
    const timer = setTimeout(() => setPressed(false), 45);
    return () => clearTimeout(timer);
  }, [confirming, reduced]);

  /* --- inline edit ------------------------------------------------------ */
  const [draftTitle, setDraftTitle] = React.useState(win.title);
  React.useEffect(() => {
    if (state === 'editing') setDraftTitle(win.title);
  }, [state, win.title]);

  if (state === 'skeleton') {
    return <WinCardSkeleton density={density} className={className} />;
  }

  const isPreview = variant === 'preview';
  const isCompact = variant === 'compact';
  const isReview = variant === 'review';
  const interactive = !isPreview && typeof onOpen === 'function';
  const dismissed = state === 'dismissed';
  const editing = state === 'editing';
  const errored = state === 'error';

  const dot = groundDot(win);
  const dateLabel = formatWinDate(win.occurredAt);
  const category = CATEGORY_META[win.category];
  const CategoryIcon = category.icon;
  const confidential = win.sensitivity === 'confidential';
  const locked = win.sensitivity === 'internal_only' || confidential;

  /**
   * Left rule precedence: error, then draft, then confidential. Only one 2px
   * rule can occupy the edge, and an error is the thing the user must act on.
   */
  const leftRule = errored
    ? 'border-l-2 border-danger'
    : state === 'draft'
      ? 'border-l-2 border-info'
      : confidential
        ? 'border-l-2 border-warning'
        : null;

  const actionsVisible =
    isReview || forceVisualState === 'hover' || forceVisualState === 'focused' || active;

  const rowStyle: React.CSSProperties = {
    gridTemplateRows: rank >= PHASE_RANK.collapse ? '0fr' : '1fr',
    transition: `grid-template-rows ${motionDuration(duration.state, reduced)}ms ${easing.state}`,
  };

  const surfaceStyle: React.CSSProperties = {
    opacity: rank >= PHASE_RANK.fade ? 0.6 : dismissed ? 0.6 : 1,
    transition: `opacity ${fadeDuration(duration.state, reduced)}ms ${easing.state}, background-color ${fadeDuration(120, reduced)}ms ${easing.state}`,
  };

  /* --- compact ---------------------------------------------------------- */
  if (isCompact) {
    return (
      <article
        id={id}
        aria-labelledby={titleId}
        className={cn(
          'surface-work flex h-10 items-center gap-3 rounded-lg border border-border bg-card px-3',
          leftRule,
          interactive && 'cursor-pointer transition-colors duration-[120ms] ease-out hover:bg-secondary/40',
          forceVisualState === 'hover' && 'bg-secondary/40',
          forceVisualState === 'focused' && focusRingOutlineStatic,
          interactive && focusable && focusRingOutline,
          className
        )}
        tabIndex={interactive && focusable ? 0 : undefined}
        onClick={interactive ? onOpen : undefined}
        onKeyDown={
          interactive && focusable
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen?.();
                }
              }
            : undefined
        }
      >
        <span
          role="img"
          aria-label={dot.label}
          className={cn('size-1.5 shrink-0 rounded-full', dot.className)}
        />
        <h3 id={titleId} className={cn(typeStyles.h3, 'min-w-0 flex-1 truncate text-foreground')}>
          {win.title}
        </h3>
        <span className={cn(typeStyles.caption, 'num shrink-0 text-muted-foreground')}>{dateLabel}</span>
      </article>
    );
  }

  /* --- list / review / preview ------------------------------------------ */
  const metaRow = (
    <div className="flex items-center gap-2">
      <span
        role="img"
        aria-label={dot.label}
        className={cn('size-1.5 shrink-0 rounded-full', dot.className)}
      />

      {state === 'draft' ? (
        <span className={cn(typeStyles.caption, 'text-info')}>Draft</span>
      ) : null}

      <span className={cn(typeStyles.caption, 'num shrink-0 text-muted-foreground')}>{dateLabel}</span>

      <span aria-hidden="true" className="text-muted-foreground/50">
        ·
      </span>

      <span className={cn(typeStyles.caption, 'inline-flex shrink-0 items-center gap-1 text-muted-foreground')}>
        <CategoryIcon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
        {category.label}
      </span>

      {win.employer ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <span className={cn(typeStyles.caption, 'max-w-[18ch] truncate text-muted-foreground')}>
            {win.employer}
          </span>
        </>
      ) : null}

      <span className="flex-1" />

      {locked ? (
        <Lock
          aria-label={confidential ? 'Confidential' : 'Internal only'}
          role="img"
          className={cn('size-3.5 shrink-0', confidential ? 'text-warning' : 'text-muted-foreground')}
          strokeWidth={1.5}
          fill={confidential ? 'currentColor' : 'none'}
        />
      ) : null}

      {!isPreview && !isReview && !dismissed && onMenuAction ? (
        <div
          className={cn(
            'transition-opacity duration-[120ms] ease-out',
            actionsVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          )}
        >
          <WinCardMenu onAction={onMenuAction} />
        </div>
      ) : null}
    </div>
  );

  const titleBlock = editing ? (
    <div className="space-y-2">
      {/* Autofocus is correct here: `e` opens the editor and the user is already typing. */}
      <Textarea
        autoFocus
        value={draftTitle}
        aria-label="Win title"
        rows={2}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraftTitle(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onEditSave?.(draftTitle.trim());
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onEditCancel?.();
          }
        }}
        className={cn(typeStyles.h3, 'resize-none')}
      />
      <div className={cn(typeStyles.caption, 'flex items-center gap-3 text-muted-foreground')}>
        <button
          type="button"
          className={cn(focusRing, 'rounded-sm text-foreground hover:underline')}
          onClick={(event) => {
            event.stopPropagation();
            onEditSave?.(draftTitle.trim());
          }}
        >
          Save
        </button>
        <span>&#8984;&#9166; saves &middot; Esc cancels</span>
      </div>
    </div>
  ) : (
    <h3
      id={titleId}
      className={cn(
        typeStyles.h3,
        'line-clamp-2 text-foreground',
        dismissed && 'line-through'
      )}
    >
      {win.title}
    </h3>
  );

  const evidenceRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      {win.sources && win.sources.length > 0 ? (
        <SourceChipGroup sources={win.sources} static={isPreview} />
      ) : null}
      {win.metric ? <MetricChip metric={win.metric} /> : null}
      {win.skills && win.skills.length > 0 ? <SkillTags skills={win.skills} /> : null}
    </div>
  );

  const originRow =
    isReview && win.sources && win.sources.length > 0 ? (
      <div className={cn(typeStyles.caption, 'flex items-center gap-1.5 text-muted-foreground')}>
        <span>From:</span>
        <SourceChip source={win.sources[0]} />
        {win.sources[0].detail ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span className="truncate">{win.sources[0].detail}</span>
          </>
        ) : null}
      </div>
    ) : null;

  const actionGroup = dismissed ? (
    <div className="flex shrink-0 items-start">
      <button
        type="button"
        tabIndex={actionsFocusable ? undefined : -1}
        onClick={(event) => {
          event.stopPropagation();
          onUndo?.();
        }}
        className={cn(
          typeStyles.caption,
          focusRing,
          touchTarget,
          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-foreground hover:bg-secondary/60'
        )}
      >
        <Undo2 aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
        Undo
      </button>
    </div>
  ) : isReview && !isPreview ? (
    <div
      className={cn(
        'flex shrink-0 items-start gap-1 transition-opacity duration-[120ms] ease-out',
        actionsVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      )}
    >
      {busy ? (
        <span className="flex size-8 items-center justify-center">
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground"
          />
          <span className="sr-only">Working</span>
        </span>
      ) : (
        <>
          <IconAction
            label={`Confirm win: ${win.title}`}
            onClick={onConfirm}
            focusable={actionsFocusable}
            className="hover:bg-success/10 hover:text-success"
            style={{
              transform: pressed ? 'scale(0.92)' : 'scale(1)',
              transition: `transform ${motionDuration(45, reduced)}ms ${easing.state}`,
            }}
          >
            <SweepCheck swept={!confirming || rank >= PHASE_RANK.flash} reduced={reduced} />
          </IconAction>
          <IconAction
            label={`Edit win: ${win.title}`}
            onClick={() => onMenuAction?.('edit')}
            focusable={actionsFocusable}
          >
            <Pencil className="size-4" strokeWidth={1.5} />
          </IconAction>
          <IconAction
            label={`Dismiss win: ${win.title}`}
            onClick={onDismiss}
            focusable={actionsFocusable}
            className="hover:bg-danger/10 hover:text-danger"
          >
            <X className="size-4" strokeWidth={1.5} />
          </IconAction>
        </>
      )}
    </div>
  ) : null;

  const body = (
    <div className={cn('flex min-w-0 items-start gap-3')}>
      <div className="min-w-0 flex-1 space-y-1">
        {metaRow}
        {titleBlock}
        {originRow}
        {evidenceRow}
        {errored ? (
          <div className={cn(typeStyles.small, 'flex items-center gap-2 pt-1 text-danger')}>
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="text-foreground">{errorMessage}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRetry?.();
              }}
              className={cn(focusRing, 'inline-flex items-center gap-1 rounded-sm text-danger hover:underline')}
            >
              <RotateCw aria-hidden="true" className="size-3" strokeWidth={1.5} />
              Retry
            </button>
          </div>
        ) : null}
      </div>
      {actionGroup}
    </div>
  );

  return (
    <div style={rowStyle} className="grid">
      <div className="min-h-0 overflow-hidden">
        <article
          id={id}
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          tabIndex={interactive && focusable ? 0 : undefined}
          onClick={interactive ? onOpen : undefined}
          onKeyDown={
            interactive && focusable
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen?.();
                  }
                }
              : undefined
          }
          style={surfaceStyle}
          className={cn(
            // Work surface: flat, 1px border, no blur, no glow (§1 problem 2).
            'surface-work group relative rounded-xl border border-border bg-card',
            densityPadding[density],
            leftRule,
            interactive && 'cursor-pointer',
            interactive && !isPreview && 'hover:bg-secondary/40',
            // Outline, not ring: `.surface-work` zeroes box-shadow. See tokens.ts.
            interactive && focusable && focusRingOutline,
            forceVisualState === 'hover' && 'bg-secondary/40',
            forceVisualState === 'focused' && focusRingOutlineStatic,
            active && cn('bg-secondary/40', focusRingOutlineStatic),
            rank === PHASE_RANK.flash && 'bg-success/8',
            justConfirmed && 'bg-success/6',
            busy && 'pointer-events-none',
            isPreview && 'pointer-events-none select-none',
            className
          )}
        >
          {body}
        </article>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function groundDot(win: WinRecord): { className: string; label: string } {
  switch (win.ground) {
    case 'grounded':
      return { className: 'bg-success', label: 'Grounded' };
    case 'needs_confirmation':
      return { className: 'bg-warning', label: 'Needs confirmation' };
    case 'unsupported':
      return { className: 'bg-muted-foreground', label: 'Unsupported' };
    default:
      return {
        className: 'bg-muted-foreground',
        label: win.metric ? 'Not yet grounded' : 'Unquantified',
      };
  }
}

function SkillTags({ skills, max = 3 }: { skills: string[]; max?: number }) {
  const shown = skills.slice(0, max);
  const rest = skills.length - shown.length;
  return (
    <span className={cn(typeStyles.small, 'inline-flex flex-wrap items-center gap-1.5 text-muted-foreground')}>
      {shown.map((skill) => (
        <span key={skill}>#{skill}</span>
      ))}
      {rest > 0 ? <span className="num">+{rest}</span> : null}
    </span>
  );
}

interface IconActionProps {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  focusable?: boolean;
}

/** A 32px control carrying a 44x44 hit area, per the touch rule in §1. */
function IconAction({ label, onClick, children, className, style, focusable = true }: IconActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={style}
      tabIndex={focusable ? undefined : -1}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground',
        'transition-colors duration-[120ms] ease-out hover:bg-secondary hover:text-foreground',
        touchTarget,
        focusRing,
        className
      )}
    >
      {children}
    </button>
  );
}

function WinCardMenu({ onAction }: { onAction: (action: WinCardMenuAction) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Win options"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground',
            'transition-colors duration-[120ms] ease-out hover:bg-secondary hover:text-foreground',
            touchTarget,
            focusRing
          )}
        >
          <MoreHorizontal className="size-4" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onAction('edit')}>Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction('change-date')}>Change date</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction('change-sensitivity')}>
          Change sensitivity
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction('duplicate')}>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction('delete')} className="text-danger">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WinCardSkeleton({ density, className }: { density: Density; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'surface-work rounded-xl border border-border bg-card',
        densityPadding[density],
        className
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-3 w-[40%]" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-3 w-[60%]" />
      </div>
    </div>
  );
}

/** Exported for the gallery and for tests that need a bare skeleton row. */
export { WinCardSkeleton };
