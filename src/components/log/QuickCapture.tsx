'use client';

import * as React from 'react';
import { Calendar, Lock, LockOpen, Plus, Sparkles } from 'lucide-react';

import type { WinView } from '@/actions/wins.types';
import {
  CATEGORY_META,
  WIN_CATEGORIES,
  typeStyles,
  type WinCategoryValue,
} from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { DraftStructure } from './data-source';

const DAY_MS = 86_400_000;

/** §D: structure on 800ms idle, or on blur. */
const IDLE_MS = 800;
/** Past 4s it degrades silently — the raw text saves and structures later. */
const DEGRADE_MS = 4000;
/** Below this, there is nothing to structure. */
const MIN_CHARS = 8;

export interface QuickCaptureSubmit {
  text: string;
  title?: string;
  narrative?: string;
  category?: WinCategoryValue;
  occurredAt: Date;
  sensitivity: WinView['sensitivity'];
  /** Answer to the inline quantify prompt, when the draft carried no number. */
  quantity?: string;
  /**
   * The structured draft exactly as the user saw and edited it. Sent so the
   * server persists it as-is: re-structuring the raw text on save was a second
   * model call, a second meter unit, and a chance to overwrite the edits.
   * Absent when structuring never completed (raw text, or the 4s degrade).
   */
  draft?: DraftStructure;
}

export interface QuickCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed reference date, so "Today" is stable between server and client. */
  now: Date;
  onStructure: (text: string) => Promise<DraftStructure | null>;
  onSubmit: (input: QuickCaptureSubmit) => void;
  /**
   * Structuring took longer than 4s. The raw text is saved as a draft and
   * structured in the background (PRD 01 §5.3) — the user is never left
   * watching a spinner decide their fate.
   */
  onDegrade: (input: QuickCaptureSubmit) => void;
}

type Phase = 'raw' | 'structuring' | 'structured';

type DatePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'pick';

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'pick', label: 'Pick a date' },
];

function dateFor(preset: DatePreset, now: Date, picked: string): Date {
  switch (preset) {
    case 'yesterday':
      return new Date(now.getTime() - DAY_MS);
    case 'this-week':
      return new Date(now.getTime() - 3 * DAY_MS);
    case 'last-week':
      return new Date(now.getTime() - 10 * DAY_MS);
    case 'pick':
      return picked ? new Date(`${picked}T00:00:00.000Z`) : now;
    default:
      return now;
  }
}

/**
 * Quick capture — design/02 §D.
 *
 * The textarea never clears and the popover never navigates: structuring
 * happens in place, under the words the user just typed. Anything that makes
 * the note disappear before it is saved teaches people not to trust the box.
 */
