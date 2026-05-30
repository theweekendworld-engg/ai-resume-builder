import { useCallback, useEffect, useState } from 'react';
import { request } from '@/background/messageBus';
import type { FillPlanWire } from '@/shared/types/messages';

type State =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; plan: FillPlanWire }
    | { status: 'error'; error: string };

async function getActiveTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}

export function useFillPlan(): {
    state: State;
    refresh: () => Promise<void>;
    apply: (actionIds?: string[]) => Promise<{ appliedCount?: number; results?: unknown[] } | null>;
    undo: () => Promise<{ restoredCount?: number; results?: unknown[] } | null>;
} {
    const [state, setState] = useState<State>({ status: 'idle' });

    const refresh = useCallback(async () => {
        const tabId = await getActiveTabId();
        if (tabId == null) {
            setState({ status: 'idle' });
            return;
        }
        setState({ status: 'loading' });
        const res = await request<FillPlanWire>({ type: 'GET_FILL_PLAN', tabId });
        if (res.ok) setState({ status: 'ready', plan: res.data });
        else setState({ status: 'error', error: res.error });
    }, []);

    useEffect(() => {
        refresh();
        const listener = (
            raw: unknown,
            _sender: chrome.runtime.MessageSender,
            sendResponse: (r: unknown) => void
        ) => {
            const m = raw as { type?: string } | undefined;
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
    }, [refresh]);

    const apply = useCallback(
        async (actionIds?: string[]) => {
            const tabId = await getActiveTabId();
            if (tabId == null) return null;
            const res = await request<{ appliedCount?: number; results?: unknown[] }>({
                type: 'APPLY_FILLS',
                tabId,
                actionIds,
            });
            if (res.ok) {
                // Refresh plan to reflect any DOM mutations that may shift labels.
                refresh();
                return res.data;
            }
            return null;
        },
        [refresh]
    );

    const undo = useCallback(async () => {
        const tabId = await getActiveTabId();
        if (tabId == null) return null;
        const res = await request<{ restoredCount?: number; results?: unknown[] }>({
            type: 'UNDO_FILLS',
            tabId,
        });
        if (res.ok) {
            refresh();
            return res.data;
        }
        return null;
    }, [refresh]);

    return { state, refresh, apply, undo };
}
