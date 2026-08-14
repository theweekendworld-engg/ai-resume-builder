'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, XCircle, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { duration, easing, focusRing, typeStyles } from './tokens';
import type { GroundStateValue } from './types';
import { motionDuration, usePrefersReducedMotion } from './use-reduced-motion';

interface GroundMeta {
  icon: LucideIcon;
  label: string;
  /** Semantic status colours — §3.2. The only place colour carries meaning. */
  chip: string;
  fg: string;
}

const GROUND_META: Record<GroundStateValue, GroundMeta> = {
  grounded: {
    icon: CheckCircle2,
    label: 'Grounded',
    chip: 'bg-success/10 text-success border-success/20',
    fg: 'text-success',
  },
  needs_confirmation: {
    icon: AlertCircle,
    label: 'Confirm',
    chip: 'bg-warning/10 text-warning border-warning/20',
    fg: 'text-warning',
  },
  unsupported: {
    icon: XCircle,
    label: 'Unsupported',
    chip: 'bg-danger/10 text-danger border-danger/20',
    fg: 'text-danger',
  },
};

export interface GroundChipProps {
  state: GroundStateValue;
  /** `sm` is icon-only at 16px, for inline use inside a packet sentence. */
  size?: 'sm' | 'default';
  /** The sentence or number being grounded. Shown in the confirm popover. */
  claim?: string;
  /** For `grounded`: what backs it. "PR #482". */
  backedBy?: string;
  /** For `grounded`: the stored excerpt, shown in the tooltip. */
  excerpt?: string;
  /**
   * Confirm handler. Its presence is what makes a `needs_confirmation` chip a
   * producer rather than a status light: clicking opens the evidence-capture
   * popover, and resolving flips the chip to `grounded`.
   */
  onConfirm?: (source: string) => void | Promise<void>;
  className?: string;
}

/**
 * `GroundChip` — the truthfulness brand, rendered.
 *
 * Never colour-only (§9.3): every state carries icon + text + colour, and the
 * `sm` size keeps the text for screen readers.
 */
export function GroundChip({
  state,
  size = 'default',
  claim,
  backedBy,
  excerpt,
  onConfirm,
  className,
}: GroundChipProps) {
  const reduced = usePrefersReducedMotion();
  /** Optimistic local state so the chip can flip itself after a confirm. */
  const [resolved, setResolved] = React.useState<GroundStateValue | null>(null);
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [sourceText, setSourceText] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [justResolved, setJustResolved] = React.useState(false);

  React.useEffect(() => {
    setResolved(null);
  }, [state]);

  const current = resolved ?? state;
  const meta = GROUND_META[current];
  const Icon = pending ? Loader2 : meta.icon;
  const canProduce = current === 'needs_confirmation' && typeof onConfirm === 'function';

  const chipClass = cn(
    'inline-flex shrink-0 items-center rounded-full border',
    meta.chip,
    size === 'sm' ? 'size-4 justify-center' : 'h-5 gap-1 px-2',
    typeStyles.caption,
    className
  );

  const iconStyle: React.CSSProperties = {
    transition: `transform ${motionDuration(90, reduced)}ms ${easing.state}`,
    transform: justResolved ? 'scale(1)' : undefined,
  };

  const body = (
    <>
      <Icon
        aria-hidden="true"
        className={cn('size-3 shrink-0', pending && 'animate-spin')}
        strokeWidth={1.5}
        style={iconStyle}
      />
      {size === 'sm' ? (
        <span className="sr-only">{meta.label}</span>
      ) : (
        <span>{meta.label}</span>
      )}
    </>
  );

  const transitionStyle: React.CSSProperties = {
    transition: `background-color ${duration.state}ms ${easing.state}, color ${duration.state}ms ${easing.state}, border-color ${duration.state}ms ${easing.state}`,
  };

  async function handleConfirm() {
    if (!onConfirm) return;
    setPending(true);
    try {
      await onConfirm(sourceText.trim());
      setResolved('grounded');
      setJustResolved(true);
      setPopoverOpen(false);
      setSourceText('');
    } finally {
      setPending(false);
    }
  }

  // The producer path: PRD 01 §7.1 one-click evidence capture.
  if (canProduce) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            style={transitionStyle}
            className={cn(chipClass, focusRing, 'hover:bg-warning/20')}
            aria-label={`Confirm this claim${claim ? `: ${claim}` : ''}`}
          >
            {body}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-80 space-y-3 p-3">
          <div className="space-y-1">
            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
              We couldn&apos;t tie this to a source. Confirm to add it to your record.
            </p>
            {claim ? (
              <p className={cn(typeStyles.small, 'text-foreground')}>&ldquo;{claim}&rdquo;</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="ground-chip-source"
              className={cn(typeStyles.caption, 'block text-muted-foreground')}
            >
              Where does this come from?
            </label>
            <Input
              id="ground-chip-source"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleConfirm();
                }
              }}
              placeholder="PR link, dashboard, or a note to yourself"
              className="h-9"
            />
          </div>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => void handleConfirm()}
            className="w-full"
          >
            {pending ? 'Confirming' : 'Confirm'}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  const tooltipText =
    current === 'grounded'
      ? backedBy
        ? `Backed by: ${backedBy}`
        : 'Backed by a source in your record'
      : current === 'unsupported'
        ? "This number isn't in your record and won't be printed."
        : "We couldn't tie this to a source. Confirm to add it to your record.";

  return (
    // Self-contained provider: an atom used across six surfaces cannot assume
    // one of its ancestors happens to have wrapped it.
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span style={transitionStyle} className={chipClass} tabIndex={0}>
            {body}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          <p className={typeStyles.small}>{tooltipText}</p>
          {excerpt ? (
            <p className={cn(typeStyles.mono, 'text-muted-foreground')}>{excerpt}</p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
