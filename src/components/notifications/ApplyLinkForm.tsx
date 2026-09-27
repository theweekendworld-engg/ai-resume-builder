'use client';

import { useState, useTransition } from 'react';
import { applyFromDigestLink, type ApplyFromLinkResult } from '@/actions/digest';
import { UndoForm } from '@/components/notifications/UndoForm';

/**
 * The one tap that applies a digest link. The GET only shows the Win; this
 * button is the write, so a mail scanner opening the link changes nothing.
 */
export function ApplyLinkForm({ token, action }: { token: string; action: 'confirm' | 'dismiss' }) {
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<ApplyFromLinkResult | null>(null);

    if (result?.status === 'done') {
        return (
            <div className="mt-6">
                <p className="text-lg font-semibold text-foreground">{result.confirmed ? '✓  Logged' : 'Marked as not a win'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {result.replay
                        ? result.confirmed ? 'You had already logged this one.' : 'You had already marked this as not a win.'
                        : result.confirmed ? 'It is in your record now.' : 'It will not show up in your log.'}
                </p>
                <div className="mt-4 text-sm text-muted-foreground">
                    <span>Tapped by mistake? </span>
                    <UndoForm token={token} />
                </div>
            </div>
        );
    }

    return (
        <div className="mt-6">
            <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(async () => setResult(await applyFromDigestLink(token)))}
                className="inline-flex h-12 min-w-[240px] items-center justify-center rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground disabled:opacity-60"
            >
                {pending ? 'Saving…' : action === 'confirm' ? 'Yes, log this win' : 'Not a win'}
            </button>
            {result?.status === 'error' ? <p className="mt-3 text-sm text-destructive">{result.message}</p> : null}
        </div>
    );
}
