'use client';

import * as React from 'react';

import { focusRing } from '@/components/patterns';
import { cn } from '@/lib/utils';

export interface EditableTextProps {
  value: string;
  onSave: (next: string) => void;
  /** Names the field for screen readers and for the "click to edit" hint. */
  label: string;
  multiline?: boolean;
  placeholder?: string;
  /** Typography applied identically to the display text and to the input. */
  className?: string;
  /** Trim and reject an empty save. Titles cannot be blank; narratives can. */
  required?: boolean;
}

/**
 * Click text, get an input. Blur or ⌘↵ saves; Esc reverts.
 *
 * design/02 §C is explicit that the drawer has no Edit mode and no Save
 * button: the two-step "click edit, change, click save" costs three
 * interactions for a one-word fix, and the drawer's whole job is making small
 * corrections cheap enough that people actually make them.
 *
 * The display and the editor carry the same typography class so the text does
 * not reflow on the transition — a title that jumps as you click it reads as
 * a bug even when the characters are identical.
 */
export function EditableText({
  value,
  onSave,
  label,
  multiline = false,
  placeholder,
  className,
  required = false,
}: EditableTextProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  /** Set by Esc so the blur that follows does not save the reverted draft. */
  const revertingRef = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const commit = React.useCallback(() => {
    const next = draft.trim();
    setEditing(false);
    if (required && !next) return;
    if (next !== value.trim()) onSave(next);
  }, [draft, onSave, required, value]);

  const revert = React.useCallback(() => {
    revertingRef.current = true;
    setDraft(value);
    setEditing(false);
  }, [value]);

  // Returning focus to the trigger is what keeps a keyboard user in place;
  // without it, focus lands on <body> and Tab restarts at the top of the
  // drawer. The mount pass is skipped so opening the drawer does not steal
  // focus from the panel.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!editing) triggerRef.current?.focus({ preventScroll: true });
  }, [editing]);

  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      'aria-label': label,
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(event.target.value),
      onBlur: () => {
        if (revertingRef.current) {
          revertingRef.current = false;
          return;
        }
        commit();
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Enter' && !multiline) {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          // Stop the drawer from closing: Esc reverts the field first.
          event.preventDefault();
          event.stopPropagation();
          revert();
        }
      },
      className: cn(
        'w-full resize-none rounded-md border border-primary/50 bg-secondary/30 px-2 py-1 outline-none',
        className,
      ),
    };

    return multiline ? (
      <textarea {...shared} rows={Math.max(3, Math.ceil(draft.length / 52))} />
    ) : (
      <input {...shared} type="text" />
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`${label}. Click to edit.`}
      className={cn(
        'w-full rounded-md border border-transparent px-2 py-1 text-left',
        'transition-colors duration-[120ms] ease-out hover:border-border hover:bg-secondary/40',
        focusRing,
        className,
      )}
    >
      {value || (
        <span className="text-muted-foreground">{placeholder ?? `Add ${label.toLowerCase()}`}</span>
      )}
    </button>
  );
}
