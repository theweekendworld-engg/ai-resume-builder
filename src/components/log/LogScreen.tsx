'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, SearchX } from 'lucide-react';
import { toast } from 'sonner';

import type { WinPatch, WinView } from '@/actions/wins.types';
import {
  EmptyState,
  ProgressStages,
  ReviewQueue,
  typeStyles,
  type WinRecord,
} from '@/components/patterns';
import { cn } from '@/lib/utils';

import { syncSourceNow } from '@/actions/capture';
import { mergeTargetFromCode, toWinRecord } from './adapt';
import { planQueueUndo, type QueueUndoEntry } from './queueActions';
import { logData, type LogSnapshot } from './data-source';
import { applyFilters, isFiltered, NO_FILTERS, yearOptions, type LogFilterState } from './filters';
import { LogFilters } from './LogFilters';
import { LogList, LogListSkeleton, SyncErrorBanner } from './LogList';
import { LogRail } from './LogRail';
import { QuickCapture, type QuickCaptureSubmit } from './QuickCapture';
import { WinDrawer } from './WinDrawer';

/** The undo window on a capture toast. */
const UNDO_MS = 8000;
/** Rows the review queue holds. Beyond this the log itself is the queue. */
const QUEUE_MAX = 12;

export interface LogScreenProps {
  snapshot: LogSnapshot;
  /** Reference date. Passed in so the server and the client agree on "today". */
  now: Date;
  /** From `?win=<id>` — the deep link is a share affordance, not a route. */
  initialWinId: string | null;
  /** Opens quick capture on first paint. Set by `/log?compose=1` from email. */
  initialCompose?: boolean;
  /**
   * Whether `/settings/sources` will actually render for this user.
   *
   * That page calls `notFound()` unless `github_capture` is on, so offering
   * "Connect GitHub" without checking sends a brand-new user from the empty
   * state straight into a 404 — on the first screen they ever see. When the
   * connector is off, logging one manually IS the primary action.
   */
  canConnectSources?: boolean;
}

