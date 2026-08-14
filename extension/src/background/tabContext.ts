import type { NormalizedPageModel } from '@/shared/types/messages';
import type { UndoEntry } from '@/fill/executor';

// In-memory per-tab state: page model cache + last-undo entries from the most
// recent APPLY_FILLS. ApplicationSession persistence lives in session.ts.
type TabState = {
    tabId: number;
    url: string;
    lastParseAt: number;
    lastPageModel: NormalizedPageModel | null;
    lastUndoEntries: UndoEntry[];
};

const tabs = new Map<number, TabState>();

export function setPageModel(tabId: number, pageModel: NormalizedPageModel): void {
    const existing = tabs.get(tabId);
    tabs.set(tabId, {
        tabId,
        url: pageModel.url,
        lastParseAt: Date.now(),
        lastPageModel: pageModel,
        lastUndoEntries: existing?.lastUndoEntries ?? [],
    });
}

export function getPageModel(tabId: number): NormalizedPageModel | null {
    return tabs.get(tabId)?.lastPageModel ?? null;
}

export function setUndoEntries(tabId: number, entries: UndoEntry[]): void {
    const existing = tabs.get(tabId);
    if (!existing) {
        tabs.set(tabId, {
            tabId,
            url: '',
            lastParseAt: 0,
            lastPageModel: null,
            lastUndoEntries: entries,
        });
        return;
    }
    tabs.set(tabId, { ...existing, lastUndoEntries: entries });
}

export function getUndoEntries(tabId: number): UndoEntry[] {
    return tabs.get(tabId)?.lastUndoEntries ?? [];
}

export function clearUndoEntries(tabId: number): void {
    const existing = tabs.get(tabId);
    if (!existing) return;
    tabs.set(tabId, { ...existing, lastUndoEntries: [] });
}

export function clearTab(tabId: number): void {
    tabs.delete(tabId);
}

// Wire chrome.tabs lifecycle so closed tabs free memory.
chrome.tabs.onRemoved.addListener((tabId) => clearTab(tabId));
