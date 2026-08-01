'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Lock, LockOpen, X, Zap } from 'lucide-react';

import type { WinPatch, WinView } from '@/actions/wins.types';
import {
  CATEGORY_META,
  GroundChip,
  SourceChip,
  WIN_CATEGORIES,
  focusRing,
  formatWinDate,
  typeStyles,
  type WinCategoryValue,
} from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { impactSentence, toSourceRef } from './adapt';
import { EditableText } from './EditableText';

const UNATTRIBUTED = '__none__';

const SENSITIVITY_LABEL: Record<WinView['sensitivity'], string> = {
  shareable: 'Shareable',
  internal_only: 'Internal only',
  confidential: 'Confidential',
};

export interface WinDrawerProps {
  win: WinView | null;
  open: boolean;
  employers: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onPatch: (winId: string, patch: WinPatch) => void;
  onAddImpact: (winId: string, answer: string) => void;
  onSkipQuantify: (winId: string) => void;
  onGroundConfirm: (winId: string, source: string) => void | Promise<void>;
  onArchive: (winId: string) => void;
  onDelete: (winId: string) => void;
}

/**
 * The Win drawer — design/02 §C.
 *
 * A drawer, not a route. Navigating to `/log/[id]` would throw away the list
 * scroll position, and someone three years deep in their record who loses
 * their place after fixing one date does not come back.
 *
 * `modal={false}` on purpose: the log behind stays scrollable and clickable,
 * so clicking the next Win swaps the drawer instead of forcing a close first.
 * That also means no scroll lock, which is the mechanism that preserves the
 * scroll position in the first place.
 */
