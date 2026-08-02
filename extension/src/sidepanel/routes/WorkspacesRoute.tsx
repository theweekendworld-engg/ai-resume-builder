import { useCallback, useEffect, useState } from 'react';
import { Loader2, Inbox, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { request } from '@/background/messageBus';
import { useAppBaseUrl } from '../hooks/useAppBaseUrl';
import type { WorkspaceListItemWire, WorkspaceListResult } from '@/shared/types/messages';

const STATUS_STYLES: Record<string, string> = {
    discovered: 'border-border bg-muted text-muted-foreground',
    analyzed: 'border-border bg-muted text-muted-foreground',
    drafting: 'border-warning/40 bg-warning/10 text-warning',
    in_progress: 'border-warning/40 bg-warning/10 text-warning',
    submitted: 'border-success/40 bg-success/10 text-success',
    applied: 'border-success/40 bg-success/10 text-success',
    in_review: 'border-primary/40 bg-primary/10 text-primary',
    interview: 'border-primary/40 bg-primary/10 text-primary',
    offer: 'border-success/40 bg-success/10 text-success',
    rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
    ghosted: 'border-destructive/40 bg-destructive/10 text-destructive',
    archived: 'border-border bg-muted text-muted-foreground',
};

function formatStatus(status: string) {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatWhen(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function WorkspacesRoute() {
    const appBase = useAppBaseUrl();
    const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unauthenticated'>('loading');
    const [workspaces, setWorkspaces] = useState<WorkspaceListItemWire[]>([]);

    const applyResult = useCallback((res: Awaited<ReturnType<typeof request<WorkspaceListResult>>>) => {
        if (res.ok) {
            setWorkspaces(res.data.workspaces);
            setStatus('ready');
        } else {
            setStatus(res.error === 'not_authenticated' ? 'unauthenticated' : 'error');
        }
    }, []);

    // Refresh handler (event-driven): shows the loading state, then refetches.
    const load = useCallback(async () => {
        setStatus('loading');
        applyResult(await request<WorkspaceListResult>({ type: 'LIST_WORKSPACES' }));
    }, [applyResult]);

    // Initial fetch: state is only updated after the request resolves, so the
    // effect body itself never calls setState synchronously.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await request<WorkspaceListResult>({ type: 'LIST_WORKSPACES' });
            if (!cancelled) applyResult(res);
        })();
        return () => {
            cancelled = true;
        };
    }, [applyResult]);

    if (status === 'loading') {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your applications…
            </div>
        );
    }

    if (status === 'unauthenticated') {
        return (
            <div className="card p-4 text-sm">
                <h3 className="mb-1 font-semibold">Sign in required</h3>
                <p className="text-muted-foreground">
                    Connect the extension from Settings to see your saved applications.
                </p>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="card p-4 text-sm">
                <div className="mb-2 font-semibold">Couldn&apos;t load applications</div>
                <button type="button" onClick={load} className="btn-ghost text-xs">
                    <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
            </div>
        );
    }

    if (workspaces.length === 0) {
        return (
            <div className="card p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                    <Inbox className="h-4 w-4" /> No applications yet
                </div>
                <p className="text-muted-foreground">
                    Save a job page from the Apply tab and it will show up here with its status and activity.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Applications</h2>
                <button type="button" onClick={load} className="btn-ghost text-xs" title="Refresh">
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
            </div>

            {workspaces.map((workspace) => {
                const statusClass = STATUS_STYLES[workspace.applicationStatus] ?? STATUS_STYLES.discovered;
                return (
                    <section key={workspace.id} className="card p-3">
                        <div className="mb-1 flex items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold leading-tight">
                                {workspace.roleTitle ?? 'Untitled role'}
                            </h3>
                            <span className={cn('chip shrink-0 capitalize', statusClass)}>
                                {formatStatus(workspace.applicationStatus)}
                            </span>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            {[workspace.companyName, workspace.location].filter(Boolean).join(' · ') ||
                                workspace.sourcePlatform ||
                                'Unknown company'}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>Fit {workspace.fitScore ?? '—'}</span>
                            <span>·</span>
                            <span>
                                {workspace.answeredQuestionCount}/{workspace.questionCount} answered
                            </span>
                            {workspace.updatedAt ? (
                                <>
                                    <span>·</span>
                                    <span>{formatWhen(workspace.updatedAt)}</span>
                                </>
                            ) : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {workspace.sourceUrl ? (
                                <a
                                    href={workspace.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn-ghost text-xs"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" /> Job page
                                </a>
                            ) : null}
                            {workspace.selectedResumeId ? (
                                <a
                                    href={`${appBase}/editor/${workspace.selectedResumeId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn-ghost text-xs"
                                >
                                    <FileText className="h-3.5 w-3.5" /> Resume
                                </a>
                            ) : null}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
