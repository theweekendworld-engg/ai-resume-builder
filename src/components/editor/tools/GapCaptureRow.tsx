'use client';

import * as React from 'react';
import { Check, Loader2, Minus, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { captureEvidenceForGap, dismissGap } from '@/actions/gapCapture';
import { questionForRequirement } from '@/lib/resume/gapQuestion';

/**
 * An unanswered requirement you can actually do something about.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * A read-only line that said "Nothing on your resume answers: 'Experience
 * mentoring engineers'" — to a person looking straight at it, who very often
 * HAS done that, and who had no way to say so. The single most useful insight
 * the product generates was rendered and then discarded, and the same posting
 * produced the same gap next month.
 *
 * ── Why it asks for a story rather than a yes ───────────────────────────────
 *
 * "Do you have experience with X?" invites a claim; the product cannot use a
 * claim. `questionForRequirement` asks for one instance — situation, action,
 * outcome — because that is what becomes a Win, and a Win is the only thing
 * the next resume can draw on.
 *
 * ── Why nothing is added to this resume ─────────────────────────────────────
 *
 * The Win lands as a DRAFT and must be confirmed in the Work Log like any
 * other. `Evidence(confirmedByUser)` is the moat write, and typing an answer
 * into a resume panel is not consent to put a claim on a document. So the copy
 * promises exactly what happens: it goes to your log, you confirm it, the next
 * resume can use it.
 */

type Item = { text: string; kind: 'must' | 'nice' | 'responsibility'; byDates: boolean };

type State =
    | { name: 'idle' }
    | { name: 'writing' }
    | { name: 'saving' }
    | { name: 'saved'; title: string }
    | { name: 'dismissed' };

export function GapCaptureRow({ item, resumeId }: { item: Item; resumeId?: string }) {
    const [state, setState] = React.useState<State>({ name: 'idle' });
    const [answer, setAnswer] = React.useState('');
    const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

    React.useEffect(() => {
        if (state.name === 'writing') inputRef.current?.focus();
    }, [state.name]);

    const save = async () => {
        setState({ name: 'saving' });
        const result = await captureEvidenceForGap({
            requirement: item.text,
            answer,
            resumeId,
        });
        if (!result.success) {
            toast.error(result.error);
            setState({ name: 'writing' });
            return;
        }
        setState({ name: 'saved', title: result.data.title });
        setAnswer('');
    };

    const skip = async () => {
        // Optimistic: the row is gone from their view either way, and a failed
        // telemetry write is not worth showing anyone.
        setState({ name: 'dismissed' });
        await dismissGap({ requirement: item.text });
    };

    if (state.name === 'dismissed') return null;

    if (state.name === 'saved') {
        return (
            <li className="flex items-start gap-2.5 py-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{state.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Saved to your Work Log as a draft. Confirm it there and the next resume can
                        use it — this one is unchanged.
                    </p>
                </div>
            </li>
        );
    }

    return (
        <li className="py-2">
            <div className="flex items-start gap-2.5">
                <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                        {item.text}
                        <span className="sr-only"> — not answered</span>
                    </p>

                    {state.name === 'idle' ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary"
                                onClick={() => setState({ name: 'writing' })}
                            >
                                <Plus className="size-3.5" aria-hidden />
                                I have done this
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                                onClick={() => void skip()}
                            >
                                <X className="size-3.5" aria-hidden />
                                Not me
                            </Button>
                        </div>
                    ) : null}
                </div>

                {item.kind === 'nice' ? (
                    <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                        bonus
                    </Badge>
                ) : null}
            </div>

            {state.name === 'writing' || state.name === 'saving' ? (
                <div className="ml-[26px] mt-2 rounded-md border border-border bg-card p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {questionForRequirement(item.text)}
                    </p>
                    <Textarea
                        ref={inputRef}
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        rows={3}
                        disabled={state.name === 'saving'}
                        className="mt-2 text-sm"
                        placeholder="Two lines is plenty. What you did, and what changed because of it."
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={state.name === 'saving' || answer.trim().length < 25}
                            onClick={() => void save()}
                        >
                            {state.name === 'saving' ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : null}
                            Save to my log
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            disabled={state.name === 'saving'}
                            onClick={() => setState({ name: 'idle' })}
                        >
                            Cancel
                        </Button>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            Goes to your log as a draft — nothing is added to this resume
                        </span>
                    </div>
                </div>
            ) : null}
        </li>
    );
}
