'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { disconnectExtension, listConnectedDevices, type ConnectedDevice } from '@/actions/account';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Connected browser-extension sessions, and one button to cut them all off. */
export function ExtensionDevices() {
    const [devices, setDevices] = React.useState<ConnectedDevice[] | null>(null);
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        void listConnectedDevices().then((result) => setDevices(result.success ? result.data : []));
    }, []);

    const disconnect = async () => {
        setBusy(true);
        const result = await disconnectExtension();
        setBusy(false);
        if (!result.success) return toast.error(result.error);
        toast.success(result.data.revoked ? 'The extension is signed out everywhere.' : 'Nothing was connected.');
        setDevices([]);
    };

    if (devices === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (devices.length === 0) {
        return <p className="text-sm text-muted-foreground">Not connected. Install the Patronus extension and click Connect in it.</p>;
    }
    return (
        <div className="space-y-3">
            <ul className="space-y-1 text-sm">
                {devices.map((d) => (
                    <li key={d.id}>
                        Connected {day(d.createdAt)}
                        {d.lastUsedAt ? `, last used ${day(d.lastUsedAt)}` : ''}
                        <span className="text-muted-foreground"> · expires {day(d.expiresAt)}</span>
                    </li>
                ))}
            </ul>
            <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
                Disconnect the extension everywhere
            </Button>
        </div>
    );
}
