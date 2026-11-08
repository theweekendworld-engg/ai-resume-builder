'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

import { Segmented } from '@/components/patterns';

/**
 * Light or dark, for this browser (Dossier, 2026-11-08).
 *
 * Dark mode has existed as a full token set since design/00 §3.1 ("a
 * first-class, user-selectable option") with nothing in the app to select
 * it. next-themes stores the choice under `patronus-theme`; there is no
 * "system" option because the root layout turns `enableSystem` off on
 * purpose. Rendered after mount: the stored theme is unknown on the server,
 * and guessing would flash the wrong segment.
 */
export function AppearanceSetting() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);

    return (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Appearance</p>
                <p className="text-sm text-muted-foreground">Paper for daytime, deep ink for late nights. Saved in this browser.</p>
            </div>
            {mounted ? (
                <Segmented
                    label="Appearance"
                    value={theme === 'dark' ? 'dark' : 'light'}
                    onChange={(value) => setTheme(value)}
                    options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                    ]}
                />
            ) : (
                <div aria-hidden className="h-9 w-[124px] rounded-md border border-border bg-secondary" />
            )}
        </div>
    );
}
