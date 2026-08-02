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

export interface SourcesScreenActions {
    connect: (mode: 'public' | 'full') => Promise<{ ok: boolean; error?: string }>;
    listRepos: () => Promise<{ ok: boolean; repos?: RepoOption[]; error?: string }>;
    saveRepos: (repos: string[]) => Promise<{ ok: boolean; error?: string }>;
    syncNow: (kind: string) => Promise<{ ok: boolean; error?: string }>;
    togglePause: (kind: string, paused: boolean) => Promise<{ ok: boolean; error?: string }>;
    disconnect: (kind: string, deleteWins: boolean) => Promise<{ ok: boolean; error?: string }>;
    refresh: () => Promise<SourcesOverview | null>;
}

export interface SourcesScreenProps {
    initial: SourcesOverview;
    actions: SourcesScreenActions;
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
    const [error, setError] = React.useState<string | null>(null);
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
            setError(result.error ?? "Couldn't load your repos");
            return;
        }
        setMode({ view: 'picker', repos: result.repos });
    }, [actions]);

    const handleConnect = React.useCallback(
        async (mode_: 'public' | 'full') => {
            setConnecting(mode_);
            setError(null);
            const result = await actions.connect(mode_);
            setConnecting(null);
            if (!result.ok) {
                setError(result.error ?? 'Could not connect');
                return;
            }
            await refresh();
            await openPicker();
        },
        [actions, openPicker, refresh],
    );

    const handleSaveRepos = React.useCallback(
        async (repos: string[]) => {
            setBusy(true);
            setError(null);
            const result = await actions.saveRepos(repos);
            setBusy(false);
            if (!result.ok) {
                setError(result.error ?? 'Could not save that selection');
                return;
            }
            setMode({ view: 'list' });
            await refresh();
        },
        [actions, refresh],
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

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {overview.connected.length === 0 ? (
                <EmptyState
                    icon={Github}
                    title="Nothing connected yet"
                    description="Connect GitHub and we'll build the first 90 days of your work log in about a minute."
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
                                if (!result.ok) setError(result.error ?? 'Could not start a sync');
                                else await refresh();
                            }}
                            onTogglePause={async () => {
                                setBusy(true);
                                const result = await actions.togglePause(
                                    source.kind,
                                    source.pill.status !== 'paused',
                                );
                                setBusy(false);
                                if (!result.ok) setError(result.error ?? 'Could not change that');
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
                    if (!result.ok) setError(result.error ?? 'Could not disconnect');
                    else await refresh();
                }}
            />
        </div>
    );
}
