'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    answerScout,
    draftScoutMessage,
    getScout,
    getScoutSteps,
    refreshScout,
    type ScoutStepView,
} from '@/actions/scout';
import type { ClassifyData, IngestData, ScoutRunView, TrackData } from '@/lib/scout/types';
import { JobStatusMenu } from '@/components/inbox/JobStatusMenu';

import { DraftsPanel } from './DraftsPanel';
import { isLive, KIND_LABEL, relativeTime } from './format';
import { KindIcon, RunStatusLabel, SourceLink } from './parts';
import { QuestionCard } from './QuestionCard';
import { CONTENT_SECTIONS, SectionCard, type DraftRequest } from './SectionCards';
import { StepTimeline } from './StepTimeline';
import { EntitlementNotice } from './EntitlementNotice';

const POLL_MS = 2_000;

/**
 * One Scout run, live.
 *
 * Polls every 2 s while the run can change by itself (queued / running) and
 * stops the moment it cannot — a finished run on an idle tab costs nothing.
 * Answering or refreshing puts the run back in the queue, which restarts the
 * poll through the same status check rather than a second timer.
 */
export function ScoutRunScreen({
    initialRun,
    initialSteps,
}: {
    initialRun: ScoutRunView;
    initialSteps: ScoutStepView[];
}) {
    const [run, setRun] = React.useState(initialRun);
    const [steps, setSteps] = React.useState(initialSteps);
    const [answering, setAnswering] = React.useState(false);
    const [answerError, setAnswerError] = React.useState<string | null>(null);
    const [refreshing, setRefreshing] = React.useState(false);
    const [draftPending, setDraftPending] = React.useState<DraftRequest | null>(null);
    const [notice, setNotice] = React.useState<{ message: string; entitlement: boolean } | null>(null);

    const live = isLive(run.status);

    const reload = React.useCallback(async () => {
        const [nextRun, nextSteps] = await Promise.all([getScout(run.id), getScoutSteps(run.id)]);
        if (nextRun.success) setRun(nextRun.data);
        if (nextSteps.success) setSteps(nextSteps.data);
    }, [run.id]);

    React.useEffect(() => {
        if (!live) return;
        let cancelled = false;
        let timer: number | undefined;
        const tick = async () => {
            await reload().catch(() => undefined);
            if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
        };
        timer = window.setTimeout(tick, POLL_MS);
        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
        };
    }, [live, reload]);

    const onAnswer = async (value: string) => {
        setAnswering(true);
        setAnswerError(null);
        const result = await answerScout({ runId: run.id, value });
        setAnswering(false);
        if (!result.success) {
            setAnswerError(result.error);
            return;
        }
        setRun(result.data);
    };

    const onRefresh = async () => {
        setRefreshing(true);
        setNotice(null);
        const result = await refreshScout(run.id);
        setRefreshing(false);
        if (!result.success) {
            setNotice({ message: result.error, entitlement: result.code === 'entitlement_required' });
            return;
        }
        setRun(result.data);
        void reload();
    };

    const onDraft = async (request: DraftRequest) => {
        setDraftPending(request);
        setNotice(null);
        const result = await draftScoutMessage({
            runId: run.id,
            target: request.target,
            format: request.format,
            contactId: request.contactId,
        });
        setDraftPending(null);
        if (!result.success) {
            setNotice({ message: result.error, entitlement: result.code === 'entitlement_required' });
            return;
        }
        setRun((current) => ({ ...current, drafts: [...current.drafts, result.data] }));
    };

    const ingest = run.sections.ingest?.status === 'ok' ? (run.sections.ingest.data as IngestData) : null;
    const classify = run.sections.classify?.status === 'ok' ? (run.sections.classify.data as ClassifyData) : null;
    const sourceUrl = ingest?.sourceUrl ?? run.input.url ?? null;
    const visible = CONTENT_SECTIONS.filter((name) => run.plan.includes(name));
    const canDraft = run.kind === 'job_posting' || run.kind === 'hiring_post';
    const track = run.sections.track?.status === 'ok' ? (run.sections.track.data as TrackData) : null;

    return (
        <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:py-10">
            <Link
                href="/scout"
                className={cn(typeStyles.small, 'inline-flex items-center gap-1 text-muted-foreground hover:text-foreground')}
            >
                <ArrowLeft aria-hidden className="size-3.5" />
                Inbox
            </Link>

            <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className={cn(typeStyles.caption, 'flex items-center gap-1.5 text-muted-foreground')}>
                        <KindIcon kind={run.kind} className="size-3.5" />
                        {run.kind ? KIND_LABEL[run.kind] : 'Link'}
                        {classify && classify.confidence < 0.5 ? ' (best guess)' : ''}
                        <span aria-hidden>·</span>
                        {relativeTime(run.createdAt)}
                    </p>
                    <h1 className={cn(typeStyles.h1, 'mt-1 text-foreground')}>{run.headline}</h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <RunStatusLabel status={run.status} />
                        {sourceUrl ? <SourceLink url={sourceUrl} title={ingest?.title} /> : null}
                        {ingest?.author ? (
                            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>by {ingest.author}</span>
                        ) : null}
                        {ingest?.applicantsText ? (
                            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{ingest.applicantsText}</span>
                        ) : null}
                    </div>
                    {classify?.reason ? (
                        <p className={cn(typeStyles.small, 'mt-2 text-muted-foreground')}>{classify.reason}</p>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-start gap-2 self-start">
                    {/* Where this job stands, before anything else on the page. */}
                    {track ? <JobStatusMenu target={{ runId: run.id }} status={track.status} /> : null}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={onRefresh}
                        disabled={live || refreshing}
                    >
                        {refreshing ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
                        Refresh
                    </Button>
                </div>
            </header>

            <div className="mt-6 space-y-4">
                {notice ? <EntitlementNotice message={notice.message} entitlement={notice.entitlement} /> : null}

                {run.status === 'failed' && run.error ? (
                    <section className="surface-work rounded-xl border border-border bg-card p-5">
                        <p className={cn(typeStyles.h3, 'text-foreground')}>This one did not finish</p>
                        <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>{run.error}</p>
                        {!ingest ? (
                            <p className={cn(typeStyles.small, 'mt-2 text-muted-foreground')}>
                                If LinkedIn hid the post behind a login, paste the post text on the{' '}
                                <Link href="/scout" className="underline hover:text-foreground">Scout page</Link> instead.
                            </p>
                        ) : null}
                    </section>
                ) : null}

                {run.pendingQuestion && run.status === 'awaiting_input' ? (
                    <QuestionCard question={run.pendingQuestion} pending={answering} error={answerError} onAnswer={onAnswer} />
                ) : null}

                {run.kind === 'other' && run.status !== 'failed' ? (
                    <section className="surface-work rounded-xl border border-border bg-card p-5">
                        <p className={cn(typeStyles.h3, 'text-foreground')}>Nothing to act on here</p>
                        <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                            This is not a job, a hiring post, company news or something worth saving. Nothing was charged beyond reading it.
                        </p>
                    </section>
                ) : null}

                {visible.map((name) => (
                    <SectionCard
                        key={name}
                        name={name}
                        sections={run.sections}
                        live={live}
                        onDraft={onDraft}
                        pendingDraftKey={draftPending?.key ?? null}
                        draftsDisabled={!canDraft || draftPending !== null}
                    />
                ))}

                {/* Classification has not run yet, so the plan is unknown: show that work is happening. */}
                {visible.length === 0 && live ? (
                    <section className="surface-work rounded-xl border border-border bg-card p-5">
                        <p className={cn(typeStyles.small, 'flex items-center gap-2 text-muted-foreground')}>
                            <Loader2 aria-hidden className="size-3.5 animate-spin" />
                            {ingest ? 'Working out what this is…' : 'Reading the link…'}
                        </p>
                    </section>
                ) : null}

                <DraftsPanel drafts={run.drafts} pendingLabel={draftPending?.label ?? null} />

                <StepTimeline steps={steps} />
            </div>
        </div>
    );
}
