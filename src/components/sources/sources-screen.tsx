'use client';

/**
 * `/settings/sources` — design/02 §J1.
 *
 * A client screen over a server-rendered snapshot. Every mutation goes through
 * a server action and then re-reads the whole overview rather than patching
 * local state: the page is small, the actions are rare, and a settings screen
 * that disagrees with the database about what a connector can see is worse than
 * one that takes 200ms to refresh.
 */

import * as React from 'react';
import { Github } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns';
import { TWO_ACCOUNTS_LIMIT_COPY } from '@/lib/capture/consent';
import type { RepoOption, SourcesOverview } from '@/lib/capture/views';
import { ConnectGithubPanel } from './connect-github-panel';
import { DisconnectDialog } from './disconnect-dialog';
import { RepoPicker } from './repo-picker';
import { SourceCard } from './source-card';

/** `code` is the server's error code, so the screen can offer the fix, not just the error. */
type ActionResult = { ok: boolean; error?: string; code?: string };

export interface SourcesScreenActions {
    connect: (mode: 'public' | 'full') => Promise<ActionResult>;
    listRepos: () => Promise<{ ok: boolean; repos?: RepoOption[]; error?: string; code?: string }>;
    saveRepos: (repos: string[]) => Promise<ActionResult>;
    syncNow: (kind: string) => Promise<ActionResult>;
    togglePause: (kind: string, paused: boolean) => Promise<ActionResult>;
    disconnect: (kind: string, deleteWins: boolean) => Promise<ActionResult>;
    refresh: () => Promise<SourcesOverview | null>;
}

export interface SourcesScreenProps {
    initial: SourcesOverview;
    actions: SourcesScreenActions;
}

/**
 * The server's errors, turned into what the user can do about them. The raw
 * "Connect your GitHub account in Account settings first" had no link and no
 * steps; "the next one runs automatically" was false until the daily sync
 * existed.
 */
export function describeSourceError(
    error: string | undefined,
    code: string | undefined,
    fallback: string,
): { message: string; action: { href: string; label: string } | null } {
    if (code === 'github_not_linked') {
        return {
            message:
                'First link GitHub to your Patronus account: open Account, choose Connected accounts, connect GitHub, then come back here.',
            action: { href: '/account', label: 'Open Account' },
        };
    }
    if (code === 'rate_limited') {
        return {
            message: 'This source synced less than an hour ago. Sources also sync automatically once a day.',
            action: null,
        };
    }
    return { message: error ?? fallback, action: null };
}

type Mode =
    | { view: 'list' }
    | { view: 'connect' }
    | { view: 'picker'; repos: RepoOption[] };

