'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

/**
 * Preferences failed to load.
 *
 * The reassurance matters more than the retry button: a user who arrived here
 * from "Change when you get this" is usually trying to turn something OFF, and
 * an error screen reads as "you cannot". Say plainly that the unsubscribe link
 * in the email still works, because it does — it is a separate route with no
 * dependency on this page.
 */
export default function NotificationsError({
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
        <div className="mx-auto w-full max-w-2xl space-y-4 px-6 py-16">
            <h1 className="text-2xl font-semibold tracking-tight">We could not load your preferences</h1>
            <p className="text-sm text-muted-foreground">
                Nothing changed. If you are trying to stop an email, the unsubscribe link at the bottom of it still
                works on its own and takes effect immediately.
            </p>
            <Button onClick={reset}>Try again</Button>
        </div>
    );
}