export function WinDrawer({
  win,
  open,
  employers,
  onOpenChange,
  onPatch,
  onAddImpact,
  onSkipQuantify,
  onGroundConfirm,
  onArchive,
  onDelete,
}: WinDrawerProps) {
  return (
    <DialogPrimitive.Root open={open && win !== null} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the panel, not the first control: auto-focusing the title
            // editor would put a caret in the user's own words the instant the
            // drawer opens.
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          }}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-popover text-popover-foreground shadow-lg outline-none',
            'sm:w-[480px] sm:border-l sm:border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
            'data-[state=open]:duration-[220ms] data-[state=closed]:duration-[160ms]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {win ? `Win: ${win.title}` : 'Win'}
          </DialogPrimitive.Title>
          {win ? (
            <DrawerBody
              win={win}
              employers={employers}
              onPatch={onPatch}
              onAddImpact={onAddImpact}
              onSkipQuantify={onSkipQuantify}
              onGroundConfirm={onGroundConfirm}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */

function DrawerBody({
  win,
  employers,
  onPatch,
  onAddImpact,
  onSkipQuantify,
  onGroundConfirm,
  onArchive,
  onDelete,
}: Omit<WinDrawerProps, 'open' | 'onOpenChange' | 'win'> & { win: WinView }) {
  const category = CATEGORY_META[win.category as WinCategoryValue];
  const CategoryIcon = category.icon;
  const confidential = win.sensitivity === 'confidential';

  return (
    <>
      {/* Sticky header: on a phone this is a full-screen sheet and the close
          control has to stay reachable without scrolling back up. */}
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-popover px-5 py-4">
        <div className={cn(typeStyles.caption, 'flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-muted-foreground')}>
          <span className="inline-flex items-center gap-1">
            <CategoryIcon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
            {category.label}
          </span>
          {win.employerName ? (
            <>
              <Dot />
              <span className="truncate">{win.employerName}</span>
            </>
          ) : null}
          <Dot />
          <span className="num">{formatWinDate(win.occurredAt)}</span>
          {win.status === 'draft' ? (
            <>
              <Dot />
              <span className="text-info">Draft</span>
            </>
          ) : null}
        </div>

        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground',
            'transition-colors duration-[120ms] ease-out hover:bg-secondary hover:text-foreground',
            focusRing,
          )}
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.5} />
        </DialogPrimitive.Close>
      </header>

      <div
        className={cn(
          'flex-1 space-y-6 overflow-y-auto px-5 py-5',
          confidential && 'border-l-2 border-warning',
        )}
      >
        <div className="space-y-2">
          <EditableText
            label="Title"
            value={win.title}
            required
            multiline
            onSave={(title) => onPatch(win.id, { title })}
            className={cn(typeStyles.h2, 'text-foreground')}
          />
          <EditableText
            label="Narrative"
            value={win.narrative}
            multiline
            placeholder="What happened, and why it mattered"
            onSave={(narrative) => onPatch(win.id, { narrative })}
            className={cn(typeStyles.body, 'text-muted-foreground')}
          />
        </div>

        <Section label="Impact">
          {win.impact ? (
            <p className={cn(typeStyles.small, 'flex items-center gap-2 px-2 text-foreground')}>
              <Zap aria-hidden="true" className="size-3.5 shrink-0 text-info" strokeWidth={1.5} />
              <span>{win.impact.metric}</span>
              <span className="num font-medium">{impactSentence(win.impact)}</span>
            </p>
          ) : (
            <QuantifyPrompt
              prompt={win.quantifyPrompt ?? 'How big was the impact?'}
              onAdd={(answer) => onAddImpact(win.id, answer)}
              onSkip={() => onSkipQuantify(win.id)}
            />
          )}
        </Section>

        <Section label="Evidence">
          {win.evidence.length > 0 ? (
            <ul className="space-y-2 px-2">
              {win.evidence.map((evidence) => {
                const source = toSourceRef(evidence);
                return (
                  <li key={evidence.id} className="space-y-1">
                    <SourceChip source={source} />
                    {evidence.excerpt ? (
                      <p className={cn(typeStyles.mono, 'text-muted-foreground')}>
                        “{evidence.excerpt}”
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={cn(typeStyles.small, 'px-2 text-muted-foreground')}>
              Nothing backs this one yet.
            </p>
          )}

          <div className="px-2 pt-1">
            <GroundChip
              state={win.groundState}
              claim={win.title}
              backedBy={win.evidence[0] ? toSourceRef(win.evidence[0]).label : undefined}
              excerpt={win.evidence[0]?.excerpt}
              onConfirm={(source) => onGroundConfirm(win.id, source)}
            />
          </div>
        </Section>

        <Section label="Details">
          <dl className="space-y-2">
            <DetailRow label="Employer">
              <Select
                value={win.employerId ?? UNATTRIBUTED}
                onValueChange={(next) =>
                  onPatch(win.id, { employerId: next === UNATTRIBUTED ? null : next })
                }
              >
                <SelectTrigger aria-label="Employer" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {employers.map((employer) => (
                    <SelectItem key={employer.id} value={employer.id}>
                      {employer.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNATTRIBUTED}>No employer</SelectItem>
                </SelectContent>
              </Select>
            </DetailRow>

            <DetailRow label="Date">
              <Input
                type="date"
                aria-label="Date"
                className="num h-9"
                value={win.occurredAt.toISOString().slice(0, 10)}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next) onPatch(win.id, { occurredAt: new Date(`${next}T00:00:00.000Z`) });
                }}
              />
            </DetailRow>

            <DetailRow label="Category">
              <Select
                value={win.category}
                onValueChange={(next) =>
                  onPatch(win.id, { category: next as WinView['category'] })
                }
              >
                <SelectTrigger aria-label="Category" className="h-9 text-sm">
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
            </DetailRow>

            <DetailRow label="Sensitivity">
              <SensitivityControl
                value={win.sensitivity}
                onChange={(sensitivity) => onPatch(win.id, { sensitivity })}
              />
            </DetailRow>

            <DetailRow label="Skills">
              <SkillEditor
                skills={win.skills}
                onChange={(skills) => onPatch(win.id, { skills })}
              />
            </DetailRow>
          </dl>
        </Section>

        <Section label="">
          <div className={cn(typeStyles.caption, 'space-y-1 px-2 text-muted-foreground')}>
            {win.source !== 'manual' && win.evidence[0] ? (
              <p>
                Drafted from {toSourceRef(win.evidence[0]).label} on{' '}
                <span className="num">{formatWinDate(win.createdAt)}</span>
              </p>
            ) : (
              <p>
                Logged by you on <span className="num">{formatWinDate(win.createdAt)}</span>
              </p>
            )}
            {win.confirmedAt ? (
              <p>
                Confirmed by you on <span className="num">{formatWinDate(win.confirmedAt)}</span>
              </p>
            ) : null}
          </div>
        </Section>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <Button type="button" variant="outline" size="sm" onClick={() => onArchive(win.id)}>
          Archive
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          onClick={() => onDelete(win.id)}
        >
          Delete
        </Button>
      </footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Dot() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/50">
      ·
    </span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        {label ? (
          <span
            className={cn(
              typeStyles.caption,
              'shrink-0 uppercase tracking-[0.08em] text-muted-foreground',
            )}
          >
            {label}
          </span>
        ) : null}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className={cn(typeStyles.caption, 'w-[10ch] shrink-0 text-muted-foreground')}>{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/**
 * The quantify prompt — the highest-leverage interaction in the drawer.
 *
 * One question, already written by the model, and a single field. Skip is a
 * real option at equal weight: a prompt you cannot dismiss is a prompt people
 * learn to close the drawer to escape.
 */
function QuantifyPrompt({
  prompt,
  onAdd,
  onSkip,
}: {
  prompt: string;
  onAdd: (answer: string) => void;
  onSkip: () => void;
}) {
  const [answer, setAnswer] = React.useState('');

  function submit() {
    const value = answer.trim();
    if (!value) return;
    onAdd(value);
    setAnswer('');
  }

  return (
    <div className="space-y-2 px-2">
      <div className="flex items-center gap-2">
        <label
          htmlFor="quantify-answer"
          className={cn(typeStyles.small, 'shrink-0 text-foreground')}
        >
          {prompt}
        </label>
        <Input
          id="quantify-answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          className="h-9 min-w-0 flex-1"
        />
        <Button type="button" size="sm" variant="secondary" onClick={submit} disabled={!answer.trim()}>
          Add
        </Button>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className={cn(
          typeStyles.caption,
          focusRing,
          'rounded-sm text-muted-foreground hover:text-foreground hover:underline',
        )}
      >
        Skip
      </button>
    </div>
  );
}

/**
 * Sensitivity, with the inline confirm §C requires on the way to
 * `confidential`. It is a consequence, not a warning: the user is told exactly
 * where the Win will and will not appear, then decides.
 */
function SensitivityControl({
  value,
  onChange,
}: {
  value: WinView['sensitivity'];
  onChange: (next: WinView['sensitivity']) => void;
}) {
  const [pending, setPending] = React.useState<WinView['sensitivity'] | null>(null);

  return (
    <div className="space-y-2">
      <Select
        value={value}
        onValueChange={(next) => {
          const sensitivity = next as WinView['sensitivity'];
          if (sensitivity === 'confidential' && value !== 'confidential') {
            setPending(sensitivity);
            return;
          }
          setPending(null);
          onChange(sensitivity);
        }}
      >
        <SelectTrigger aria-label="Sensitivity" className="h-9 text-sm">
          <span className="flex items-center gap-2">
            {value === 'shareable' ? (
              <LockOpen aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
            ) : (
              <Lock
                aria-hidden="true"
                className={cn('size-3.5', value === 'confidential' && 'text-warning')}
                strokeWidth={1.5}
                fill={value === 'confidential' ? 'currentColor' : 'none'}
              />
            )}
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SENSITIVITY_LABEL) as Array<WinView['sensitivity']>).map((option) => (
            <SelectItem key={option} value={option}>
              {SENSITIVITY_LABEL[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pending ? (
        <div className="rounded-lg border border-warning/30 bg-warning/8 p-2">
          <p className={cn(typeStyles.small, 'text-foreground')}>
            This won&apos;t appear on resumes or cover letters. It stays in review packets.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onChange(pending);
                setPending(null);
              }}
            >
              Make it confidential
            </Button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className={cn(
                typeStyles.caption,
                focusRing,
                'rounded-sm text-muted-foreground hover:text-foreground hover:underline',
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SkillEditor({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  function add() {
    const value = draft.trim().toLowerCase();
    setDraft('');
    setAdding(false);
    if (!value || skills.includes(value)) return;
    onChange([...skills, value]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {skills.map((skill) => (
        <span
          key={skill}
          className={cn(
            typeStyles.caption,
            'inline-flex h-5 items-center gap-1 rounded-full bg-secondary px-2 text-secondary-foreground',
          )}
        >
          {skill}
          <button
            type="button"
            aria-label={`Remove skill: ${skill}`}
            onClick={() => onChange(skills.filter((entry) => entry !== skill))}
            className={cn(focusRing, 'rounded-full text-muted-foreground hover:text-foreground')}
          >
            <X aria-hidden="true" className="size-3" strokeWidth={1.5} />
          </button>
        </span>
      ))}

      {adding ? (
        <input
          autoFocus
          value={draft}
          aria-label="New skill"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft('');
              setAdding(false);
            }
          }}
          className={cn(
            typeStyles.caption,
            'h-5 w-24 rounded-full border border-primary/50 bg-secondary/30 px-2 outline-none',
          )}
        />
      ) : (
        <button
          type="button"
          aria-label="Add a skill"
          onClick={() => setAdding(true)}
          className={cn(
            typeStyles.caption,
            focusRing,
            'inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-muted-foreground hover:text-foreground',
          )}
        >
          +
        </button>
      )}
    </div>
  );
}
