'use client';

/**
 * One connected source — design/02 §J1.
 *
 * The card's job is to answer "what can this see?" without navigation. That is
 * why the access line ("12 repos · public + private") sits directly under the
 * account name and above everything else: it is the question a privacy-anxious
 * user opens this page to answer, and making them click [Edit] to find out
 * would be answering it badly.
 *
 * Status is a word plus a colour, never a colour alone.
 */

import * as React from 'react';
import { Github, Calendar, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { SourceView } from '@/lib/capture/views';

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    github: Github,
    calendar: Calendar,
    linear: ListChecks,
    jira: ListChecks,
};

const TONE_DOT: Record<SourceView['pill']['tone'], string> = {
    positive: 'bg-emerald-500',
    neutral: 'bg-muted-foreground',
    warning: 'bg-amber-500',
    critical: 'bg-destructive',
};

export interface SourceCardProps {
    source: SourceView;
    onSyncNow: () => void | Promise<void>;
    onTogglePause: () => void | Promise<void>;
    onEditAccess: () => void;
    onDisconnect: () => void;
    busy?: boolean;
    className?: string;
}

export function SourceCard({
    source,
    onSyncNow,
    onTogglePause,
    onEditAccess,
    onDisconnect,
    busy = false,
    className,
}: SourceCardProps) {
    const Icon = KIND_ICON[source.kind] ?? Github;
    const paused = source.pill.status === 'paused';

    return (
        <Card className={cn('overflow-hidden', className)}>
            <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" aria-hidden />
                        <h3 className="font-medium">{source.displayName}</h3>
                    </div>
                    <span className="flex items-center gap-1.5 text-sm">
                        <span className={cn('h-2 w-2 rounded-full', TONE_DOT[source.pill.tone])} aria-hidden />
                        {source.pill.label}
                    </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium">{source.accountLabel}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{source.access}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onEditAccess}>
                        Edit
                    </Button>
                </div>

                <dl className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                    <div className="flex gap-2">
                        <dt className="shrink-0">Last sync</dt>
                        <dd>{source.lastRun}</dd>
                    </div>
                    {source.contribution ? <dd>{source.contribution}</dd> : null}
                </dl>

                {source.lastError ? (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        {source.lastError}
                    </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !source.canSyncNow || paused}
                        onClick={() => void onSyncNow()}
                        title={source.canSyncNow ? undefined : 'Synced within the last hour'}
                    >
                        Sync now
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void onTogglePause()}>
                        {paused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onDisconnect}>
                        Disconnect
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
