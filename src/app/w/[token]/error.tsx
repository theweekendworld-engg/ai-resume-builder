'use client';

import * as React from 'react';

/**
 * The magic link crashed outright — a database outage, not a bad token. An
 * invalid, expired or already-used token is a normal render in `page.tsx` and
 * never reaches here.
 *
 * The copy's only job is to stop the user thinking their win was lost. It was
 * not: the draft is in the log either way, and this page says so before it says
 * anything about retrying.
 */
export default function MagicLinkError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    React.useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
            <div className="w-full max-w-md text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Patronus</p>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">That did not go through</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                    Nothing was lost — the win is still sitting in your log, waiting for you either way.
                </p>
                <div className="mt-8 flex flex-col items-center gap-3">
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex h-11 min-w-[200px] items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground"
                    >
                        Try again
                    </button>
                    <a href="/log" className="text-sm text-muted-foreground underline underline-offset-2">
                        Open your log instead
                    </a>
                </div>
            </div>
        </main>
    );
}
