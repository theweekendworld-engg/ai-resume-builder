'use client';

/**
 * The connect screen — design/02 §A2, PRD 02 §3.2.
 *
 * "The highest-leverage screen in the product." The three checkmarks carry the
 * whole consent burden and are deliberately NOT collapsible fine print: they
 * are the reason someone hands us a `repo` scope, and hiding them behind a
 * disclosure would be a dark pattern wearing a design pattern's clothes.
 *
 * The copy comes from `@/lib/capture/consent` verbatim. Do not retype it here —
 * `CaptureSource.consentCopyVersion` records which strings a user agreed to, and
 * a second copy of the text is a second thing that can drift out of that record.
 */

import * as React from 'react';
import { Check, Github } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GITHUB_CONSENT } from '@/lib/capture/consent';

export interface ConnectGithubPanelProps {
    onConnect: (mode: 'public' | 'full') => void | Promise<void>;
    /** Rendered as "I'll do this later". Omit in settings, where there is nothing to defer to. */
    onDefer?: () => void;
    connecting?: 'public' | 'full' | null;
    error?: string | null;
    /** A way out of the error, e.g. "Open account settings" when GitHub isn't linked yet. */
    errorAction?: { href: string; label: string } | null;
    className?: string;
}

export function ConnectGithubPanel({
    onConnect,
    onDefer,
    connecting = null,
    error = null,
    errorAction = null,
    className,
}: ConnectGithubPanelProps) {
    return (
        <section className={cn('mx-auto flex w-full max-w-[480px] flex-col gap-6 text-center', className)}>
            <header className="flex flex-col items-center gap-3">
                <Github className="h-8 w-8" aria-hidden />
                <h1 className="text-2xl font-medium">{GITHUB_CONSENT.heading}</h1>
                <p className="text-balance text-muted-foreground">
                    We read your merged pull requests and code reviews and draft them as wins for you to
                    review. The first sync starts right away; after that it runs once a day.
                </p>
            </header>

            <ul className="flex flex-col gap-2 text-left">
                {GITHUB_CONSENT.checkmarks.map((line) => (
                    <li key={line} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden />
                        <span>{line}</span>
                    </li>
                ))}
            </ul>

            <p className="text-left text-sm text-muted-foreground">{GITHUB_CONSENT.assurance}</p>

            <div className="flex flex-col gap-2">
                <Button
                    type="button"
                    className="w-full"
                    disabled={connecting !== null}
                    onClick={() => void onConnect('full')}
                >
                    {connecting === 'full' ? 'Connecting…' : GITHUB_CONSENT.primaryCta}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={connecting !== null}
                    onClick={() => void onConnect('public')}
                >
                    {connecting === 'public' ? 'Connecting…' : GITHUB_CONSENT.secondaryCta}
                </Button>
            </div>

            {error ? (
                <p className="text-sm text-destructive">
                    {error}
                    {errorAction ? (
                        <>
                            {' '}
                            <a href={errorAction.href} className="font-medium underline underline-offset-4">
                                {errorAction.label}
                            </a>
                        </>
                    ) : null}
                </p>
            ) : null}

            {/* Refusal is not a dead end (§A2). */}
            {onDefer ? (
                <button
                    type="button"
                    onClick={onDefer}
                    className="mx-auto text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                    {GITHUB_CONSENT.deferCta}
                </button>
            ) : null}
        </section>
    );
}
