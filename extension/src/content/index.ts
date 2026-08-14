import type { Message, NormalizedPageModel } from '@/shared/types/messages';
import { parseCurrentPage } from '@/parsers';
import { applyFillActions, undoFillEntries, type UndoEntry } from '@/fill/executor';
import type { FillAction } from '@/fill/planner';

// As of Phase 1 slice 2, the parser is a proper ES module imported here and
// bundled by Vite into the content script. The legacy IIFE globals are gone.

let lastSerialized = '';
let parseScheduled = false;
let mutationCount = 0;

function send(msg: Message): void {
    try {
        chrome.runtime.sendMessage(msg).catch(() => {
            // Background worker may be cold-starting; silent retry below.
        });
    } catch {
        // Page may have been unloaded; ignore.
    }
}

function runParseAndShip(): void {
    let pageModel: NormalizedPageModel;
    try {
        pageModel = parseCurrentPage() as unknown as NormalizedPageModel;
    } catch (err) {
        console.warn('[patronus] parser run failed', err);
        return;
    }
    const serialized = JSON.stringify({
        url: pageModel.url,
        platform: pageModel.classification.platform,
        pageKind: pageModel.classification.pageKind,
        fieldCount: pageModel.fields.length,
        questionCount: pageModel.questions.length,
        jdLen: pageModel.jobDescription?.text?.length ?? 0,
    });
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;

    // The tabId isn't directly available in a content script; the background
    // worker reads it off the MessageSender. We embed a placeholder that the
    // background overwrites server-side. Sending -1 keeps the message envelope
    // valid for typechecking.
    send({ type: 'PAGE_CONTEXT_UPDATED', tabId: -1, pageModel });

    // Lightweight page.parsed telemetry. PII-free: only structural counts,
    // platform name, JD confidence band, parse duration if available.
    send({
        type: 'TELEMETRY_BATCH',
        events: [
            {
                type: 'page.parsed',
                payload: {
                    platform: pageModel.classification.platform,
                    pageKind: pageModel.classification.pageKind,
                    fieldCount: pageModel.fields.length,
                    questionCount: pageModel.questions.length,
                    jdConfidenceBand: pageModel.jobDescription?.confidenceBand ?? null,
                },
                extVersion: '0.1.0',
                clientOccurredAt: new Date().toISOString(),
            },
        ],
    });
}

function scheduleParse(delayMs = 350): void {
    if (parseScheduled) return;
    parseScheduled = true;
    window.setTimeout(() => {
        parseScheduled = false;
        runParseAndShip();
    }, delayMs);
}

// Listen for explicit reparse / apply / undo requests from the background.
// All DOM mutation lives in the content script — the background worker
// orchestrates but doesn't touch the page.
chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    if (typeof raw !== 'object' || raw === null) return false;
    const msg = raw as { type?: string };
    if (msg.type === 'CONTENT_REPARSE') {
        lastSerialized = '';
        scheduleParse(0);
        sendResponse({ ok: true });
        return false;
    }
    if (msg.type === 'CONTENT_APPLY_FILLS') {
        const actions = ((raw as { actions?: FillAction[] }).actions ?? []) as FillAction[];
        const outcome = applyFillActions(actions);
        sendResponse(outcome);
        return false;
    }
    if (msg.type === 'CONTENT_UNDO_FILLS') {
        const entries = ((raw as { undoEntries?: UndoEntry[] }).undoEntries ?? []) as UndoEntry[];
        const outcome = undoFillEntries(entries);
        sendResponse(outcome);
        return false;
    }
    if (msg.type === 'CONTENT_INSERT_TEXT') {
        const locator = (raw as { locator?: { cssPath?: string; id?: string; name?: string } })
            .locator ?? {};
        const text = (raw as { text?: string }).text ?? '';
        const target: HTMLElement | null = (() => {
            try {
                if (locator.cssPath) {
                    const byPath = document.querySelector(locator.cssPath);
                    if (byPath instanceof HTMLElement) return byPath;
                }
            } catch {
                /* fall through */
            }
            if (locator.id) {
                const byId = document.getElementById(locator.id);
                if (byId instanceof HTMLElement) return byId;
            }
            if (locator.name) {
                const byName = document.querySelector(`[name="${CSS.escape(locator.name)}"]`);
                if (byName instanceof HTMLElement) return byName;
            }
            return null;
        })();
        if (!target) {
            sendResponse({ ok: false, error: 'field_not_found' });
            return false;
        }
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
            target.focus();
            target.value = text;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('blur', { bubbles: true }));
            sendResponse({ ok: true });
            return false;
        }
        if (target.getAttribute('contenteditable') === 'true') {
            target.focus();
            target.textContent = text;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            sendResponse({ ok: true });
            return false;
        }
        sendResponse({ ok: false, error: 'unsupported_target' });
        return false;
    }
    return false;
});

// First parse after document_idle. The manifest sets run_at: document_idle so
// readyState is at least 'interactive' by the time this script runs.
scheduleParse(80);

// Debounced re-parse on DOM churn — ATS pages mutate aggressively as steps
// load. Hard cap on mutation noise; rely on URL change for the strong signal.
const observer = new MutationObserver(() => {
    mutationCount += 1;
    if (mutationCount > 5) {
        mutationCount = 0;
        scheduleParse(600);
    }
});
observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
});

// SPA navigation: history.pushState/replaceState don't fire popstate, so patch
// once to emit a custom event we listen for.
(() => {
    const w = window as unknown as { __patronusHistoryPatched?: boolean };
    if (w.__patronusHistoryPatched) return;
    w.__patronusHistoryPatched = true;
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = (data, unused, url) => {
        const result = originalPush(data, unused, url);
        window.dispatchEvent(new Event('patronus:locationchange'));
        return result;
    };
    history.replaceState = (data, unused, url) => {
        const result = originalReplace(data, unused, url);
        window.dispatchEvent(new Event('patronus:locationchange'));
        return result;
    };
})();
window.addEventListener('patronus:locationchange', () => {
    lastSerialized = '';
    scheduleParse(400);
});
window.addEventListener('popstate', () => {
    lastSerialized = '';
    scheduleParse(400);
});
