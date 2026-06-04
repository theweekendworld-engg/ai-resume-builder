import { useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { Message, NormalizedPageModel } from '@/shared/types/messages';

type State =
    | { status: 'loading' }
    | { status: 'empty' }
    | { status: 'ready'; pageModel: NormalizedPageModel; tabId: number };

async function getActiveTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}

export function usePageContext(): {
    state: State;
    reparse: () => Promise<void>;
} {
    const [state, setState] = useState<State>({ status: 'loading' });

    const refresh = async () => {
        const tabId = await getActiveTabId();
        if (tabId == null) {
            setState({ status: 'empty' });
            return;
        }
        const res = await request<NormalizedPageModel | null>({
            type: 'GET_PAGE_CONTEXT',
            tabId,
        });
        if (!res.ok || !res.data) {
            setState({ status: 'empty' });
            return;
        }
        setState({ status: 'ready', pageModel: res.data, tabId });
    };

    useEffect(() => {
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
            chrome.runtime.onMessage.removeListener(listener);
            chrome.tabs.onActivated.removeListener(tabListener);
        };
    }, []);

    const reparse = async () => {
        const tabId = await getActiveTabId();
        if (tabId == null) return;
        setState({ status: 'loading' });
        const res = await request<{ requested: boolean; reinjected?: boolean }>({
            type: 'REQUEST_REPARSE',
            tabId,
        });
        // If the content script was reinjected, give it time to parse the page
        // and send PAGE_CONTEXT_UPDATED before we query the background cache.
        if (res.ok && res.data?.reinjected) {
            await new Promise((r) => setTimeout(r, 1200));
        }
        await refresh();
    };

    return { state, reparse };
}
