'use client';

import * as React from 'react';
import {
  BadgeCheck,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link as LinkIcon,
  MessageSquareQuote,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { focusRing, typeStyles } from './tokens';
import type { EvidenceKindValue, SourceRef } from './types';

/** §4 of `01-components.md` — one icon per `EvidenceKind`. */
const KIND_ICON: Record<EvidenceKindValue, LucideIcon> = {
  repo: GitPullRequest,
  document: FileText,
  url: LinkIcon,
  interview_assertion: MessageSquareQuote,
  metric_confirmed: BadgeCheck,
  import: Upload,
};

const KIND_LABEL: Record<EvidenceKindValue, string> = {
  repo: 'Repository',
  document: 'Document',
  url: 'Link',
  interview_assertion: 'Something you said',
  // Kept in step with the same map in `winGraph.ts` and `adapt.ts`. The kind
  // means the user confirmed an assertion, not that a metric exists — three
  // copies of this string is itself the smell; one owner would be better.
  metric_confirmed: 'You confirmed this',
  import: 'Import',
};

const EXCERPT_MAX = 240;

function truncate(text: string, max = EXCERPT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Hover-to-open with a close delay, so the pointer can travel from the chip
 * into the popover without it snapping shut. Also opens on keyboard focus.
 */
function useHoverOpen(closeDelay = 140) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  React.useEffect(() => clear, [clear]);

  return {
    open,
    setOpen,
    hoverProps: {
      onPointerEnter: () => {
        clear();
        setOpen(true);
      },
      onPointerLeave: () => {
        clear();
        timer.current = setTimeout(() => setOpen(false), closeDelay);
      },
      onFocus: () => {
        clear();
        setOpen(true);
      },
      onBlur: () => setOpen(false),
    },
  };
}

function SourceIcon({ source }: { source: SourceRef }) {
  const Icon = KIND_ICON[source.kind];
  if (!source.dead) {
    return <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.5} />;
  }
  return (
    <span aria-hidden="true" className="relative inline-flex size-3 shrink-0 items-center justify-center">
      <Icon className="size-3" strokeWidth={1.5} />
      {/* The struck-through glyph is the dead-source signal (§4). */}
      <span className="absolute h-px w-4 rotate-45 bg-current" />
    </span>
  );
}

export interface SourceChipProps {
  source: SourceRef;
  /** Suppress the hover popover — for the non-interactive `preview` surface. */
  static?: boolean;
  className?: string;
}

/**
 * `SourceChip` — provenance, everywhere a claim appears.
 *
 * Principle 4: every AI-generated string carries a visible path back to its
 * source. This chip is that path.
 */
export function SourceChip({ source, static: isStatic = false, className }: SourceChipProps) {
  const { open, setOpen, hoverProps } = useHoverOpen();
  const Icon = KIND_ICON[source.kind];
  const hasDetail = Boolean(source.excerpt || source.url || source.dead || source.detail);

  const chipClass = cn(
    'inline-flex h-5 max-w-[22ch] items-center gap-1 rounded-md border px-1.5',
    typeStyles.caption,
    source.dead
      ? 'border-border/60 bg-secondary/50 text-muted-foreground'
      : 'border-border bg-secondary text-secondary-foreground',
    className
  );

  const label = (
    <span className={cn('truncate', source.dead && 'line-through')}>{source.label}</span>
  );

  const srPrefix = <span className="sr-only">{KIND_LABEL[source.kind]}: </span>;

  if (isStatic || !hasDetail) {
    return (
      <span className={chipClass}>
        {source.dead ? <SourceIcon source={source} /> : <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.5} />}
        {srPrefix}
        {label}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chipClass, focusRing, 'transition-colors duration-[120ms] ease-out hover:border-border hover:bg-secondary/80')} {...hoverProps}>
          <SourceIcon source={source} />
          {srPrefix}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        {...hoverProps}
      >
        <SourceDetail source={source} />
      </PopoverContent>
    </Popover>
  );
}

function SourceDetail({ source }: { source: SourceRef }) {
  const Icon = KIND_ICON[source.kind];
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className={cn(typeStyles.small, 'font-medium text-foreground')}>{source.label}</p>
          {source.detail ? (
            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>{source.detail}</p>
          ) : null}
        </div>
      </div>

      {source.excerpt ? (
        <p className={cn(typeStyles.mono, 'rounded-sm bg-secondary/60 p-2 text-muted-foreground')}>
          {truncate(source.excerpt)}
        </p>
      ) : null}

      {source.dead ? (
        <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
          Source no longer available &mdash; the excerpt is preserved.
        </p>
      ) : source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className={cn(typeStyles.caption, focusRing, 'inline-flex items-center gap-1 rounded-sm text-primary hover:underline')}
        >
          Open source
          <ExternalLink aria-hidden="true" className="size-3" strokeWidth={1.5} />
        </a>
      ) : null}
    </div>
  );
}

export interface SourceChipGroupProps {
  sources: SourceRef[];
  /** Max chips rendered inline before the rest collapse to `+n`. */
  max?: number;
  static?: boolean;
  className?: string;
}

/**
 * Max 2 inline; further sources collapse to `+n`, expanding into a popover.
 * An unbounded row of provenance chips buries the Win title it belongs to.
 */
export function SourceChipGroup({ sources, max = 2, static: isStatic = false, className }: SourceChipGroupProps) {
  const { open, setOpen, hoverProps } = useHoverOpen();
  if (sources.length === 0) return null;

  const inline = sources.slice(0, max);
  const overflow = sources.slice(max);

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {inline.map((source) => (
        <SourceChip key={source.id} source={source} static={isStatic} />
      ))}

      {overflow.length > 0 ? (
        isStatic ? (
          <span className={cn('inline-flex h-5 items-center rounded-md border border-border bg-secondary px-1.5 text-muted-foreground', typeStyles.caption, 'num')}>
            +{overflow.length}
          </span>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Show ${overflow.length} more source${overflow.length === 1 ? '' : 's'}`}
                className={cn(
                  'num inline-flex h-5 items-center rounded-md border border-border bg-secondary px-1.5 text-muted-foreground',
                  typeStyles.caption,
                  focusRing,
                  'transition-colors duration-[120ms] ease-out hover:text-foreground'
                )}
                {...hoverProps}
              >
                +{overflow.length}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={6}
              className="w-80 space-y-3 p-3"
              onOpenAutoFocus={(event) => event.preventDefault()}
              {...hoverProps}
            >
              {overflow.map((source) => (
                <SourceDetail key={source.id} source={source} />
              ))}
            </PopoverContent>
          </Popover>
        )
      ) : null}
    </span>
  );
}
