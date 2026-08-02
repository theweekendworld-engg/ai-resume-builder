'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { undoFromDigestLink } from '@/actions/digest';

/**
 * "Was this you? [undo]" — design/02 §K4.
 *
 * A button, not a link: the undo is a write, and a second GET-that-mutates on
 * the same page would be one too many. The user has no session here, so the
 * server action re-verifies the same token and reverses only what that token
 * did (`src/lib/winTokens.ts`).
 */
export function UndoForm({ token }: { token: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function onUndo(): void {
        setError(null);
        startTransition(async () => {
            const result = await undoFromDigestLink(token);
            if (result.status === 'error') {
                setError(result.message);
                return;
            }
            // `?undone=1` makes the reloaded page render the undone state
            // instead of re-applying the action.
            router.replace(`/w/${encodeURIComponent(token)}?undone=1`);
            router.refresh();
        });
    }

    return (
        <>
            <button
                type="button"
                onClick={onUndo}
                disabled={pending}
                className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
            >
                {pending ? 'Undoing…' : 'Undo'}
            </button>
            {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </>
    );
}