function byRecency(a: WinView, b: WinView): number {
  const diff = b.occurredAt.getTime() - a.occurredAt.getTime();
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/**
 * Merge a page in, keyed by id. Strict Mode double-invokes effects in
 * development, so an append that trusts the cursor alone duplicates every row
 * of page two — a bug that only shows up in the environment we develop in.
 */
function mergeWins(current: WinView[], incoming: WinView[]): WinView[] {
  const byId = new Map(current.map((win) => [win.id, win]));
  for (const win of incoming) byId.set(win.id, win);
  return [...byId.values()].sort(byRecency);
}

/**
 * The Log — design/02 §B. The home of the product.
 *
 * Everything on this screen is arranged around one number: the twenty seconds
 * a weekly review is allowed to take. The review queue is the first thing
 * below the title, it is keyboard-driven, and nothing on the confirm path
 * opens a dialog or navigates. The rest of the surface — filters, the rail,
 * the drawer — is what people use afterwards, and is laid out accordingly.
 */
export function LogScreen({
  snapshot,
  now,
  initialWinId,
  initialCompose = false,
  canConnectSources = false,
}: LogScreenProps) {
  const router = useRouter();

  const [wins, setWins] = React.useState<WinView[]>(snapshot.page.items);
  const [nextCursor, setNextCursor] = React.useState(snapshot.page.nextCursor);
  const [hiddenByPlan, setHiddenByPlan] = React.useState(snapshot.page.hiddenByPlan);
  const [summary, setSummary] = React.useState(snapshot.summary);
  const [filters, setFilters] = React.useState<LogFilterState>(NO_FILTERS);
  const [openWinId, setOpenWinId] = React.useState<string | null>(initialWinId);
  const [captureOpen, setCaptureOpen] = React.useState(initialCompose);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(
    snapshot.surface.sync.state === 'error' ? snapshot.surface.sync.message : null,
  );

  /**
   * The queue is a snapshot, not a live view of `wins`. `ReviewQueue` owns the
   * confirm animation and its own per-row state; re-deriving its items as rows
   * are actioned would yank rows out from under the collapse.
   */
  const [queueItems, setQueueItems] = React.useState<WinRecord[]>(() =>
    snapshot.page.items
      .filter((win) => win.status === 'draft')
      .slice(0, QUEUE_MAX)
      .map(toWinRecord),
  );

  /* --- ⌘K ---------------------------------------------------------------- */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCaptureOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* --- ?win=<id> ---------------------------------------------------------- */
  //
  // `history.replaceState` rather than `router.replace`: the deep link has to
  // be shareable, but a Next navigation would re-run the page and throw away
  // the scroll position the drawer exists to preserve.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (openWinId) url.searchParams.set('win', openWinId);
    else url.searchParams.delete('win');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [openWinId]);

  /* --- derived ------------------------------------------------------------ */
  /**
   * The review queue already renders these drafts at the top of the page, so
   * the month list must not render them again — the default view otherwise
   * shows the same Win twice, and confirming it in the queue leaves the
   * duplicate sitting below.
   *
   * Scoped to the default segment on purpose: the explicit `Drafts` segment is
   * how you see drafts as a list, and a filtered view has no queue above it to
   * collide with.
   */
  const queuedIds = React.useMemo(
    () => new Set(queueItems.map((item) => item.id)),
    [queueItems],
  );

  const visible = React.useMemo(() => {
    const filtered = applyFilters(wins, filters);
    if (filters.segment !== 'all' || queuedIds.size === 0) return filtered;
    return filtered.filter((win) => !queuedIds.has(win.id));
  }, [wins, filters, queuedIds]);
  const years = React.useMemo(() => yearOptions(wins), [wins]);
  const openWin = React.useMemo(
    () => wins.find((win) => win.id === openWinId) ?? null,
    [wins, openWinId],
  );

  const quarterCount = React.useCallback(
    (list: WinView[]) => {
      const cutoff = new Date(now.getTime() - 90 * 86_400_000);
      return list.filter((win) => win.status === 'confirmed' && win.occurredAt >= cutoff).length;
    },
    [now],
  );

  /* --- mutations ---------------------------------------------------------- */
  const replaceWin = React.useCallback((next: WinView) => {
    setWins((prev) => prev.map((win) => (win.id === next.id ? next : win)).sort(byRecency));
  }, []);

  const handlePatch = React.useCallback(
    (winId: string, patch: WinPatch) => {
      // Optimistic: the drawer edits in place and a round trip between
      // keystroke and repaint would make every correction feel like a form.
      setWins((prev) =>
        prev.map((win) => (win.id === winId ? { ...win, ...patch } : win)).sort(byRecency),
      );
      void logData.updateWin(winId, patch).then((result) => {
        if (result.success) replaceWin(result.data);
        else toast.error(result.error);
      });
    },
    [replaceWin],
  );

  const handleAddImpact = React.useCallback(
    (winId: string, answer: string) => {
      void logData.addImpact(winId, answer).then((result) => {
        if (result.success) {
          replaceWin(result.data);
          setSummary((prev) => ({ ...prev, withImpact: prev.withImpact + 1 }));
        } else {
          toast.error(result.error);
        }
      });
    },
    [replaceWin],
  );

  const handleSkipQuantify = React.useCallback((winId: string) => {
    setWins((prev) =>
      prev.map((win) => (win.id === winId ? { ...win, quantifyPrompt: null } : win)),
    );
  }, []);

  const handleGroundConfirm = React.useCallback(
    async (winId: string, source?: string) => {
      // The source the user typed in the Confirm popover is evidence; it used
      // to be dropped on the floor here.
      const trimmed = source?.trim();
      const result = await logData.confirmWin(winId, undefined, trimmed ? { source: trimmed } : undefined);
      if (result.success) replaceWin(result.data);
      else toast.error(result.error);
    },
    [replaceWin],
  );

  const handleArchive = React.useCallback((winId: string) => {
    setOpenWinId(null);
    void logData.archiveWin(winId).then((result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setWins((prev) => prev.map((win) => (win.id === winId ? result.data : win)));
      toast('Archived');
    });
  }, []);

  const handleDelete = React.useCallback((winId: string) => {
    setOpenWinId(null);
    void logData.deleteWin(winId).then((result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setWins((prev) => prev.filter((win) => win.id !== winId));
      toast('Deleted');
    });
  }, []);

  /* --- review queue -------------------------------------------------------- */
  const confirmFromQueue = React.useCallback(
    async (record: WinRecord) => {
      const result = await logData.confirmWin(record.id);
      // Rejecting is the contract with `ReviewQueue`: it puts the row into its
      // inline error state with a retry rather than failing the whole queue.
      if (!result.success) throw new Error(result.error);
      replaceWin(result.data);
      setSummary((prev) => ({
        ...prev,
        totalConfirmed: prev.totalConfirmed + 1,
        draftCount: Math.max(0, prev.draftCount - 1),
      }));
    },
    [replaceWin],
  );

  const dismissFromQueue = React.useCallback(async (record: WinRecord) => {
    const result = await logData.dismissWin(record.id, 'not_a_win');
    if (!result.success) throw new Error(result.error);
    setWins((prev) => prev.filter((win) => win.id !== record.id));
    setSummary((prev) => ({ ...prev, draftCount: Math.max(0, prev.draftCount - 1) }));
  }, []);

  const editFromQueue = React.useCallback(
    (record: WinRecord, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) return;
      void logData.updateWin(record.id, { title }).then((result) => {
        if (result.success) replaceWin(result.data);
        else toast.error(result.error);
      });
    },
    [replaceWin],
  );

  const recategorizeFromQueue = React.useCallback(
    (record: WinRecord, category: WinPatch['category']) => {
      if (!category) return;
      void logData.updateWin(record.id, { category }).then((result) => {
        if (result.success) replaceWin(result.data);
        else toast.error(result.error);
      });
    },
    [replaceWin],
  );

  /**
   * The queue's undo only ever changed the screen: a confirmed Win stayed
   * confirmed, a dismissed one stayed dismissed, edits stayed edited. Each
   * undo now writes its inverse.
   */
  const undoFromQueue = React.useCallback(
    (entry: QueueUndoEntry) => {
      const write = planQueueUndo(entry);
      const done = (result: { success: true; data: WinView } | { success: false; error: string; code?: string }) => {
        // The record is back to draft even when only the search index lagged.
        if (result.success) replaceWin(result.data);
        else if (result.code !== 'qdrant_delete_failed') toast.error(result.error);
      };
      switch (write.kind) {
        case 'unconfirm':
          void logData.unconfirmWin(write.winId).then((result) => {
            done(result);
            if (result.success || result.code === 'qdrant_delete_failed') {
              setSummary((prev) => ({
                ...prev,
                totalConfirmed: Math.max(0, prev.totalConfirmed - 1),
                draftCount: prev.draftCount + 1,
              }));
            }
          });
          return;
        case 'restore':
          void logData.restoreWin(write.winId).then((result) => {
            if (!result.success) {
              toast.error(result.error);
              return;
            }
            setWins((prev) => mergeWins(prev, [result.data]));
            setSummary((prev) => ({ ...prev, draftCount: prev.draftCount + 1 }));
          });
          return;
        case 'update':
          void logData.updateWin(write.winId, write.patch).then(done);
          return;
        case 'none':
          return;
      }
    },
    [replaceWin],
  );

  const confirmManyFromQueue = React.useCallback(
    async (records: WinRecord[]) => {
      const result = await logData.bulkConfirm(records.map((record) => record.id));
      if (!result.success) throw new Error(result.error);
      const okIds = new Set(result.data.ok);
      setWins((prev) =>
        prev.map((win) => (okIds.has(win.id) ? { ...win, status: 'confirmed' as const } : win)),
      );
      setSummary((prev) => ({
        ...prev,
        totalConfirmed: prev.totalConfirmed + okIds.size,
        draftCount: Math.max(0, prev.draftCount - okIds.size),
      }));
      return { failed: result.data.failed };
    },
    [],
  );

  /* --- pagination ---------------------------------------------------------- */
  const loadMore = React.useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void logData
      .listWins({}, nextCursor)
      .then((result) => {
        if (result.success) {
          setWins((prev) => mergeWins(prev, result.data.items));
          setNextCursor(result.data.nextCursor);
          setHiddenByPlan(result.data.hiddenByPlan);
        } else {
          setSyncError(result.error);
        }
      })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore]);

  /*
   * Under 200 Wins the filter runs client-side (§B), which is only honest if
   * the client actually holds the whole in-plan record — filtering a partial
   * page silently hides matches. So below the threshold the remaining pages
   * are pulled in immediately; above it, `Show more` stays manual and the
   * filter would move to the server.
   */
  const clientSideRegime = snapshot.page.total <= 200;
  React.useEffect(() => {
    if (!clientSideRegime || !nextCursor || loadingMore) return;
    loadMore();
  }, [clientSideRegime, nextCursor, loadingMore, loadMore]);

  /* --- quick capture -------------------------------------------------------- */
  /**
   * One create call. The structured draft the user saw and edited is sent as
   * the draft, so the server persists it without a second model call or a
   * second meter unit (it used to send raw text, re-structure it, then patch
   * the edits back on). `confirm` is set only for an explicit "Log it" on a
   * structured draft: that click is the confirmation.
   */
  const persistCapture = React.useCallback(
    async (
      input: QuickCaptureSubmit,
      options: { confirm: boolean; force?: boolean },
    ): Promise<{ win: WinView } | { duplicateOf: string; title: string } | null> => {
      const structured = input.draft
        ? {
            ...input.draft,
            title: input.title ?? input.draft.title,
            narrative: input.narrative ?? input.draft.narrative,
            category: input.category ?? input.draft.category,
          }
        : undefined;
      const created = await logData.createWinFromText({
        text: input.text,
        ...(structured ? { draft: structured } : {}),
        occurredAt: input.occurredAt,
        sensitivity: input.sensitivity,
        source: 'manual',
        confirm: options.confirm && Boolean(structured),
        force: options.force,
      });
      if (!created.success) {
        const existing = mergeTargetFromCode(created.code);
        if (existing) return { duplicateOf: existing, title: created.error };
        toast.error(created.error);
        return null;
      }

      let win = created.data;
      if (input.quantity) {
        const quantified = await logData.addImpact(win.id, input.quantity);
        if (quantified.success) win = quantified.data;
      }
      return { win };
    },
    [],
  );

  /** Put a newly saved draft where drafts are reviewed, without a reload. */
  const enqueueDraft = React.useCallback((win: WinView) => {
    if (win.status !== 'draft') return;
    setQueueItems((prev) =>
      prev.some((item) => item.id === win.id) ? prev : [toWinRecord(win), ...prev].slice(0, QUEUE_MAX),
    );
    setSummary((prev) => ({ ...prev, draftCount: prev.draftCount + 1 }));
  }, []);

  /**
   * "Looks like <existing>. Merge into it or keep both?" A duplicate used to
   * throw the user's words away with a toast. Merge appends them to the
   * existing Win and opens it for editing; Keep both creates it anyway.
   */
  const offerDuplicate = React.useCallback(
    (input: QuickCaptureSubmit, existingId: string, message: string, onKept: (win: WinView) => void) => {
      const existing = wins.find((win) => win.id === existingId) ?? null;
      const label = existing ? `Looks like "${existing.title}".` : message;
      toast(label, {
        duration: 15_000,
        description: 'Merge into it or keep both?',
        action: {
          label: 'Merge',
          onClick: () => {
            const addition = (input.narrative ?? input.draft?.narrative ?? input.text).trim();
            const narrative = existing?.narrative ? `${existing.narrative}\n\n${addition}` : addition;
            void logData.updateWin(existingId, { narrative }).then((result) => {
              if (!result.success) {
                toast.error(result.error);
                return;
              }
              setWins((prev) => mergeWins(prev, [result.data]));
              setOpenWinId(existingId);
            });
          },
        },
        cancel: {
          label: 'Keep both',
          onClick: () => {
            void persistCapture(input, { confirm: true, force: true }).then((outcome) => {
              if (outcome && 'win' in outcome) onKept(outcome.win);
            });
          },
        },
      });
    },
    [wins, persistCapture],
  );

  const handleCapture = React.useCallback(
    (input: QuickCaptureSubmit) => {
      const landed = (win: WinView) => {
        const next = [win, ...wins.filter((entry) => entry.id !== win.id)].sort(byRecency);
        setWins(next);
        if (win.status !== 'confirmed') {
          // Confirm-on-create did not happen (no structured draft, or it
          // failed): say so, and put it in the queue rather than claim "Logged".
          enqueueDraft(win);
          toast('Saved as a draft. Confirm it in Needs review to add it to your record.');
          return;
        }
        setSummary((prev) => ({
          ...prev,
          totalConfirmed: prev.totalConfirmed + 1,
          withEvidence: prev.withEvidence + 1,
        }));
        // The counter incrementing is the reward (foundations §2 principle 5)
        // — no confetti, no "great job".
        toast(`Logged. ${quarterCount(next)} wins this quarter.`, {
          duration: UNDO_MS,
          action: {
            label: 'Undo',
            onClick: () => {
              setWins((current) => current.filter((entry) => entry.id !== win.id));
              setSummary((prev) => ({
                ...prev,
                totalConfirmed: Math.max(0, prev.totalConfirmed - 1),
                withEvidence: Math.max(0, prev.withEvidence - 1),
              }));
              // Delete reverses the confirmation too (winGraph.deleteWin).
              void logData.deleteWin(win.id);
            },
          },
        });
      };
      void persistCapture(input, { confirm: true }).then((outcome) => {
        if (!outcome) return;
        if ('duplicateOf' in outcome) {
          offerDuplicate(input, outcome.duplicateOf, outcome.title, landed);
          return;
        }
        landed(outcome.win);
      });
    },
    [persistCapture, quarterCount, wins, enqueueDraft, offerDuplicate],
  );

  const handleDegrade = React.useCallback(
    (input: QuickCaptureSubmit) => {
      // Silent degradation: the note is safe, the structuring catches up. It
      // is saved as a draft (the user never saw a structured version, so
      // there is nothing they approved yet) and goes to the review queue.
      void persistCapture(
        { ...input, title: undefined, narrative: undefined, category: undefined, draft: undefined },
        { confirm: false },
      ).then((outcome) => {
        if (!outcome || !('win' in outcome)) return;
        const win = outcome.win;
        setWins((prev) => [win, ...prev.filter((entry) => entry.id !== win.id)].sort(byRecency));
        enqueueDraft(win);
        toast('Saved as a draft. It is in Needs review once it is tidied up.');
      });
    },
    [persistCapture, enqueueDraft],
  );

  /* --- render -------------------------------------------------------------- */
  const firstRun = !snapshot.surface.sourceConnected && wins.length === 0;
  const loading = snapshot.surface.forceLoading === true;
  const filtered = isFiltered(filters);

  const rail = (variant: 'rail' | 'stacked' | 'strip', className?: string) => (
    <LogRail
      variant={variant}
      className={className}
      summary={summary}
      now={now}
      onGeneratePacket={() => router.push('/packets/new')}
    />
  );

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn(typeStyles.h1, 'text-foreground')}>Work log</h1>
        <QuickCapture
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          now={now}
          onStructure={async (text) => {
            const result = await logData.structureDraft(text);
            return result.success ? result.data : null;
          }}
          onSubmit={handleCapture}
          onDegrade={handleDegrade}
        />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {rail('strip', 'sm:hidden')}
          {rail('stacked', 'hidden sm:block lg:hidden')}

          {/* Connected and syncing: the work shows itself, never a spinner. */}
          {snapshot.surface.sync.state === 'syncing' ? (
            <ProgressStages title="Building your work log" stages={snapshot.surface.sync.stages} />
          ) : null}

          {syncError ? (
            <SyncErrorBanner
              message={syncError}
              onRetry={() => {
                // Retry used to just hide the error.
                void syncSourceNow().then((result) => {
                  if (result.success) {
                    setSyncError(null);
                    toast('Syncing again. New drafts land in Needs review.');
                  } else {
                    toast.error(result.error);
                  }
                });
              }}
            />
          ) : null}

          {/* Empty means the block does not render at all — a "nothing to
              review" card is noise on the surface people open every day. */}
          {queueItems.length > 0 ? (
            <ReviewQueue
              items={queueItems}
              onConfirm={confirmFromQueue}
              onConfirmMany={confirmManyFromQueue}
              onDismiss={dismissFromQueue}
              onEdit={editFromQueue}
              onRecategorize={recategorizeFromQueue}
              onUndo={undoFromQueue}
              onOpen={(record) => setOpenWinId(record.id)}
              onDone={() => setQueueItems([])}
            />
          ) : null}

          {firstRun ? (
            <EmptyState
              icon={Inbox}
              title="No wins yet"
              description={
                canConnectSources
                  ? snapshot.surface.plan === 'free'
                    ? "Connect GitHub and we'll draft wins from your last 30 days of merged work. They land here for you to review."
                    : "Connect GitHub and we'll draft wins from your last 90 days of merged work. They land here for you to review."
                  : 'Start with one thing you shipped this week.'
              }
              action={
                canConnectSources
                  ? { label: 'Connect GitHub', href: '/settings/sources' }
                  : { label: 'Log your first win', onClick: () => setCaptureOpen(true) }
              }
              secondary={
                canConnectSources
                  ? { label: 'or log one manually', onClick: () => setCaptureOpen(true) }
                  : undefined
              }
              samples={snapshot.samples.map(toWinRecord)}
            />
          ) : (
            <>
              <LogFilters
                filters={filters}
                onChange={setFilters}
                employers={snapshot.employers}
                years={years}
                resultCount={visible.length}
              />

              {loading ? (
                <LogListSkeleton />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No wins match"
                  description={
                    filtered
                      ? 'Nothing in your record matches these filters yet.'
                      : 'Log the first one and it lands here.'
                  }
                  action={
                    filtered
                      ? { label: 'Clear filters', onClick: () => setFilters(NO_FILTERS) }
                      : { label: 'Log a win', onClick: () => setCaptureOpen(true) }
                  }
                />
              ) : (
                <LogList
                  wins={visible}
                  openWinId={openWinId}
                  onOpen={(win) => setOpenWinId(win.id)}
                  // The boundary is the *end* of the record, so it waits
                  // until every in-plan page has landed.
                  hiddenByPlan={nextCursor === null ? hiddenByPlan : 0}
                  onSeePlans={() => router.push('/settings/plan')}
                  onLoadMore={loadMore}
                  loadingMore={loadingMore}
                  hasMore={nextCursor !== null && !clientSideRegime && !filtered}
                />
              )}
            </>
          )}
        </div>

        <div className="hidden lg:block">{rail('rail', 'lg:sticky lg:top-6')}</div>
      </div>

      <WinDrawer
        win={openWin}
        open={openWin !== null}
        employers={snapshot.employers}
        onOpenChange={(next) => {
          if (!next) setOpenWinId(null);
        }}
        onPatch={handlePatch}
        onAddImpact={handleAddImpact}
        onSkipQuantify={handleSkipQuantify}
        onGroundConfirm={handleGroundConfirm}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />
    </main>
  );
}
