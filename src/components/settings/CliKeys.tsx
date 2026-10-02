'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createCliKey, listApiKeys, revokeCliKey, type ApiKeyView } from '@/actions/account';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Create a key (shown once), see your keys, revoke one. */
export function CliKeys({ appUrl }: { appUrl: string }) {
    const [keys, setKeys] = React.useState<ApiKeyView[] | null>(null);
    const [fresh, setFresh] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    const load = React.useCallback(() => {
        void listApiKeys().then((r) => setKeys(r.success ? r.data : []));
    }, []);
    React.useEffect(load, [load]);

    const create = async () => {
        setBusy(true);
        const r = await createCliKey({ name: 'CLI' });
        setBusy(false);
        if (!r.success) return toast.error(r.error);
        setFresh(r.data.key);
        load();
    };
    const revoke = async (id: string) => {
        const r = await revokeCliKey({ id });
        if (!r.success) return toast.error(r.error);
        toast.success('Key revoked.');
        load();
    };

    return (
        <div className="space-y-3 text-sm">
            {fresh ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                    <p className="font-medium">Your new key. Copy it now: it is not shown again.</p>
                    <code className="block break-all rounded bg-background p-2 font-mono text-xs">{fresh}</code>
                    <p className="text-muted-foreground">Then, in a terminal (Node 18+):</p>
                    <code className="block break-all rounded bg-background p-2 font-mono text-xs">
                        npm i -g patronus-cli && patronus login {fresh} --url {appUrl}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(fresh); toast.success('Copied'); }}>Copy key</Button>
                </div>
            ) : null}
            {keys && keys.length > 0 ? (
                <ul className="space-y-1">
                    {keys.map((k) => (
                        <li key={k.id} className="flex items-center justify-between gap-3">
                            <span><span className="font-mono">{k.prefix}…</span> <span className="text-muted-foreground">created {day(k.createdAt)}{k.lastUsedAt ? `, used ${day(k.lastUsedAt)}` : ', never used'}</span></span>
                            <Button size="sm" variant="ghost" onClick={() => void revoke(k.id)}>Revoke</Button>
                        </li>
                    ))}
                </ul>
            ) : keys ? <p className="text-muted-foreground">No keys yet.</p> : null}
            <Button size="sm" onClick={() => void create()} disabled={busy}>Create a CLI key</Button>
        </div>
    );
}
