import { useState } from 'react';
import { request } from '@/background/messageBus';
import { useExtensionAuth } from '../hooks/useExtensionAuth';
import { LogOut, ExternalLink } from 'lucide-react';

const DEFAULT_APP_BASE = 'http://localhost:3000';

export function SettingsRoute() {
    const auth = useExtensionAuth();
    const [appBase, setAppBase] = useState(DEFAULT_APP_BASE);
    const [signingOut, setSigningOut] = useState(false);

    const openConnect = async () => {
        const res = await request<{ connectUrl: string }>({ type: 'CONNECT_START' });
        const url = res.ok ? res.data.connectUrl : `${appBase}/extension/connect`;
        chrome.tabs.create({ url });
    };

    const signOut = async () => {
        setSigningOut(true);
        await request({ type: 'AUTH_CLEAR' });
        setSigningOut(false);
    };

    return (
        <div className="space-y-3">
            <section className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">Account</h3>
                {auth.status === 'connected' ? (
                    <>
                        <p className="text-xs text-muted-foreground">
                            Signed in as <span className="text-foreground">{auth.email ?? auth.userId}</span>
                        </p>
                        <button
                            type="button"
                            onClick={signOut}
                            disabled={signingOut}
                            className="btn-outline mt-3 text-xs"
                        >
                            <LogOut className="h-3.5 w-3.5" />
                            Sign out
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">
                            You&apos;re not connected to your Patronus account. Connecting lets
                            the extension fill forms and tailor resumes for you.
                        </p>
                        <button
                            type="button"
                            onClick={openConnect}
                            className="btn-primary mt-3 w-full text-xs"
                        >
                            Connect
                            <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                    </>
                )}
            </section>

            <section className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">Backend URL</h3>
                <input
                    type="url"
                    value={appBase}
                    onChange={(e) => setAppBase(e.target.value)}
                    className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs"
                    placeholder="http://localhost:3000"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                    The web app the extension connects to. Persistence wires up in the
                    next slice.
                </p>
            </section>

            <section className="card p-3 text-xs text-muted-foreground">
                <p>Patronus Job Copilot — extension v0.1.0</p>
                <p className="mt-1">No file uploads are stored. Autofill never auto-submits.</p>
            </section>
        </div>
    );
}
