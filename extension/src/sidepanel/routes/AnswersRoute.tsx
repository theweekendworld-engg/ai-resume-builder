import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Pencil, RefreshCw, Trash2, Zap, ZapOff } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { request } from '@/background/messageBus';
import { trackExtensionEvent } from '@/shared/lib/telemetry';
import type { SavedAnswerWire } from '@/shared/types/messages';

/**
 * The saved-answer library.
 *
 * Answers land here whenever a user ticks "save for reuse" while drafting in
 * Apply, and they are matched to future questions by FINGERPRINT rather than
 * exact text — so one saved answer serves both "Why do you want to work here?"
 * and "What draws you to this role?". That matching is the most useful thing
 * the extension does, and until this screen existed it was also the least
 * visible: an answer could fill itself into a form with nowhere for the user
 * to find it, correct it, or switch it off.
 *
 * So the screen is organised around trust, not volume:
 *   • auto-use answers sort first — those are the ones acting on your behalf
 *     without asking each time;
 *   • usage count is stated plainly, because "used on 7 applications" is what
 *     turns a hidden cache into an asset the user feels ownership of;
 *   • the question shown is the CANONICAL one the answer was saved against,
 *     which is the only way to reason about why it fired somewhere surprising.
 */
export function AnswersRoute() {
    const [answers, setAnswers] = useState<SavedAnswerWire[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftText, setDraftText] = useState('');
    /** Ids with a write in flight, so one row can disable itself alone. */
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

    const setBusy = useCallback((id: string, busy: boolean) => {
        setBusyIds((prev) => {
            const next = new Set(prev);
            if (busy) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    /**
     * Fetch and store. Deliberately does NOT flip `loading` on the way in —
     * `loading` already starts true, so the mount path has nothing to set, and
     * setting it synchronously from the effect below would cost a cascading
     * render to reach the state the component was born in. `reload` adds that
     * back for the callers that need it.
     */
    const load = useCallback(async () => {
        const res = await request<{ answers?: SavedAnswerWire[] }>({ type: 'LIST_ANSWERS' });
        setLoading(false);
        if (!res.ok) {
            setError(
                res.error === 'not_authenticated'
                    ? 'Connect your account in Settings to see your saved answers.'
                    : 'Could not load your saved answers.',
            );
            return;
        }
        setAnswers(res.data?.answers ?? []);
    }, []);

    /** Refetch from an event handler, where showing the spinner again is right. */
    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        await load();
    }, [load]);

    useEffect(() => {
        // Nothing lands during this commit — `load` awaits the message round
        // trip before it sets anything. The lint rule traces into the callee
        // but not past the await.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        trackExtensionEvent('answers.opened', {});
    }, [load]);

    const handleToggleAutoUse = async (answer: SavedAnswerWire) => {
        const next = !answer.autoUse;
        setBusy(answer.id, true);
        // Optimistic: flipping the switch IS the interaction, and waiting a
        // round trip to see it move reads as broken.
        setAnswers((prev) => prev.map((a) => (a.id === answer.id ? { ...a, autoUse: next } : a)));

        const res = await request<{ answer?: SavedAnswerWire }>({
            type: 'UPDATE_ANSWER',
            answerId: answer.id,
            autoUse: next,
        });
        setBusy(answer.id, false);

        if (!res.ok) {
            // Roll back to what the server still believes.
            setAnswers((prev) =>
                prev.map((a) => (a.id === answer.id ? { ...a, autoUse: answer.autoUse } : a)),
            );
            setError('Could not change auto-fill. Your answer is unchanged.');
            return;
        }
        setError(null);
        trackExtensionEvent('answers.auto_use_toggled', { enabled: next });
    };

    const handleSaveEdit = async (answer: SavedAnswerWire) => {
        const text = draftText.trim();
        if (!text || text === answer.answerText) {
            setEditingId(null);
            return;
        }

        setBusy(answer.id, true);
        const res = await request<{ answer?: SavedAnswerWire }>({
            type: 'UPDATE_ANSWER',
            answerId: answer.id,
            answerText: text,
        });
        setBusy(answer.id, false);

        if (!res.ok) {
            setError('Could not save your edit.');
            return;
        }
        setAnswers((prev) => prev.map((a) => (a.id === answer.id ? { ...a, answerText: text } : a)));
        setEditingId(null);
        setError(null);
        trackExtensionEvent('answers.edited', {});
    };

    const handleDelete = async (answer: SavedAnswerWire) => {
        setBusy(answer.id, true);
        const res = await request({ type: 'DELETE_ANSWER', answerId: answer.id });
        setBusy(answer.id, false);

        if (!res.ok) {
            setError('Could not delete that answer.');
            return;
        }
        setAnswers((prev) => prev.filter((a) => a.id !== answer.id));
        setError(null);
        trackExtensionEvent('answers.deleted', {});
    };

    if (loading) {
        return (
            <div className="card flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your saved answers…
            </div>
        );
    }

    const autoCount = answers.filter((a) => a.autoUse).length;

    return (
        <div className="space-y-2">
            <section className="card p-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">Saved answers</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {answers.length} saved{autoCount > 0 ? ` · ${autoCount} auto` : ''}
                    </span>
                </div>
                {answers.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                        Answers set to auto-fill are entered for you on matching questions.
                    </p>
                ) : null}
            </section>

            {error ? (
                <div className="card flex items-center gap-2 p-3 text-xs text-destructive">
                    <span className="flex-1">{error}</span>
                    {/* An error with no way out is a dead end; the failure is
                        usually a sleeping service worker and a retry fixes it.
                        No busy state on the button — `reload` sets `loading`,
                        and the early return above replaces this whole card with
                        the full-panel spinner. */}
                    <button
                        type="button"
                        onClick={() => void reload()}
                        className="btn-outline shrink-0 text-[11px]"
                    >
                        <RefreshCw className="h-3 w-3" />
                        Try again
                    </button>
                </div>
            ) : null}

            {answers.length === 0 && !error ? (
                <div className="card p-4 text-sm">
                    <p className="font-medium">No saved answers yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        While drafting an answer on an application, tick{' '}
                        <span className="font-medium">Save for reuse</span>. It will appear here,
                        ready to fill itself in the next time a form asks the same thing.
                    </p>
                </div>
            ) : null}

            {answers.map((answer) => {
                const busy = busyIds.has(answer.id);
                const editing = editingId === answer.id;

                return (
                    <article key={answer.id} className={cn('card p-3', busy && 'opacity-60')}>
                        <p className="text-sm font-medium leading-snug">{answer.canonicalQuestion}</p>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span>
                                {answer.usageCount === 0
                                    ? 'Not used yet'
                                    : `Used on ${answer.usageCount} application${answer.usageCount === 1 ? '' : 's'}`}
                            </span>
                            {answer.autoUse ? (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-medium text-primary">auto-fill on</span>
                                </>
                            ) : null}
                        </div>

                        {editing ? (
                            <div className="mt-2 space-y-2">
                                <textarea
                                    className="w-full rounded border bg-transparent p-2 text-xs"
                                    rows={6}
                                    value={draftText}
                                    onChange={(e) => setDraftText(e.target.value)}
                                    aria-label="Edit saved answer"
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="btn btn-primary text-xs"
                                        disabled={busy}
                                        onClick={() => void handleSaveEdit(answer)}
                                    >
                                        Save
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost text-xs"
                                        onClick={() => setEditingId(null)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                                {answer.answerText}
                            </p>
                        )}

                        {!editing ? (
                            <div className="mt-2 flex items-center gap-1">
                                <button
                                    type="button"
                                    className="btn btn-ghost gap-1 text-xs"
                                    disabled={busy}
                                    onClick={() => void handleToggleAutoUse(answer)}
                                    // Label states what pressing DOES, not the current state.
                                    aria-label={
                                        answer.autoUse ? 'Stop auto-filling this answer' : 'Auto-fill this answer'
                                    }
                                >
                                    {answer.autoUse ? (
                                        <ZapOff className="h-3.5 w-3.5" />
                                    ) : (
                                        <Zap className="h-3.5 w-3.5" />
                                    )}
                                    {answer.autoUse ? 'Stop auto-filling' : 'Auto-fill this'}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost gap-1 text-xs"
                                    disabled={busy}
                                    onClick={() => {
                                        setEditingId(answer.id);
                                        setDraftText(answer.answerText);
                                    }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost gap-1 text-xs text-destructive"
                                    disabled={busy}
                                    onClick={() => void handleDelete(answer)}
                                    aria-label="Delete saved answer"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ) : null}
                    </article>
                );
            })}
        </div>
    );
}
