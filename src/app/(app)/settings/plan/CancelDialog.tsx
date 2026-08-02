'use client';

import * as React from 'react';

import { cancelPlan, enterCancelFlow, exportEverything } from '@/actions/billing';
import {
  CANCEL_REASONS,
  CANCEL_REASON_LABELS,
  type CancelReason,
} from '@/actions/billing.types';
import { formatWinDate, typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { NO_DELETION_PROMISE } from '@/lib/plans';
import { cn } from '@/lib/utils';

export interface CancelDialogProps {
  planLabel: string;
  /** ISO date access runs to. They paid for it; they keep it. */
  accessUntil: string | null;
  onCancelled?: () => void;
}

/**
 * The cancel flow (PRD 06 §5.4).
 *
 * One confirm. No retention modal, no discount ambush, no "are you sure" chain,
 * no second screen that asks again in different words. The reason question is
 * optional and skippable by simply pressing the button.
 *
 * Export sits inside this dialog on purpose: from the plan page that is two
 * clicks, and it is offered unconditionally rather than dangled as a reason to
 * stay. And the copy states the retention promise plainly, because "cancel"
 * reads like "delete" to most people and here it is not.
 */
export function CancelDialog({ planLabel, accessUntil, onCancelled }: CancelDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<CancelReason | null>(null);
  const [reasonText, setReasonText] = React.useState('');
  const [exported, setExported] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void enterCancelFlow();
  }

  async function onExport() {
    const result = await exportEverything();
    if (!result.success) {
      setError(result.error);
      return;
    }
    downloadJson(result.data.filename, result.data.json);
    setExported(true);
  }

  async function onConfirm() {
    setPending(true);
    setError(null);
    const result = await cancelPlan({
      reason: reason ?? undefined,
      reasonText: reasonText.trim() || undefined,
      exportedFirst: exported,
    });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setDone(result.data.accessUntil);
    onCancelled?.();
  }

  return (
    <>
      <Button type="button" variant="ghost" onClick={() => onOpenChange(true)}>
        Cancel {planLabel}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle>{planLabel} is cancelled</DialogTitle>
                <DialogDescription>
                  You keep everything until {formatWinDate(done)}. {NO_DELETION_PROMISE}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Cancel {planLabel}</DialogTitle>
                <DialogDescription>
                  {accessUntil
                    ? `Your plan runs to ${formatWinDate(accessUntil)} and then stops renewing.`
                    : 'Your plan stops renewing at the end of the current period.'}{' '}
                  {NO_DELETION_PROMISE}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                    Take your data with you — optional, and it does not affect anything below.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={onExport}
                  >
                    {exported ? 'Exported' : 'Export everything'}
                  </Button>
                </div>

                <fieldset className="space-y-2">
                  <legend className={cn(typeStyles.caption, 'text-muted-foreground')}>
                    What changed? Optional.
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {CANCEL_REASONS.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={reason === value ? 'secondary' : 'outline'}
                        aria-pressed={reason === value}
                        onClick={() => setReason(reason === value ? null : value)}
                      >
                        {CANCEL_REASON_LABELS[value]}
                      </Button>
                    ))}
                  </div>
                  {reason === 'other' ? (
                    <Textarea
                      value={reasonText}
                      onChange={(event) => setReasonText(event.target.value)}
                      placeholder="In your words"
                      rows={2}
                    />
                  ) : null}
                </fieldset>
              </div>

              {error ? (
                <p role="alert" className={cn(typeStyles.caption, 'text-danger')}>
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Keep my plan
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={onConfirm}
                  disabled={pending}
                >
                  {pending ? 'Cancelling…' : `Cancel ${planLabel}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Client-side download so the export never round-trips through storage. */
export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
