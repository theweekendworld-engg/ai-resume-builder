'use client';

import * as React from 'react';
import { useClerk } from '@clerk/nextjs';

import { Button } from '@/components/ui/button';
import { deleteMyAccount } from '@/actions/account';

/** Permanent. Spells out what goes, and asks for a typed confirmation. */
export function DeleteAccountSection() {
    const { signOut } = useClerk();
    const [open, setOpen] = React.useState(false);
    const [confirm, setConfirm] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const run = async () => {
        setBusy(true);
        setError(null);
        const result = await deleteMyAccount({ confirm });
        if (!result.success) {
            setBusy(false);
            setError(result.error);
            return;
        }
        await signOut({ redirectUrl: '/' });
    };

    return (
        <section className="mt-8 rounded-xl border border-destructive/30 bg-card p-5">
            <h2 className="text-sm font-medium text-foreground">Delete account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Deletes your Work Log, evidence, resumes and PDFs, jobs, chat history, linked Telegram and WhatsApp,
                and your sign-in. This cannot be undone. Export first from Plan &amp; usage if you want a copy.
            </p>
            {!open ? (
                <Button variant="outline" size="sm" className="mt-3 border-destructive/40 text-destructive" onClick={() => setOpen(true)}>
                    Delete my account
                </Button>
            ) : (
                <div className="mt-3 space-y-2">
                    <label htmlFor="delete-confirm" className="block text-sm">Type <span className="font-mono font-semibold">DELETE</span> to confirm</label>
                    <input
                        id="delete-confirm"
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        className="w-48 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-base sm:text-sm"
                        autoComplete="off"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={busy || confirm !== 'DELETE'} onClick={() => void run()}>
                            {busy ? 'Deleting…' : 'Delete everything'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setConfirm(''); }}>
                            Cancel
                        </Button>
                    </div>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
            )}
        </section>
    );
}
