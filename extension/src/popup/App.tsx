import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { AuthState } from '@/shared/types/messages';
import { ExternalLink, LogIn, Sparkles, Settings } from 'lucide-react';

const DEFAULT_APP_BASE = 'http://localhost:3000';

export function App() {
    const [auth, setAuth] = useState<AuthState>({ status: 'disconnected' });
    const [opening, setOpening] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const res = await request<AuthState>({ type: 'AUTH_GET' });
            if (!cancelled && res.ok) setAuth(res.data);
        };
        load();
        const handler = () => load();
        chrome.storage.onChanged.addListener(handler);
        return () => {
            cancelled = true;
            chrome.storage.onChanged.removeListener(handler);
        };
    }, []);

    const openConnect = async () => {
        const res = await request<{ connectUrl: string }>({ type: 'CONNECT_START' });
        const url = res.ok ? res.data.connectUrl : `${DEFAULT_APP_BASE}/extension/connect`;
        chrome.tabs.create({ url });
        window.close();
    };

    const openSidepanel = async () => {
        setOpening(true);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) {
            try {
                await chrome.sidePanel.open({ tabId: tab.id });
                window.close();
            } catch {
                // Some chromium variants gate sidePanel.open behind user gesture;
                // fall back to the request handler in the background worker.
                await request({ type: 'OPEN_SIDEPANEL', tabId: tab.id });
            }
        }
        setOpening(false);
    };

    const openOptions = () => {
        chrome.runtime.openOptionsPage?.();
    };

    return (
        <div className="w-[280px] p-3">
            <header className="mb-3 flex items-center gap-2">
                <div className="h-6 w-6 rounded bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                    P
                </div>
                <span className="text-sm font-semibold">Patronus Job Copilot</span>
            </header>

            {auth.status === 'connected' ? (
                <>
                    <p className="mb-2 text-xs text-muted-foreground">
                        Signed in as <span className="text-foreground">{auth.email ?? auth.userId}</span>
                    </p>
                    <button
                        type="button"
                        onClick={openSidepanel}
                        disabled={opening}
                        className="btn-primary w-full"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        Open side panel
                    </button>
                    <button
                        type="button"
                        onClick={openOptions}
                        className="btn-ghost mt-1 w-full text-xs text-muted-foreground"
                    >
                        <Settings className="h-3.5 w-3.5" />
                        Settings
                    </button>
                </>
            ) : auth.status === 'expired' ? (
                <>
                    <p className="mb-3 text-xs text-warning">
                        Your session expired. Reconnect to keep using the extension.
                    </p>
                    <button type="button" onClick={openConnect} className="btn-primary w-full">
                        <LogIn className="h-3.5 w-3.5" />
                        Reconnect
                        <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                </>
            ) : (
                <>
                    <p className="mb-3 text-xs text-muted-foreground">
                        Connect your Patronus account to enable autofill and tailored
                        resumes.
                    </p>
                    <button type="button" onClick={openConnect} className="btn-primary w-full">
                        <LogIn className="h-3.5 w-3.5" />
                        Connect
                        <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                </>
            )}

            <p className="mt-3 text-[10px] leading-tight text-muted-foreground/70">
                Your file is processed in memory and never stored. The extension fills
                fields and drafts answers — you click submit.
            </p>
        </div>
    );
}
