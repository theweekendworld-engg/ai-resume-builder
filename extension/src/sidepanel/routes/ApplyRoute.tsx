import { useCallback, useMemo, useRef, useState } from 'react';
import {
    Loader2,
    FileSearch,
    ShieldCheck,
    Sparkles,
    Layers,
    BookmarkCheck,
    BookmarkPlus,
} from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { request } from '@/background/messageBus';
import { usePageContext } from '../hooks/usePageContext';
import { useSession } from '../hooks/useSession';
import { useFillPlan } from '../hooks/useFillPlan';
import {
    ProfileCompletenessBanner,
    useProfileCompleteness,
} from '../components/ProfileCompletenessBanner';
import { FieldRow } from '../components/FieldRow';
import { FillUndoToast } from '../components/FillUndoToast';
import { QuestionsCard } from '../components/QuestionsCard';
import { useAppBaseUrl } from '../hooks/useAppBaseUrl';
import { trackExtensionEvent } from '@/shared/lib/telemetry';
import { useSiteAccess } from '@/sidepanel/hooks/useSiteAccess';


const BAND_STYLES = {
    high: 'border-success/40 bg-success/10 text-success',
    medium: 'border-warning/40 bg-warning/10 text-warning',
    low: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

export function ApplyRoute() {
    const appBase = useAppBaseUrl();
    const { state, reparse } = usePageContext();
    const siteAccess = useSiteAccess();
    const session = useSession();
    const completeness = useProfileCompleteness();
    const { state: fillState, apply, undo } = useFillPlan();
    const [filledIds, setFilledIds] = useState<Set<string>>(new Set());
    const [tracking, setTracking] = useState(false);
    const [trackError, setTrackError] = useState<string | null>(null);
    /** Set locally on success so the row updates without waiting for a session refresh. */
    const [trackedNow, setTrackedNow] = useState(false);
    const [lastApplied, setLastApplied] = useState<{ count: number; key: string } | null>(null);
    // Remount key for the undo toast. A counter rather than Date.now(): the
    // clock is impure (react-hooks/purity) and all this needs to be is
    // different from last time.
    const fillSeq = useRef(0);
    // Stable, so the toast's 30s timer is not restarted by unrelated renders.
    const dismissToast = useCallback(() => setLastApplied(null), []);
    const [applying, setApplying] = useState(false);

    const safeIdsForBulk = useMemo(() => {
        if (fillState.status !== 'ready') return [];
        return fillState.plan.actions
            .filter((a) => a.canApply && a.action === 'auto_fill')
            .map((a) => a.id);
    }, [fillState]);

    if (state.status === 'loading') {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Scanning the page…
            </div>
        );
    }

    if (state.status === 'empty') {
        /*
         * A page we have no access to reads exactly like a page with no job on
         * it, and the fix is completely different. The manifest declares nine
         * job boards; on anything else the content script never ran, so there
         * is nothing to re-scan — the user has to grant this one site first.
         *
         * Offering "Re-scan" there is the wrong button: it cannot work, and
         * repeating it is all the panel gave them.
         */
        if (siteAccess.access.status === 'grantable') {
            return (
                <div className="card p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4" /> Patronus is off on this site
                    </div>
                    <p className="text-muted-foreground">
                        We only ask for the job boards we know how to read. Turn it on for{' '}
                        <span className="font-medium text-foreground">{siteAccess.access.host}</span>{' '}
                        and we will read this page too.
                    </p>
                    <button
                        type="button"
                        onClick={() => void siteAccess.grant()}
                        className="btn-primary mt-3 text-xs"
                    >
                        Enable on {siteAccess.access.host}
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">
                        This site only. You can remove it any time in Settings.
                    </p>
                </div>
            );
        }

        return (
            <div className="card p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                    <FileSearch className="h-4 w-4" /> No job page detected
                </div>
                <p className="text-muted-foreground">
                    Open a job listing or application form and reopen this panel.
                </p>
                <button type="button" onClick={reparse} className="btn-outline mt-3 text-xs">
                    Re-scan this page
                </button>
            </div>
        );
    }

    const { pageModel } = state;
    const jd = pageModel.jobDescription;
    const actions = fillState.status === 'ready' ? fillState.plan.actions : [];
    const safeCount = safeIdsForBulk.length;
    const reviewCount = actions.filter(
        (a) => a.canApply && a.action !== 'auto_fill'
    ).length;
    const autofillEnabled = completeness.complete && safeCount > 0 && !applying;

    const handleBulkFill = async () => {
        if (!autofillEnabled) return;
        setApplying(true);
        const ids = safeIdsForBulk;
        const outcome = await apply(ids);
        setApplying(false);
        if (outcome) {
            const appliedCount = outcome.appliedCount ?? 0;
            setFilledIds((prev) => {
                const next = new Set(prev);
                for (const id of ids) next.add(id);
                return next;
            });
            if (appliedCount > 0) {
                setLastApplied({ count: appliedCount, key: `bulk-${(fillSeq.current += 1)}` });
            }
            trackExtensionEvent('fill.applied', {
                count: appliedCount,
                source: 'bulk',
                platform: pageModel.classification.platform,
            });
        }
    };

    const handleFillSingle = async (id: string) => {
        const action = actions.find((a) => a.id === id);
        if (!action) return;
        setApplying(true);
        const outcome = await apply([id]);
        setApplying(false);
        if (outcome) {
            const appliedCount = outcome.appliedCount ?? 0;
            if (appliedCount > 0) {
                setFilledIds((prev) => new Set(prev).add(id));
                setLastApplied({ count: appliedCount, key: `single-${id}-${(fillSeq.current += 1)}` });
            }
            trackExtensionEvent('fill.applied', {
                count: appliedCount,
                source: 'single',
                semanticKey: action.fieldKey,
                band: action.confidenceBand,
            });
        }
    };

    const handleUndo = async () => {
        await undo();
        setFilledIds(new Set());
        setLastApplied(null);
    };

    /**
     * Bind this tab's session to a workspace, creating one if the job is new.
     *
     * Without this, `ApplicationSession.workspaceId` stayed null for every
     * application filled through the extension, so nothing the user did here
     * ever reached the tracker on the web.
     */
    const handleTrack = async () => {
        if (state.status !== 'ready') return;
        setTracking(true);
        setTrackError(null);

        const res = await request<{ workspaceId?: string; matchedBy?: string }>({
            type: 'TRACK_APPLICATION',
            tabId: state.tabId,
        });
        setTracking(false);

        if (!res.ok) {
            setTrackError(
                res.error === 'not_authenticated'
                    ? 'Connect your account in Settings to track applications.'
                    : 'Could not track this application.',
            );
            return;
        }
        setTrackedNow(true);
        trackExtensionEvent('workspace.saved', { matchedBy: res.data?.matchedBy ?? 'unknown' });
    };

    const isTracked = Boolean(session?.workspaceId) || trackedNow;

    return (
        <div className="space-y-3">
            <ProfileCompletenessBanner appBase={appBase} />

            <section className="card p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold leading-tight">
                        {(pageModel.metadata['roleTitle'] as string) ?? pageModel.heading ?? 'Job page'}
                    </h2>
                    <span className="chip border-border bg-muted text-muted-foreground capitalize">
                        {pageModel.classification.platform}
                    </span>
                </div>
                {pageModel.metadata['companyName'] ? (
                    <p className="text-sm text-muted-foreground">
                        {pageModel.metadata['companyName'] as string}
                    </p>
                ) : null}
                {jd ? (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className={cn('chip', BAND_STYLES[jd.confidenceBand])}>
                            JD {jd.confidenceBand}
                        </span>
                        <span className="text-muted-foreground">{jd.text.length} chars</span>
                    </div>
                ) : null}

                <div className="mt-3 border-t pt-2">
                    {isTracked ? (
                        <p className="flex items-center gap-1.5 text-xs text-success">
                            <BookmarkCheck className="h-3.5 w-3.5" />
                            Tracked — this application is in your tracker
                        </p>
                    ) : (
                        <button
                            type="button"
                            className="btn btn-outline w-full gap-1 text-xs"
                            disabled={tracking}
                            onClick={() => void handleTrack()}
                        >
                            {tracking ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <BookmarkPlus className="h-3.5 w-3.5" />
                            )}
                            {tracking ? 'Tracking…' : 'Track this application'}
                        </button>
                    )}
                    {trackError ? (
                        <p className="mt-1 text-xs text-destructive">{trackError}</p>
                    ) : null}
                </div>
                {session ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Layers className="h-3.5 w-3.5" />
                        <span>
                            Step {session.step.index}
                            {session.step.total ? ` of ${session.step.total}` : ''} ·{' '}
                            {session.history.length} visited
                        </span>
                    </div>
                ) : null}
            </section>

            {lastApplied ? (
                <FillUndoToast
                    key={lastApplied.key}
                    appliedCount={lastApplied.count}
                    onUndo={handleUndo}
                    onDismiss={dismissToast}
                />
            ) : null}

            <section className="card p-3">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">Fields detected</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {pageModel.stats.visibleFieldCount} total
                    </span>
                </div>
                <button
                    type="button"
                    disabled={!autofillEnabled}
                    onClick={handleBulkFill}
                    className="btn-primary w-full"
                    title={
                        !completeness.complete && completeness.ready
                            ? 'Complete your profile to enable autofill'
                            : safeCount === 0
                              ? 'No high-confidence fields ready to fill'
                              : undefined
                    }
                >
                    {applying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Fill {safeCount} ready field{safeCount === 1 ? '' : 's'}
                </button>
                {reviewCount > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {reviewCount} field{reviewCount === 1 ? '' : 's'} need review.
                    </p>
                ) : null}
                {actions.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                        {actions.map((action) => (
                            <FieldRow
                                key={action.id}
                                action={action}
                                filled={filledIds.has(action.id)}
                                onFill={() => handleFillSingle(action.id)}
                            />
                        ))}
                    </div>
                ) : null}
            </section>

            <QuestionsCard questions={pageModel.questions} />

            <button
                type="button"
                onClick={reparse}
                className="btn-ghost w-full text-xs text-muted-foreground"
            >
                Re-scan this page
            </button>
        </div>
    );
}
