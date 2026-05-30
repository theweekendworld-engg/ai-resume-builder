import { useEffect, useState } from 'react';
import { Undo2, Check } from 'lucide-react';

const TOAST_TTL_MS = 30_000;

export function FillUndoToast({
    appliedCount,
    onUndo,
    onDismiss,
    keyId,
}: {
    appliedCount: number;
    onUndo: () => void;
    onDismiss: () => void;
    keyId: string;
}) {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        setVisible(true);
        const id = window.setTimeout(() => {
            setVisible(false);
            onDismiss();
        }, TOAST_TTL_MS);
        return () => window.clearTimeout(id);
    }, [keyId, onDismiss]);

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
