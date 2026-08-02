import { useEffect, useState } from 'react';
import { Undo2, Check } from 'lucide-react';

const TOAST_TTL_MS = 30_000;

/**
 * The "filled N fields — undo?" toast.
 *
 * Resetting on a new fill is the caller's job, via React's own `key`. This
 * used to take a `keyId` prop and re-show itself by calling `setVisible(true)`
 * inside an effect keyed on it, which is a synchronous setState during commit
 * — a cascading render, and flagged as such by react-hooks/set-state-in-effect.
 *
 * Remounting does the same work correctly: `useState(true)` is already the
 * fresh-toast state, so there is nothing to set.
 */
export function FillUndoToast({
    appliedCount,
    onUndo,
    onDismiss,
}: {
    appliedCount: number;
    onUndo: () => void;
    onDismiss: () => void;
}) {
    const [visible, setVisible] = useState(true);

    // `onDismiss` must be referentially stable or this timer restarts on every
    // parent render and the toast outlives its own TTL for as long as anything
    // else on the panel moves. The caller wraps it in useCallback.
    useEffect(() => {
        const id = window.setTimeout(() => {
            setVisible(false);
            onDismiss();
        }, TOAST_TTL_MS);
        return () => window.clearTimeout(id);
    }, [onDismiss]);

    if (!visible || appliedCount <= 0) return null;

    return (
        <div className="card flex items-center gap-2 border-success/40 bg-success/5 p-2 text-xs">
            <Check className="h-4 w-4 text-success" />
            <span className="flex-1">
                Filled {appliedCount} field{appliedCount === 1 ? '' : 's'}.
            </span>
            <button
                type="button"
                onClick={() => {
                    setVisible(false);
                    onUndo();
                }}
                className="btn-outline text-[11px]"
            >
                <Undo2 className="h-3 w-3" />
                Undo
            </button>
        </div>
    );
}
