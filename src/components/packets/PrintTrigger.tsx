'use client';

import * as React from 'react';

/**
 * Opens the print dialog once the packet has painted.
 *
 * Two details that are easy to get wrong and both produce a blank or
 * half-rendered PDF:
 *
 *   The dialog must not open during the same frame the document mounts.
 *   `window.print()` snapshots synchronously, so firing it before fonts and
 *   layout have settled prints a page with fallback metrics — visibly
 *   different from what the user saw. A double `requestAnimationFrame` waits
 *   for a painted frame, and `document.fonts.ready` for the webfonts, which
 *   is the part that actually shifts line breaks.
 *
 *   It must fire once. React 19 runs effects twice in development; a second
 *   `print()` while the first dialog is open is at best ignored and at worst
 *   queues a duplicate.
 *
 * The route stays useful without JavaScript — the document is server-rendered,
 * so Cmd-P works whether or not this component ever runs. This only removes a
 * keystroke.
 */
export function PrintTrigger() {
    const fired = React.useRef(false);

    React.useEffect(() => {
        if (fired.current) return;
        fired.current = true;

        let cancelled = false;

        const open = () => {
            if (cancelled) return;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!cancelled) window.print();
                });
            });
        };

        // `document.fonts` is absent in some embedded webviews; printing
        // immediately is a better failure than never printing at all.
        if (typeof document !== 'undefined' && 'fonts' in document) {
            void document.fonts.ready.then(open);
        } else {
            open();
        }

        return () => {
            cancelled = true;
        };
    }, []);

    return null;
}
