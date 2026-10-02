'use client';

import * as React from 'react';
import { Keyboard, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { CATEGORY_META } from './category-meta';
import { DensityProvider, type Density } from './density';
import { duration, easing, focusRing, typeStyles } from './tokens';
import { WIN_CATEGORIES, type WinCategoryValue, type WinRecord } from './types';
import { fadeDuration, motionDuration, usePrefersReducedMotion } from './use-reduced-motion';
import { WinCard, type WinCardMenuAction } from './win-card';

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

type RowStatus =
  | 'pending'
  | 'editing'
  | 'confirming'
  | 'confirmed'
  | 'dismissed'
  | 'error';

interface UndoEntry {
  winId: string;
  action: 'confirm' | 'dismiss' | 'recategorize' | 'edit';
  previousStatus: RowStatus;
  previousCategory?: WinCategoryValue;
  previousTitle?: string;
}

/** §7.2 — focus advances at t=200, the toast lands at t=220. */
const FOCUS_ADVANCE_MS = 200;
const TOAST_MS = 220;
/** The completion state persists ten seconds, then the block leaves. */
const COMPLETION_DWELL_MS = 10_000;

const HINT_SESSIONS = 3;
const HINT_KEY = 'patronus.review-queue.sessions';
const HINT_SESSION_FLAG = 'patronus.review-queue.session-counted';

const SHORTCUTS: Array<[string, string]> = [
  ['j / ↓', 'Next win'],
  ['k / ↑', 'Previous win'],
  ['y / ↵', 'Confirm'],
  ['n / ⌫', 'Dismiss'],
  ['e', 'Edit inline'],
  ['u', 'Undo last action'],
  ['1–8', 'Re-assign category'],
  ['?', 'Toggle this sheet'],
  ['Esc', 'Exit edit, or leave the queue'],
];

export interface ReviewQueueProps {
  items: WinRecord[];
  /** Section label. A noun, per §10. */
  title?: string;
  /** Rows shown before the "Show n more" control. Never an unbounded queue. */
  initialVisible?: number;
  /** Undo stack depth. */
  undoDepth?: number;
  density?: Density;

  /**
   * Persist a confirm. Rejecting puts the row into its error state with an
   * inline retry rather than failing the whole queue.
   */
  onConfirm?: (win: WinRecord) => void | Promise<void>;
  onDismiss?: (win: WinRecord) => void | Promise<void>;
  onEdit?: (win: WinRecord, nextTitle: string) => void;
  onRecategorize?: (win: WinRecord, category: WinCategoryValue) => void;
  /**
   * Persist an undo. Carries what it restores (`previousCategory`,
   * `previousTitle`), so the caller can write it back — without them an undo
   * only ever changed the screen, never the record.
   */
  onUndo?: (entry: {
    winId: string;
    action: UndoEntry['action'];
    previousCategory?: WinCategoryValue;
    previousTitle?: string;
  }) => void;
  /**
   * Bulk confirm in one call ("Confirm all"). When absent, bulk falls back to
   * one `onConfirm` per row. Resolves with the ids that failed.
   */
  onConfirmMany?: (wins: WinRecord[]) => Promise<{ failed: { winId: string; error: string }[] }>;
  onOpen?: (win: WinRecord) => void;
  onMenuAction?: (win: WinRecord, action: WinCardMenuAction) => void;
  /** Fires once the completion state has dwelled and the block has unmounted. */
  onDone?: (summary: { confirmed: number; dismissed: number }) => void;

  /** Override the localStorage-backed first-three-sessions rule. */
  showHintBar?: boolean;
  /** Suppress toasts. Toasts are on by default; §7.2 specifies one per confirm. */
  toasts?: boolean;
  className?: string;
}

/**
 * One bulk-confirm response → one settled result per row, in row order, so a
 * single "Confirm all" call reports failures exactly where `Promise.allSettled`
 * over N calls used to.
 */
export function settleBulkConfirm(
  targetIds: readonly string[],
  failed: readonly { winId: string; error: string }[],
): PromiseSettledResult<undefined>[] {
  const failedById = new Map(failed.map((entry) => [entry.winId, entry.error]));
  return targetIds.map((id) =>
    failedById.has(id)
      ? { status: 'rejected' as const, reason: new Error(failedById.get(id)) }
      : { status: 'fulfilled' as const, value: undefined },
  );
}

/**
 * `ReviewQueue` — owns the 20-second bar.
 *
 * Keyboard-first by construction: the container holds DOM focus and rows are
 * addressed through `aria-activedescendant`, which is both the correct listbox
 * pattern and the fastest path for sighted power users. Accessibility and the
 * 20-second bar want the same thing.
 */
export function ReviewQueue({
  items,
  title = 'Needs review',
  initialVisible = 5,
  undoDepth = 10,
  density = 'compact',
  onConfirm,
  onDismiss,
  onEdit,
  onRecategorize,
  onUndo,
  onConfirmMany,
  onOpen,
  onMenuAction,
  onDone,
  showHintBar,
  toasts = true,
  className,
}: ReviewQueueProps) {
  const reduced = usePrefersReducedMotion();
  const listId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const completionRef = React.useRef<HTMLDivElement>(null);
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /**
   * The undo stack lives in a ref rather than state. A toast fired eight
   * seconds ago must undo the action it was fired for, so every closure has to
   * see the same stack regardless of which render created it. `undoCount`
   * mirrors the depth for rendering.
   */
  const undoStackRef = React.useRef<UndoEntry[]>([]);

  const [undoCount, setUndoCount] = React.useState(0);
  const [statuses, setStatuses] = React.useState<Record<string, RowStatus>>({});
  const [categories, setCategories] = React.useState<Record<string, WinCategoryValue>>({});
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = React.useState(() =>
    Math.min(items.length, initialVisible)
  );
  const [activeId, setActiveId] = React.useState<string | null>(items[0]?.id ?? null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [bulk, setBulk] = React.useState<{ kind: 'confirm' | 'dismiss'; count: number } | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const [exiting, setExiting] = React.useState(false);
  const [unmounted, setUnmounted] = React.useState(false);
  const [hintVisible, setHintVisible] = React.useState(showHintBar ?? true);

  React.useEffect(() => {
    const captured = timers.current;
    return () => captured.forEach(clearTimeout);
  }, []);

  const schedule = React.useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  /* --- hint bar: first three sessions, tracked in localStorage ---------- */
  React.useEffect(() => {
    if (showHintBar !== undefined) {
      setHintVisible(showHintBar);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      let sessions = Number(window.localStorage.getItem(HINT_KEY) ?? '0');
      if (!window.sessionStorage.getItem(HINT_SESSION_FLAG)) {
        sessions += 1;
        window.localStorage.setItem(HINT_KEY, String(sessions));
        window.sessionStorage.setItem(HINT_SESSION_FLAG, '1');
      }
      setHintVisible(sessions <= HINT_SESSIONS);
    } catch {
      // Private mode or storage disabled: show the hint. Erring toward help.
      setHintVisible(true);
    }
  }, [showHintBar]);

  /* --- derived ---------------------------------------------------------- */
  const statusOf = React.useCallback(
    (id: string): RowStatus => statuses[id] ?? 'pending',
    [statuses]
  );

  const visibleItems = items.slice(0, visibleCount);
  const hiddenCount = items.length - visibleItems.length;

  const isActionable = React.useCallback(
    (id: string) => {
      const status = statusOf(id);
      return status === 'pending' || status === 'editing' || status === 'error';
    },
    [statusOf]
  );

  const navigable = visibleItems.filter((item) => isActionable(item.id));
  const remaining = items.filter((item) => isActionable(item.id)).length;

  const confirmedCount = items.filter(
    (item) => statusOf(item.id) === 'confirmed' || statusOf(item.id) === 'confirming'
  ).length;
  const dismissedCount = items.filter((item) => statusOf(item.id) === 'dismissed').length;
  const allActioned = items.length > 0 && remaining === 0;

  /* --- announcements ---------------------------------------------------- */
  const announce = React.useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const remainingPhrase = React.useCallback(
    (count: number) => (count === 1 ? '1 remaining.' : `${count} remaining.`),
    []
  );

  /* --- focus ------------------------------------------------------------ */
  const advanceFrom = React.useCallback(
    (fromId: string) => {
      const pool = visibleItems.filter((item) => item.id !== fromId && isActionable(item.id));
      if (pool.length === 0) {
        setActiveId(null);
        return;
      }
      const fromIndex = visibleItems.findIndex((item) => item.id === fromId);
      const next =
        pool.find((item) => visibleItems.indexOf(item) > fromIndex) ?? pool[pool.length - 1];
      setActiveId(next.id);
    },
    [visibleItems, isActionable]
  );

  // Never leave focus on <body>. When the queue completes, focus the
  // completion state (§9.2).
  React.useEffect(() => {
    if (allActioned && !exiting) {
      completionRef.current?.focus();
    }
  }, [allActioned, exiting]);

  // Keep the active descendant pointing at something actionable.
  React.useEffect(() => {
    if (allActioned) return;
    // A row mid-confirm is not actionable, but the §7.2 advance at t=200 owns
    // where focus goes next. Correcting it here would snap focus to the top of
    // the queue for 200ms first.
    if (activeId && statusOf(activeId) === 'confirming') return;
    if (activeId && isActionable(activeId) && visibleItems.some((i) => i.id === activeId)) return;
    setActiveId(navigable[0]?.id ?? null);
  }, [activeId, allActioned, isActionable, statusOf, navigable, visibleItems]);

  /* --- completion dwell, then exit -------------------------------------- */
  React.useEffect(() => {
    if (!allActioned) return;
    const dwell = setTimeout(() => setExiting(true), COMPLETION_DWELL_MS);
    return () => clearTimeout(dwell);
  }, [allActioned]);

  React.useEffect(() => {
    if (!exiting) return;
    const out = setTimeout(() => {
      setUnmounted(true);
      onDone?.({ confirmed: confirmedCount, dismissed: dismissedCount });
    }, motionDuration(duration.exit, reduced) + 20);
    return () => clearTimeout(out);
  }, [exiting, onDone, confirmedCount, dismissedCount, reduced]);

  /* --- actions ---------------------------------------------------------- */
  const pushUndo = React.useCallback(
    (...entries: UndoEntry[]) => {
      undoStackRef.current = [...entries, ...undoStackRef.current].slice(0, undoDepth);
      setUndoCount(undoStackRef.current.length);
    },
    [undoDepth]
  );

  const undoLast = React.useCallback(() => {
    const entry = undoStackRef.current[0];
    if (!entry) {
      announce('Nothing to undo.');
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(1);
    setUndoCount(undoStackRef.current.length);

    setStatuses((prev) => ({ ...prev, [entry.winId]: entry.previousStatus }));
    if (entry.previousCategory) {
      const category = entry.previousCategory;
      setCategories((prev) => ({ ...prev, [entry.winId]: category }));
    }
    if (entry.previousTitle !== undefined) {
      const previousTitle = entry.previousTitle;
      setTitles((prev) => ({ ...prev, [entry.winId]: previousTitle }));
    }
    // An undo during the completion dwell pulls the block back into the page.
    setExiting(false);
    setActiveId(entry.winId);
    announce('Undone.');
    onUndo?.({
      winId: entry.winId,
      action: entry.action,
      previousCategory: entry.previousCategory,
      previousTitle: entry.previousTitle,
    });
  }, [announce, onUndo]);

  const confirmRow = React.useCallback(
    (win: WinRecord) => {
      if (!isActionable(win.id)) return;
      pushUndo({ winId: win.id, action: 'confirm', previousStatus: statusOf(win.id) });
      setStatuses((prev) => ({ ...prev, [win.id]: 'confirming' }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[win.id];
        return next;
      });

      announce(`Logged. ${remainingPhrase(remaining - 1)}`);
      schedule(() => advanceFrom(win.id), motionDuration(FOCUS_ADVANCE_MS, reduced));
      if (toasts) {
        schedule(() => {
          toast('Logged', { action: { label: 'Undo', onClick: () => undoLast() } });
        }, motionDuration(TOAST_MS, reduced));
      }

      void Promise.resolve(onConfirm?.(win)).catch((error: unknown) => {
        setStatuses((prev) => ({ ...prev, [win.id]: 'error' }));
        setErrors((prev) => ({
          ...prev,
          [win.id]: error instanceof Error ? error.message : "That didn't save.",
        }));
        announce('One win failed to save. Retry from the row.');
      });
    },
    [isActionable, statusOf, pushUndo, announce, remaining, remainingPhrase, schedule, advanceFrom, reduced, toasts, onConfirm, undoLast]
  );

  const dismissRow = React.useCallback(
    (win: WinRecord) => {
      if (!isActionable(win.id)) return;
      pushUndo({ winId: win.id, action: 'dismiss', previousStatus: statusOf(win.id) });
      setStatuses((prev) => ({ ...prev, [win.id]: 'dismissed' }));
      announce(`Dismissed. ${remainingPhrase(remaining - 1)}`);
      advanceFrom(win.id);
      if (toasts) {
        schedule(() => {
          toast('Dismissed', { action: { label: 'Undo', onClick: () => undoLast() } });
        }, motionDuration(TOAST_MS, reduced));
      }
      void Promise.resolve(onDismiss?.(win)).catch(() => {
        setStatuses((prev) => ({ ...prev, [win.id]: 'error' }));
        setErrors((prev) => ({ ...prev, [win.id]: "That didn't save." }));
      });
    },
    [isActionable, statusOf, pushUndo, announce, remaining, remainingPhrase, advanceFrom, schedule, reduced, toasts, onDismiss, undoLast]
  );

  const recategorize = React.useCallback(
    (win: WinRecord, category: WinCategoryValue) => {
      pushUndo({
        winId: win.id,
        action: 'recategorize',
        previousStatus: statusOf(win.id),
        previousCategory: categories[win.id] ?? win.category,
      });
      setCategories((prev) => ({ ...prev, [win.id]: category }));
      announce(`Category set to ${CATEGORY_META[category].label}.`);
      onRecategorize?.(win, category);
    },
    [pushUndo, statusOf, categories, announce, onRecategorize]
  );

  const runBulk = React.useCallback(
    async (kind: 'confirm' | 'dismiss') => {
      const targets = items.filter((item) => isActionable(item.id));
      if (targets.length === 0) return;

      setBulk({ kind, count: targets.length });
      announce(`${kind === 'confirm' ? 'Confirming' : 'Dismissing'} ${targets.length} wins.`);

      const handler = kind === 'confirm' ? onConfirm : onDismiss;
      let results: PromiseSettledResult<unknown>[];
      if (kind === 'confirm' && onConfirmMany) {
        // One call for the whole screen, not N parallel confirms.
        try {
          const outcome = await onConfirmMany(targets);
          results = settleBulkConfirm(targets.map((target) => target.id), outcome.failed);
        } catch (error) {
          results = targets.map(() => ({ status: 'rejected' as const, reason: error }));
        }
      } else {
        results = await Promise.allSettled(
          targets.map((target) => Promise.resolve(handler?.(target)))
        );
      }

      const nextStatuses: Record<string, RowStatus> = {};
      const nextErrors: Record<string, string> = {};
      let ok = 0;
      let failed = 0;

      results.forEach((result, index) => {
        const target = targets[index];
        if (result.status === 'fulfilled') {
          // 'confirming' rather than 'confirmed': successful rows collapse
          // through the §7.2 animation instead of blinking out of existence.
          nextStatuses[target.id] = kind === 'confirm' ? 'confirming' : 'dismissed';
          ok += 1;
        } else {
          nextStatuses[target.id] = 'error';
          nextErrors[target.id] =
            result.reason instanceof Error ? result.reason.message : "That didn't save.";
          failed += 1;
        }
      });

      setStatuses((prev) => ({ ...prev, ...nextStatuses }));
      setErrors((prev) => ({ ...prev, ...nextErrors }));
      pushUndo(
        ...targets
          .filter((target) => nextStatuses[target.id] !== 'error')
          .map<UndoEntry>((target) => ({
            winId: target.id,
            action: kind,
            previousStatus: 'pending' as const,
          }))
      );
      setBulk(null);

      announce(
        failed === 0
          ? `${ok} ${kind === 'confirm' ? 'logged' : 'dismissed'}.`
          : `${ok} ${kind === 'confirm' ? 'logged' : 'dismissed'}, ${failed} failed. Retry from the row.`
      );
    },
    [items, isActionable, announce, onConfirm, onConfirmMany, onDismiss, pushUndo]
  );

  const startEdit = React.useCallback(
    (win: WinRecord) => {
      setStatuses((prev) => ({ ...prev, [win.id]: 'editing' }));
      setActiveId(win.id);
    },
    []
  );

  const saveEdit = React.useCallback(
    (win: WinRecord, nextTitle: string) => {
      pushUndo({
        winId: win.id,
        action: 'edit',
        previousStatus: 'pending',
        previousTitle: titles[win.id] ?? win.title,
      });
      setTitles((prev) => ({ ...prev, [win.id]: nextTitle || win.title }));
      setStatuses((prev) => ({ ...prev, [win.id]: 'pending' }));
      announce('Title updated.');
      onEdit?.(win, nextTitle);
      containerRef.current?.focus();
    },
    [pushUndo, titles, announce, onEdit]
  );

  const cancelEdit = React.useCallback((win: WinRecord) => {
    setStatuses((prev) => ({ ...prev, [win.id]: 'pending' }));
    containerRef.current?.focus();
  }, []);

  /* --- keyboard --------------------------------------------------------- */
  const move = React.useCallback(
    (delta: 1 | -1) => {
      if (navigable.length === 0) return;
      const index = navigable.findIndex((item) => item.id === activeId);
      const nextIndex =
        index === -1
          ? 0
          : Math.min(navigable.length - 1, Math.max(0, index + delta));
      setActiveId(navigable[nextIndex].id);
    },
    [navigable, activeId]
  );

  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const editingId = items.find((item) => statusOf(item.id) === 'editing')?.id ?? null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // While a row is editing, the textarea owns the keyboard.
    if (editingId) return;
    if (bulk) return;

    const { key } = event;

    if (key === '?') {
      event.preventDefault();
      setSheetOpen((open) => !open);
      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      if (sheetOpen) {
        setSheetOpen(false);
        return;
      }
      containerRef.current?.blur();
      return;
    }

    if (key === 'j' || key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }

    if (key === 'k' || key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }

    if (key === 'u') {
      event.preventDefault();
      undoLast();
      return;
    }

    if (!activeItem) return;

    if (key === 'y' || key === 'Enter') {
      event.preventDefault();
      confirmRow(activeItem);
      return;
    }

    if (key === 'n' || key === 'Backspace') {
      event.preventDefault();
      dismissRow(activeItem);
      return;
    }

    if (key === 'e') {
      event.preventDefault();
      startEdit(activeItem);
      return;
    }

    if (/^[1-8]$/.test(key)) {
      event.preventDefault();
      recategorize(activeItem, WIN_CATEGORIES[Number(key) - 1]);
    }
  }

  /* --- render ----------------------------------------------------------- */

  // Empty: the block does not render at all. A "nothing to review" card is noise.
  if (items.length === 0 || unmounted) return null;

  const rowId = (id: string) => `${listId}-row-${id}`;

  const container = (
    <section
      aria-label={title}
      className={cn(
        'surface-work relative overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
      style={{
        opacity: exiting ? 0 : 1,
        transition: `opacity ${fadeDuration(duration.exit, reduced)}ms ${easing.exit}`,
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border bg-card px-4 sm:gap-3">
        <h2 className={cn(typeStyles.h2, 'whitespace-nowrap text-foreground')}>
          {title}
          <span aria-hidden="true" className="mx-1.5 text-muted-foreground/50">
            ·
          </span>
          <span className="num text-muted-foreground">{remaining}</span>
        </h2>

        <span className="flex-1" />

        {bulk ? (
          <span className={cn(typeStyles.caption, 'num text-muted-foreground')}>
            {bulk.kind === 'confirm' ? 'Confirming' : 'Dismissing'} {bulk.count}…
          </span>
        ) : allActioned ? null : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="px-2 sm:px-3"
              onClick={() => void runBulk('confirm')}
            >
              Confirm all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="px-2 sm:px-3"
              onClick={() => void runBulk('dismiss')}
            >
              Dismiss all
            </Button>
          </>
        )}
      </header>

      {/* Every action announces itself (§9.1). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {allActioned ? (
        <div
          ref={completionRef}
          tabIndex={-1}
          className={cn('flex items-center gap-3 px-4 py-8', focusRing)}
        >
          <div className="min-w-0 flex-1">
            <p className={cn(typeStyles.h3, 'text-foreground')}>All caught up</p>
            <p className={cn(typeStyles.small, 'num text-muted-foreground')}>
              {confirmedCount} logged, {dismissedCount} dismissed
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={undoLast}
            disabled={undoCount === 0}
          >
            Undo
          </Button>
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            role="listbox"
            tabIndex={0}
            aria-label={`${title}. Use j and k to move, y to confirm, n to dismiss.`}
            aria-activedescendant={activeId ? rowId(activeId) : undefined}
            onKeyDown={handleKeyDown}
            className={cn(
              'space-y-px p-2 outline-none',
              // No ring offset here: the section clips its overflow, so an
              // offset ring would be sliced off at the container edge.
              'focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {visibleItems.map((item) => {
              const status = statusOf(item.id);
              // A confirmed row has finished its collapse; keeping it mounted
              // would let the grid row spring back open.
              if (status === 'confirmed') return null;
              const win: WinRecord = {
                ...item,
                title: titles[item.id] ?? item.title,
                category: categories[item.id] ?? item.category,
              };

              return (
                <div
                  key={item.id}
                  id={rowId(item.id)}
                  role="option"
                  aria-selected={activeId === item.id}
                  className="outline-none"
                >
                  <WinCard
                    win={win}
                    variant="review"
                    density={density}
                    state={cardState(status)}
                    active={activeId === item.id}
                    focusable={false}
                    actionsFocusable={false}
                    busy={Boolean(bulk) && status === 'pending'}
                    errorMessage={errors[item.id]}
                    onOpen={onOpen ? () => onOpen(win) : undefined}
                    onConfirm={() => confirmRow(item)}
                    onDismiss={() => dismissRow(item)}
                    onUndo={undoLast}
                    onRetry={() => confirmRow(item)}
                    onEditSave={(next) => saveEdit(item, next)}
                    onEditCancel={() => cancelEdit(item)}
                    onMenuAction={(action) => {
                      if (action === 'edit') {
                        startEdit(item);
                        return;
                      }
                      onMenuAction?.(win, action);
                    }}
                    onConfirmEnd={() =>
                      setStatuses((prev) =>
                        prev[item.id] === 'confirming' ? { ...prev, [item.id]: 'confirmed' } : prev
                      )
                    }
                  />
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 ? (
            <div className="px-4 pb-2">
              <button
                type="button"
                onClick={() => setVisibleCount(items.length)}
                className={cn(
                  typeStyles.caption,
                  focusRing,
                  'num rounded-sm text-muted-foreground hover:text-foreground hover:underline'
                )}
              >
                Show {hiddenCount} more
              </button>
            </div>
          ) : null}

          <HintBar
            expanded={hintVisible}
            onToggleSheet={() => setSheetOpen((open) => !open)}
          />
        </>
      )}

      {sheetOpen ? (
        <ShortcutSheet onClose={() => setSheetOpen(false)} />
      ) : null}
    </section>
  );

  return (
    <DensityProvider density={density} asChild>
      {container}
    </DensityProvider>
  );
}

function cardState(status: RowStatus) {
  switch (status) {
    case 'confirming':
      return 'confirming' as const;
    case 'confirmed':
      return 'confirmed' as const;
    case 'dismissed':
      return 'dismissed' as const;
    case 'editing':
      return 'editing' as const;
    case 'error':
      return 'error' as const;
    default:
      return 'default' as const;
  }
}

/**
 * Visible for the first three sessions, then collapses to a keyboard glyph
 * with the full sheet behind `?`. Tracked in `localStorage`, not the DB — this
 * is a UI preference, not a fact about the user's career.
 */
function HintBar({ expanded, onToggleSheet }: { expanded: boolean; onToggleSheet: () => void }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2">
      <button
        type="button"
        onClick={onToggleSheet}
        aria-label="Keyboard shortcuts"
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground',
          'transition-colors duration-[120ms] ease-out hover:text-foreground',
          focusRing
        )}
      >
        <Keyboard aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
      </button>

      {expanded ? (
        <p className={cn(typeStyles.caption, 'flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground')}>
          <ShortcutHint keys="j/k" label="move" />
          <ShortcutHint keys="y" label="confirm" />
          <ShortcutHint keys="n" label="dismiss" />
          <ShortcutHint keys="e" label="edit" />
          <ShortcutHint keys="u" label="undo" />
          <ShortcutHint keys="?" label="help" />
        </p>
      ) : null}
    </div>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded-sm border border-border bg-secondary px-1 font-mono text-[11px] text-foreground">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="absolute bottom-2 right-2 z-20 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className={cn(typeStyles.caption, 'uppercase text-muted-foreground')}>Shortcuts</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close shortcuts"
          className={cn('rounded-sm text-muted-foreground hover:text-foreground', focusRing)}
        >
          <X aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <dl className="space-y-1">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="flex items-center justify-between gap-3">
            <dt>
              <kbd className="rounded-sm border border-border bg-secondary px-1 font-mono text-[11px] text-foreground">
                {keys}
              </kbd>
            </dt>
            <dd className={cn(typeStyles.caption, 'text-muted-foreground')}>{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
