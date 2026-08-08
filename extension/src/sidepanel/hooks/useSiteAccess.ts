import { useCallback, useEffect, useState } from 'react';

import { request } from '@/background/messageBus';

/**
 * Access to the site in the current tab.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The manifest used to ask for `<all_urls>`, which Chrome renders at install
 * time as "Read and change all your data on all websites". That is a hard sell
 * for any extension and an absurd one for a product whose whole brand is not
 * taking more than it needs, so the declared hosts were narrowed to the nine
 * boards `detectPlatform()` actually parses.
 *
 * That narrowing, on its own, was a regression. `optional_host_permissions`
 * was declared and NOTHING requested it — so on a board outside those nine the
 * content script never ran, the panel said "No job page detected", and there
 * was no way for the user to change that. The extension went from working
 * everywhere to working in nine places with no path to a tenth.
 *
 * This is that path: the user, on the page they care about, granting access to
 * that one origin. Which is a better consent story than the install prompt
 * ever was — it is specific, it is theirs, and it is revocable.
 */

export type SiteAccess =
    | { status: 'checking' }
    /** Nothing to ask for — a chrome:// page, the store, a blank tab. */
    | { status: 'unavailable' }
    | { status: 'granted' }
    | { status: 'grantable'; origin: string; host: string };

/** `https://boards.example.com/x/y` -> `https://boards.example.com/*` */
function originPatternOf(url: string): { origin: string; host: string } | null {
    try {
        const parsed = new URL(url);
        // Only http(s). A `chrome://`, `file://` or extension page cannot be
        // granted and must not be offered.
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return { origin: `${parsed.origin}/*`, host: parsed.hostname };
    } catch {
        return null;
    }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
}

export function useSiteAccess(): {
    access: SiteAccess;
    /** Must be called from a click — Chrome requires a user gesture. */
    grant: () => Promise<boolean>;
    recheck: () => Promise<void>;
} {
    const [access, setAccess] = useState<SiteAccess>({ status: 'checking' });

    const check = useCallback(async () => {
        const tab = await activeTab();
        const pattern = tab?.url ? originPatternOf(tab.url) : null;
        if (!pattern) {
            setAccess({ status: 'unavailable' });
            return;
        }
        const has = await chrome.permissions.contains({ origins: [pattern.origin] });
        setAccess(
            has
                ? { status: 'granted' }
                : { status: 'grantable', origin: pattern.origin, host: pattern.host },
        );
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        check();
        const onTab = () => void check();
        chrome.tabs.onActivated.addListener(onTab);
        chrome.tabs.onUpdated.addListener(onTab);
        return () => {
            chrome.tabs.onActivated.removeListener(onTab);
            chrome.tabs.onUpdated.removeListener(onTab);
        };
    }, [check]);

    const grant = useCallback(async () => {
        const tab = await activeTab();
        const pattern = tab?.url ? originPatternOf(tab.url) : null;
        if (!pattern || tab?.id == null) return false;

        // Chrome only honours this inside a user gesture, so it is called
        // directly from the click rather than proxied through the worker.
        const granted = await chrome.permissions.request({ origins: [pattern.origin] });
        if (!granted) {
            await check();
            return false;
        }

        // The declarative content script does not retroactively run on a tab
        // that was already open, so the page has to be parsed explicitly.
        // `REQUEST_REPARSE` already falls back to injecting from the
        // manifest's own entry when no content script answers.
        await request({ type: 'REQUEST_REPARSE', tabId: tab.id });
        await check();
        return true;
    }, [check]);

    return { access, grant, recheck: check };
}
