import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { ApplicationSession, Message } from '@/shared/types/messages';

async function getActiveTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}

export function useSession(): ApplicationSession | null {
    const [session, setSession] = useState<ApplicationSession | null>(null);

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            const tabId = await getActiveTabId();
            if (tabId == null) {
                if (!cancelled) setSession(null);
                return;
            }
            const res = await request<ApplicationSession | null>({
                type: 'GET_SESSION',
                tabId,
            });
            if (!cancelled && res.ok) setSession(res.data);
        };
        refresh();

        const listener = (
            msg: unknown,
            _sender: chrome.runtime.MessageSender,
            sendResponse: (r: unknown) => void
        ) => {
            const m = msg as Message | undefined;
            if (m?.type === 'PAGE_CONTEXT_UPDATED') {
                refresh();
                sendResponse({ ok: true, data: { received: true } });
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        const tabListener = () => refresh();
        chrome.tabs.onActivated.addListener(tabListener);
        return () => {
            cancelled = true;
            chrome.runtime.onMessage.removeListener(listener);
            chrome.tabs.onActivated.removeListener(tabListener);
        };
    }, []);

    return session;
}