export function QuickCapture({
  open,
  onOpenChange,
  now,
  onStructure,
  onSubmit,
  onDegrade,
}: QuickCaptureProps) {
  const [phase, setPhase] = React.useState<Phase>('raw');
  const [text, setText] = React.useState('');
  const [draft, setDraft] = React.useState<DraftStructure | null>(null);
  const [preset, setPreset] = React.useState<DatePreset>('today');
  const [picked, setPicked] = React.useState('');
  const [sensitivity, setSensitivity] = React.useState<WinView['sensitivity']>('shareable');
  const [quantity, setQuantity] = React.useState('');

  const idleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards a resolved structure landing after the 4s degrade already fired. */
  const abandoned = React.useRef(false);

  const clearTimers = React.useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (degradeTimer.current) clearTimeout(degradeTimer.current);
    idleTimer.current = null;
    degradeTimer.current = null;
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const reset = React.useCallback(() => {
    clearTimers();
    abandoned.current = false;
    setPhase('raw');
    setText('');
    setDraft(null);
    setPreset('today');
    setPicked('');
    setSensitivity('shareable');
    setQuantity('');
  }, [clearTimers]);

  const payload = React.useCallback(
    (): QuickCaptureSubmit => ({
      text,
      title: draft?.title,
      narrative: draft?.narrative,
      category: draft?.category,
      occurredAt: dateFor(preset, now, picked),
      sensitivity,
      quantity: quantity.trim() || undefined,
      draft: draft ?? undefined,
    }),
    [text, draft, preset, now, picked, sensitivity, quantity],
  );

  const runStructure = React.useCallback(() => {
    clearTimers();
    if (phase !== 'raw' || text.trim().length < MIN_CHARS) return;

    setPhase('structuring');
    abandoned.current = false;

    degradeTimer.current = setTimeout(() => {
      abandoned.current = true;
      onDegrade(payload());
      onOpenChange(false);
      reset();
    }, DEGRADE_MS);

    void onStructure(text).then((result) => {
      if (abandoned.current) return;
      clearTimers();
      if (!result) {
        setPhase('raw');
        return;
      }
      setDraft(result);
      setPhase('structured');
    });
  }, [clearTimers, phase, text, onStructure, onDegrade, onOpenChange, payload, reset]);

  function handleTextChange(next: string) {
    setText(next);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => runStructure(), IDLE_MS);
  }

  const canSubmit = text.trim().length > 0 && phase !== 'structuring';

  const submit = React.useCallback(() => {
    if (!canSubmit) return;
    onSubmit(payload());
    onOpenChange(false);
    reset();
  }, [canSubmit, onSubmit, payload, onOpenChange, reset]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm">
          <Plus aria-hidden="true" />
          Log a win
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-24px)] space-y-3 p-4"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <p className={cn(typeStyles.caption, 'uppercase tracking-[0.08em] text-muted-foreground')}>
          Log a win
        </p>

        {phase === 'raw' ? (
          <Textarea
            autoFocus
            value={text}
            aria-label="What happened?"
            placeholder={'What happened? Rough notes are fine — "fixed the checkout timeout thing, latency way down"'}
            rows={4}
            onChange={(event) => handleTextChange(event.target.value)}
            onBlur={runStructure}
            className={cn(typeStyles.body, 'resize-none')}
          />
        ) : null}

        {phase === 'structuring' ? <StructuringShimmer /> : null}

        {phase === 'structured' && draft ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Sparkles
                aria-hidden="true"
                className="mt-1.5 size-3.5 shrink-0 text-primary"
                strokeWidth={1.5}
              />
              <input
                value={draft.title}
                aria-label="Title"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className={cn(
                  typeStyles.h3,
                  'w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-foreground outline-none',
                  'hover:border-border focus:border-primary/50',
                )}
              />
            </div>
            <textarea
              value={draft.narrative}
              aria-label="Narrative"
              rows={3}
              onChange={(event) => setDraft({ ...draft, narrative: event.target.value })}
              className={cn(
                typeStyles.body,
                'w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-muted-foreground outline-none',
                'hover:border-border focus:border-primary/50',
              )}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'structured' && draft ? (
            <Select
              value={draft.category}
              onValueChange={(next) => setDraft({ ...draft, category: next as WinCategoryValue })}
            >
              <SelectTrigger aria-label="Category" className="h-7 w-auto gap-1.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WIN_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATEGORY_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select value={preset} onValueChange={(next) => setPreset(next as DatePreset)}>
            <SelectTrigger aria-label="When" className="h-7 w-auto gap-1.5 text-xs">
              <Calendar aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {preset === 'pick' ? (
            <Input
              type="date"
              aria-label="Pick a date"
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              className="num h-7 w-auto text-xs"
            />
          ) : null}

          <Select
            value={sensitivity}
            onValueChange={(next) => setSensitivity(next as WinView['sensitivity'])}
          >
            <SelectTrigger aria-label="Sensitivity" className="h-7 w-auto gap-1.5 text-xs">
              {sensitivity === 'shareable' ? (
                <LockOpen aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              ) : (
                <Lock aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shareable">Shareable</SelectItem>
              <SelectItem value="internal_only">Internal only</SelectItem>
              <SelectItem value="confidential">Confidential</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {phase === 'structured' && draft?.quantifyPrompt ? (
          <div className="flex items-center gap-2">
            <label htmlFor="capture-quantity" className={cn(typeStyles.small, 'shrink-0 text-foreground')}>
              {draft.quantifyPrompt}
            </label>
            <Input
              id="capture-quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-8 min-w-0 flex-1 text-sm"
            />
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          {phase === 'structured' ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
            Log it
            <span aria-hidden="true" className={cn(typeStyles.caption, 'opacity-70')}>
              ⌘↵
            </span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Three lines, not a spinner.
 *
 * A shimmer in the shape of the result tells the user what is coming; a
 * spinner tells them only that something is happening to them.
 */
function StructuringShimmer() {
  return (
    <div className="space-y-2 py-1">
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-4 w-[60%]" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[74%]" />
      </div>
      <span role="status" className="sr-only">
        Structuring your note
      </span>
    </div>
  );
}
