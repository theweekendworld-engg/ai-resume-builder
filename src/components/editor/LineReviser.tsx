'use client';

import * as React from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { reviseLine, type LineRevision } from '@/actions/reviseLine';

/**
 * Improve one line, by saying what you want.
 *
 * ── Why per-line and not per-description ────────────────────────────────────
 *
 * The Copilot button above rewrites the whole description: it costs a full
 * document round trip, it returns four new bullets when you wanted one changed,
 * and there is no way to keep half of it. Most editing is not "redo this", it
 * is "this one is too vague". So the unit of work is a line, the instruction is
 * the user's own words, and everything else on the page is left alone.
 *
 * ── Why a proposal, not an edit ─────────────────────────────────────────────
 *
 * Nothing is written until Accept. A suggestion you dislike costs one click to
 * discard, which is what makes it safe to try an instruction you are not sure
 * about — and trying is how anyone finds out what this can do.
 *
 * ── Why `changed: false` is not a failure ───────────────────────────────────
 *
 * Asking for "the percentage improvement" when no percentage was ever recorded
 * gets a refusal and a reason. Rendering that as a failed edit would be a lie
 * about the most valuable thing the product does — so it renders as the note,
 * in place, with no diff and no Accept button. There is nothing to accept:
 * the line was already correct.
 */

/** Most edits are one of these, and typing them each time is friction. */
const QUICK: readonly string[] = [
    'Shorter',
    'More specific',
    'Lead with the impact',
    'Less jargon',
];

export function LineReviser({
    roleId,
    line,
    onAccept,
}: {
    roleId: string;
    line: string;
    /** Replace this line with the revision. The store write happens here. */
    onAccept: (next: string) => void;
}) {
    const [open, setOpen] = React.useState(false);
    const [instruction, setInstruction] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [revision, setRevision] = React.useState<LineRevision | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const run = async (text: string) => {
        const asked = text.trim();
        if (!asked) return;
        setBusy(true);
        setRevision(null);
        const result = await reviseLine({ roleId, line, instruction: asked });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        setRevision(result.data);
    };

    const accept = () => {
        if (!revision?.changed) return;
        onAccept(revision.text);
        setRevision(null);
        setInstruction('');
        setOpen(false);
    };

    if (!open) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary"
                onClick={() => setOpen(true)}
            >
                <Sparkles className="size-3.5" aria-hidden />
                Improve this line
            </Button>
        );
    }

    return (
        <div className="rounded-md border border-border bg-card p-2.5">
            <p className="mb-2 text-xs text-muted-foreground">{line}</p>

            <div className="flex items-center gap-1.5">
                <Input
                    ref={inputRef}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void run(instruction);
                        if (event.key === 'Escape') setOpen(false);
                    }}
                    placeholder="What should change?"
                    disabled={busy}
                    className="h-8 text-sm"
                />
                <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={busy || !instruction.trim()}
                    onClick={() => void run(instruction)}
                >
                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Go'}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                >
                    <X className="size-3.5" aria-hidden />
                </Button>
            </div>

            {!revision && !busy ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {QUICK.map((quick) => (
                        <Button
                            key={quick}
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                                setInstruction(quick);
                                void run(quick);
                            }}
                        >
                            {quick}
                        </Button>
                    ))}
                </div>
            ) : null}

            {revision ? (
                <div className="mt-2.5">
                    {revision.changed ? (
                        <>
                            <p
                                className={cn(
                                    'rounded border-l-2 border-success bg-success/5 px-2.5 py-2',
                                    'text-sm text-foreground',
                                )}
                            >
                                {revision.text}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                                <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={accept}>
                                    <Check className="size-3.5" aria-hidden />
                                    Use this
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-muted-foreground"
                                    onClick={() => setRevision(null)}
                                >
                                    Discard
                                </Button>
                                <span className="ml-auto text-[11px] text-muted-foreground">
                                    {revision.note}
                                </span>
                            </div>
                        </>
                    ) : (
                        // No diff and no Accept: the line is already right, or the
                        // instruction asked for something the record cannot support.
                        // Either way there is nothing to apply.
                        <p className="rounded border-l-2 border-warning bg-warning/5 px-2.5 py-2 text-xs text-muted-foreground">
                            {revision.note}
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}
