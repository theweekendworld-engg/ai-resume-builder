'use client';

/**
 * The disconnect dialog — PRD 02 §7.2, design/02 §J1.
 *
 * Both options ship, and that is the point. Offering "delete the wins too" is
 * what makes "your wins stay yours" credible: a promise you cannot decline is
 * not a promise. The destructive option is a text link rather than a red
 * button, so it is available without being the shape of a default.
 *
 * The copy states the data consequence precisely and non-punitively, and it
 * names the actual number of wins — "your 61 logged wins" lands very differently
 * from "your wins".
 */

import * as React from 'react';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { disconnectCopy } from '@/lib/capture/consent';

export interface DisconnectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sourceName: string;
    winCount: number;
    onConfirm: (deleteWins: boolean) => void | Promise<void>;
    busy?: boolean;
}

export function DisconnectDialog({
    open,
    onOpenChange,
    sourceName,
    winCount,
    onConfirm,
    busy = false,
}: DisconnectDialogProps) {
    const copy = disconnectCopy(winCount);
    const [confirmingDestructive, setConfirmingDestructive] = React.useState(false);

    React.useEffect(() => {
        if (!open) setConfirmingDestructive(false);
    }, [open]);

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {sourceName}?</AlertDialogTitle>
                    <AlertDialogDescription>{copy.body}</AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="sm:flex-col sm:items-stretch sm:space-x-0 sm:gap-2">
                    <div className="flex justify-end gap-2">
                        <AlertDialogCancel disabled={busy}>Keep it connected</AlertDialogCancel>
                        <AlertDialogAction disabled={busy} onClick={() => void onConfirm(false)}>
                            {copy.safeCta}
                        </AlertDialogAction>
                    </div>

                    {winCount > 0 ? (
                        <div className="pt-1 text-center">
                            {confirmingDestructive ? (
                                <span className="flex items-center justify-center gap-3 text-sm">
                                    <span className="text-muted-foreground">This cannot be undone.</span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void onConfirm(true)}
                                        className="font-medium text-destructive underline underline-offset-4 disabled:opacity-50"
                                    >
                                        Delete them
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmingDestructive(false)}
                                        className="text-muted-foreground underline-offset-4 hover:underline"
                                    >
                                        Cancel
                                    </button>
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setConfirmingDestructive(true)}
                                    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-50"
                                >
                                    {copy.destructiveCta}
                                </button>
                            )}
                        </div>
                    ) : null}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
