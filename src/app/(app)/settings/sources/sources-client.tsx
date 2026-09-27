'use client';

/**
 * The action bridge between the server actions and the presentational screen.
 *
 * `SourcesScreen` takes its mutations as props so it can be rendered in a test
 * or a gallery without Clerk, a database, or a network. This file is the one
 * place that binds those props to the real server actions, and it is the only
 * place that knows the `Result` discriminant.
 */

import * as React from 'react';

import { SourcesScreen, type SourcesScreenActions } from '@/components/sources';
import type { CaptureSourceKind } from '@prisma/client';
import type { SourcesOverview } from '@/lib/capture/views';
import {
    connectGithub,
    disconnectSource,
    getSourcesOverview,
    listGithubRepos,
    saveRepoSelection,
    setSourcePaused,
    syncSourceNow,
} from '@/actions/capture';

export function SourcesClient({ initial }: { initial: SourcesOverview }) {
    const actions = React.useMemo<SourcesScreenActions>(
        () => ({
            connect: async (mode) => {
                const result = await connectGithub({ mode });
                return result.success ? { ok: true } : { ok: false, error: result.error, code: result.code };
            },
            listRepos: async () => {
                const result = await listGithubRepos();
                return result.success ? { ok: true, repos: result.data } : { ok: false, error: result.error, code: result.code };
            },
            saveRepos: async (repos) => {
                const result = await saveRepoSelection(repos);
                return result.success ? { ok: true } : { ok: false, error: result.error, code: result.code };
            },
            syncNow: async (kind) => {
                const result = await syncSourceNow(kind as CaptureSourceKind);
                return result.success ? { ok: true } : { ok: false, error: result.error, code: result.code };
            },
            togglePause: async (kind, paused) => {
                const result = await setSourcePaused(kind as CaptureSourceKind, paused);
                return result.success ? { ok: true } : { ok: false, error: result.error, code: result.code };
            },
            disconnect: async (kind, deleteWins) => {
                const result = await disconnectSource({ kind: kind as CaptureSourceKind, deleteWins });
                return result.success ? { ok: true } : { ok: false, error: result.error, code: result.code };
            },
            refresh: async () => {
                const result = await getSourcesOverview();
                return result.success ? result.data : null;
            },
        }),
        [],
    );

    return <SourcesScreen initial={initial} actions={actions} />;
}