export function SourcesScreen({ initial, actions }: SourcesScreenProps) {
    const [overview, setOverview] = React.useState(initial);
    const [mode, setMode] = React.useState<Mode>({ view: 'list' });
    const [busy, setBusy] = React.useState(false);
    const [connecting, setConnecting] = React.useState<'public' | 'full' | null>(null);
    const [errorState, setErrorState] = React.useState<{ message: string; action: { href: string; label: string } | null } | null>(null);
    const error = errorState?.message ?? null;
    const setError = React.useCallback(
        (message: string | null, code?: string) =>
            setErrorState(message === null ? null : describeSourceError(message, code, message)),
        [],
    );
    const [notice, setNotice] = React.useState<string | null>(null);
    const [disconnecting, setDisconnecting] = React.useState<string | null>(null);

    const refresh = React.useCallback(async () => {
        const next = await actions.refresh();
        if (next) setOverview(next);
    }, [actions]);

    const openPicker = React.useCallback(async () => {
        setBusy(true);
        setError(null);
        const result = await actions.listRepos();
        setBusy(false);
        if (!result.ok || !result.repos) {
            setError(result.error ?? "Couldn't load your repos", result.code);
            return;
        }
        setMode({ view: 'picker', repos: result.repos });
    }, [actions, setError]);

    const handleConnect = React.useCallback(
        async (mode_: 'public' | 'full') => {
            setConnecting(mode_);
            setError(null);
            const result = await actions.connect(mode_);
            setConnecting(null);
            if (!result.ok) {
                setError(result.error ?? 'Could not connect', result.code);
                return;
            }
            await refresh();
            await openPicker();
        },
        [actions, openPicker, refresh, setError],
    );

    const handleSaveRepos = React.useCallback(
        async (repos: string[]) => {
            setBusy(true);
            setError(null);
            const result = await actions.saveRepos(repos);
            setBusy(false);
            if (!result.ok) {
                setError(result.error ?? 'Could not save that selection', result.code);
                return;
            }
            setMode({ view: 'list' });
            setNotice('Your first sync has started. Drafts appear in your Work Log for you to review, usually within a few minutes.');
            await refresh();
        },
        [actions, refresh, setError],
    );

    const github = overview.connected.find((source) => source.kind === 'github') ?? null;
    const disconnectTarget = overview.connected.find((source) => source.kind === disconnecting) ?? null;

    if (mode.view === 'connect') {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 py-10">
                <ConnectGithubPanel
                    onConnect={handleConnect}
                    onDefer={() => setMode({ view: 'list' })}
                    connecting={connecting}
                    error={error}
                    errorAction={errorState?.action ?? null}
                />
            </div>
        );
    }

    if (mode.view === 'picker') {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 py-10">
                <RepoPicker repos={mode.repos} onSubmit={handleSaveRepos} submitting={busy} error={error} />
                <Button variant="ghost" className="mt-4" onClick={() => setMode({ view: 'list' })}>
                    Back to sources
                </Button>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-medium">Connected sources</h1>
                <p className="text-sm text-muted-foreground">
                    What we watch, and what it has found. Everything we pull is shown to you before it becomes
                    part of your record.
                </p>
            </header>

            {error ? (
                <p className="text-sm text-destructive">
                    {error}
                    {errorState?.action ? (
                        <>
                            {' '}
                            <a href={errorState.action.href} className="font-medium underline underline-offset-4">
                                {errorState.action.label}
                            </a>
                        </>
                    ) : null}
                </p>
            ) : null}

            {notice ? (
                <p className="text-sm text-muted-foreground">
                    {notice}{' '}
                    <a href="/log" className="font-medium text-foreground underline underline-offset-4">
                        Open Work Log
                    </a>
                </p>
            ) : null}

            {overview.connected.length === 0 ? (
                <EmptyState
                    icon={Github}
                    title="Nothing connected yet"
                    description="Connect GitHub and we'll draft wins from your recent merged work: the last 30 days on Free, 90 on a paid plan. The first sync starts right away, then it runs once a day."
                    action={{ label: 'Connect GitHub', onClick: () => setMode({ view: 'connect' }) }}
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {overview.connected.map((source) => (
                        <SourceCard
                            key={source.id}
                            source={source}
                            busy={busy}
                            onEditAccess={() => void openPicker()}
                            onSyncNow={async () => {
                                setBusy(true);
                                const result = await actions.syncNow(source.kind);
                                setBusy(false);
                                if (!result.ok) {
                                    setError(result.error ?? 'Could not start a sync', result.code);
                                    return;
                                }
                                setNotice('Syncing now. New drafts land in your Work Log for review.');
                                await refresh();
                            }}
                            onTogglePause={async () => {
                                setBusy(true);
                                const result = await actions.togglePause(
                                    source.kind,
                                    source.pill.status !== 'paused',
                                );
                                setBusy(false);
                                if (!result.ok) setError(result.error ?? 'Could not change that', result.code);
                                else await refresh();
                            }}
                            onDisconnect={() => setDisconnecting(source.kind)}
                        />
                    ))}
                </div>
            )}

            {overview.available.length > 0 ? (
                <div className="flex flex-col gap-3">
                    {overview.available.map((candidate) => (
                        <Card key={candidate.kind}>
                            <CardContent className="flex items-center justify-between gap-4 p-4">
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{candidate.displayName}</span>
                                    <span className="text-sm text-muted-foreground">{candidate.pitch}</span>
                                </div>
                                {candidate.available ? (
                                    <Button variant="outline" size="sm" onClick={() => setMode({ view: 'connect' })}>
                                        Connect
                                    </Button>
                                ) : (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {candidate.requiresTierLabel ?? 'Not available'}
                                    </span>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}

            {github ? <p className="text-xs text-muted-foreground">{TWO_ACCOUNTS_LIMIT_COPY}</p> : null}

            <DisconnectDialog
                open={disconnectTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDisconnecting(null);
                }}
                sourceName={disconnectTarget?.displayName ?? ''}
                winCount={disconnectTarget?.winsFromSource ?? 0}
                busy={busy}
                onConfirm={async (deleteWins) => {
                    if (!disconnectTarget) return;
                    setBusy(true);
                    const result = await actions.disconnect(disconnectTarget.kind, deleteWins);
                    setBusy(false);
                    setDisconnecting(null);
                    if (!result.ok) setError(result.error ?? 'Could not disconnect', result.code);
                    else await refresh();
                }}
            />
        </div>
    );
}
