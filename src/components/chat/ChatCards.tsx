'use client';

import * as React from 'react';
import Link from 'next/link';
import {
    ArrowUpRight,
    Check,
    Copy,
    ExternalLink,
    FileText,
    Loader2,
    MapPin,
    NotebookPen,
    Search,
    X,
} from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { KIND_ICON, VerdictChip } from '@/components/scout/parts';
import { RUN_STATUS_LABEL, safeHref } from '@/components/scout/format';
import { confirmChatDraft, dismissChatDraft, refreshChatCard } from '@/actions/chat';
import { processChannelGenerate } from '@/actions/channelGenerate';
import type { ChatCard, ChatJob } from '@/lib/chat/types';
import { cn } from '@/lib/utils';

const POLL_MS = 3_000;
/** Stop polling after this long; the full page is one tap away. */
const POLL_LIMIT_MS = 5 * 60_000;

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn('rounded-lg border border-border bg-card p-3', className)}>{children}</div>;
}

/** A card that re-reads itself while it is still in progress. Re-arms when it goes live again. */
function useLiveCard<T extends ChatCard>(initial: T, isLive: (card: T) => boolean): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [card, setCard] = React.useState(initial);
    React.useEffect(() => {
        if (!isLive(card)) return;
        const started = Date.now();
        let cancelled = false;
        const timer = setInterval(async () => {
            if (Date.now() - started > POLL_LIMIT_MS) return clearInterval(timer);
            const next = await refreshChatCard(card);
            if (!cancelled && next.success) setCard(next.data as T);
        }, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
        // Re-arm only when the live/done state flips, not on every refresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLive(card)]);
    return [card, setCard];
}

// ───────────────────────────────────────────────────────────── Scout run

const RUN_LIVE = (card: Extract<ChatCard, { type: 'scout_run' }>) => card.status === 'queued' || card.status === 'running';

function ScoutRunCard({ initial }: { initial: Extract<ChatCard, { type: 'scout_run' }> }) {
    const [card] = useLiveCard(initial, RUN_LIVE);
    const Icon = card.kind ? KIND_ICON[card.kind] : Search;
    const live = RUN_LIVE(card);
    return (
        <Shell>
            <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className={cn(typeStyles.body, 'font-medium')}>{card.headline || 'Reading the link'}</p>
                    <p className={cn(typeStyles.caption, 'mt-0.5 inline-flex items-center gap-1 text-muted-foreground')}>
                        {live ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                        {RUN_STATUS_LABEL[card.status]}
                    </p>
                </div>
                <Button asChild size="sm" variant={live ? 'ghost' : 'outline'}>
                    <Link href={`/scout/${card.runId}`}>
                        {card.status === 'awaiting_input' ? 'Answer' : live ? 'Watch' : 'Open'}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                </Button>
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── Win draft

function WinDraftCard({ card }: { card: Extract<ChatCard, { type: 'win_draft' }> }) {
    const [state, setState] = React.useState<'draft' | 'confirmed' | 'dismissed' | 'busy'>(card.current ?? 'draft');
    const [error, setError] = React.useState<string | null>(null);

    if (card.status === 'merge_proposed') {
        return (
            <Shell>
                <p className={cn(typeStyles.body, 'font-medium')}>{card.title}</p>
                <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>Already in your Work Log.</p>
                <Button asChild size="sm" variant="link" className="mt-1 h-auto px-0">
                    <Link href="/log">Open the Work Log</Link>
                </Button>
            </Shell>
        );
    }

    const act = async (kind: 'confirm' | 'dismiss') => {
        setState('busy');
        setError(null);
        const result = kind === 'confirm' ? await confirmChatDraft(card.winId) : await dismissChatDraft(card.winId);
        if (!result.success) {
            setError(result.error);
            setState('draft');
            return;
        }
        setState(kind === 'confirm' ? 'confirmed' : 'dismissed');
    };

    return (
        <Shell>
            <div className="flex items-start gap-3">
                <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className={cn(typeStyles.body, 'font-medium')}>{card.title}</p>
                    {card.narrative ? <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>{card.narrative}</p> : null}
                    {state === 'confirmed' ? (
                        <p className={cn(typeStyles.caption, 'mt-2 inline-flex items-center gap-1 text-success')}>
                            <Check className="size-3.5" aria-hidden /> In your record
                        </p>
                    ) : state === 'dismissed' ? (
                        <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>Dismissed. It will not show up in your log.</p>
                    ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => act('confirm')} disabled={state === 'busy'}>
                                {state === 'busy' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                                Confirm
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => act('dismiss')} disabled={state === 'busy'}>
                                <X className="size-3.5" aria-hidden /> Dismiss
                            </Button>
                            <Button asChild size="sm" variant="ghost">
                                <Link href="/log">Edit in the Work Log</Link>
                            </Button>
                        </div>
                    )}
                    {error ? <p className={cn(typeStyles.caption, 'mt-2 text-destructive')}>{error}</p> : null}
                </div>
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── generation

const GEN_LIVE = (card: Extract<ChatCard, { type: 'generation' }>) => card.status === 'generating';

function GenerationCard({ initial }: { initial: Extract<ChatCard, { type: 'generation' }> }) {
    const [card, setCard] = useLiveCard(initial, GEN_LIVE);
    const [answer, setAnswer] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const respond = async (mode: 'answer' | 'skipAll') => {
        setBusy(true);
        setError(null);
        const result = await processChannelGenerate({
            channel: 'web',
            sessionId: card.sessionId,
            ...(mode === 'answer' ? { message: answer.trim() } : { skipAll: true }),
        });
        setBusy(false);
        if (!result.success) {
            setError(result.error ?? 'Could not continue.');
            return;
        }
        setAnswer('');
        if (result.status === 'awaiting_clarification' && result.nextQuestion) {
            setCard({ ...card, status: 'awaiting_clarification', question: result.nextQuestion.question });
        } else {
            setCard({ ...card, status: result.status === 'completed' ? 'completed' : 'generating', question: null, resumeId: result.resumeId ?? card.resumeId });
        }
    };

    const shown = card;

    return (
        <Shell>
            <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className={cn(typeStyles.body, 'font-medium')}>Resume for {shown.title}</p>
                    {shown.status === 'awaiting_clarification' && shown.question ? (
                        <div className="mt-2 space-y-2">
                            <p className={typeStyles.small}>{shown.question}</p>
                            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="Your answer" />
                            <div className="flex gap-2">
                                <Button size="sm" onClick={() => respond('answer')} disabled={busy || !answer.trim()}>
                                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Answer
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => respond('skipAll')} disabled={busy}>
                                    Skip the questions
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className={cn(typeStyles.caption, 'mt-0.5 inline-flex items-center gap-1 text-muted-foreground')}>
                            {shown.status === 'generating' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3 text-success" aria-hidden />}
                            {shown.status === 'generating' ? 'Writing it from your record' : 'Ready'}
                        </p>
                    )}
                    {error ? <p className={cn(typeStyles.caption, 'mt-2 text-destructive')}>{error}</p> : null}
                </div>
                {shown.resumeId && shown.status === 'completed' ? (
                    <Button asChild size="sm" variant="outline">
                        <Link href={`/editor/${shown.resumeId}`}>
                            Open <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                    </Button>
                ) : null}
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── outreach

function OutreachCard({ card }: { card: Extract<ChatCard, { type: 'outreach' }> }) {
    const [copied, setCopied] = React.useState(false);
    const text = [card.draft.subject ? `Subject: ${card.draft.subject}` : null, card.draft.body].filter(Boolean).join('\n\n');
    const copy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
    };
    return (
        <Shell>
            {card.draft.recipientName ? <p className={cn(typeStyles.caption, 'text-muted-foreground')}>To {card.draft.recipientName}</p> : null}
            <p className={cn(typeStyles.small, 'mt-1 whitespace-pre-wrap')}>{text}</p>
            <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={copy}>
                    {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button asChild size="sm" variant="ghost">
                    <Link href={`/scout/${card.runId}`}>More drafts</Link>
                </Button>
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── lists

/** The tracker's words, not the column names (src/lib/scout/types.ts TrackedStatus). */
const STATUS_LABEL: Record<ChatJob['status'], string> = {
    discovered: 'Saved', analyzed: 'Saved', drafting: 'Drafting', in_progress: 'Applying', submitted: 'Applied',
    applied: 'Applied', in_review: 'In review', interview: 'Interviewing', offer: 'Offer', rejected: 'Rejected',
    ghosted: 'No reply', archived: 'Not interested',
};

function JobRow({ job }: { job: ChatJob }) {
    const href = job.runId ? `/scout/${job.runId}` : safeHref(job.sourceUrl);
    return (
        <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
                <p className={cn(typeStyles.body, 'font-medium')}>{job.role ?? 'Role'}{job.company ? ` · ${job.company}` : ''}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <VerdictChip verdict={job.verdict} score={job.fitScore} />
                    <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{STATUS_LABEL[job.status] ?? job.status}</span>
                </div>
                {job.topConcern ? <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>Watch out: {job.topConcern}</p> : null}
            </div>
            {href ? (
                <Button asChild size="sm" variant="ghost">
                    <Link href={href}>Open</Link>
                </Button>
            ) : null}
        </li>
    );
}

function PostingsCard({ card, onSend }: { card: Extract<ChatCard, { type: 'postings' }>; onSend: (message: string) => void }) {
    return (
        <Shell>
            <ul className="divide-y divide-border">
                {card.items.map((posting) => (
                    <li key={posting.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                            <p className={cn(typeStyles.body, 'font-medium')}>{posting.title} · {posting.company}</p>
                            <p className={cn(typeStyles.caption, 'mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground')}>
                                {posting.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{posting.location}</span> : null}
                                {posting.pay ? <span className="num">{posting.pay}</span> : null}
                            </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" onClick={() => onSend(posting.url)}>Check fit</Button>
                            {safeHref(posting.url) ? (
                                <Button asChild size="icon" variant="ghost" aria-label="Open posting">
                                    <a href={safeHref(posting.url)!} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /></a>
                                </Button>
                            ) : null}
                        </div>
                    </li>
                ))}
            </ul>
            {card.note ? <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>{card.note}</p> : null}
        </Shell>
    );
}

function RecordCard({ card }: { card: Extract<ChatCard, { type: 'record' }> }) {
    return (
        <Shell>
            <ul className="divide-y divide-border">
                {card.items.map((item) => (
                    <li key={item.winId} className="py-2 first:pt-0 last:pb-0">
                        <p className={cn(typeStyles.body, 'font-medium')}>{item.title}</p>
                        <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                            {new Date(item.occurredAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        </p>
                        {item.narrative ? <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>{item.narrative}</p> : null}
                    </li>
                ))}
            </ul>
            <Button asChild size="sm" variant="link" className="mt-1 h-auto px-0">
                <Link href="/log">Open the Work Log</Link>
            </Button>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── dispatch

export function ChatCardView({ card, onSend }: { card: ChatCard; onSend: (message: string) => void }) {
    switch (card.type) {
        case 'scout_run':
            return <ScoutRunCard initial={card} />;
        case 'win_draft':
            return <WinDraftCard card={card} />;
        case 'generation':
            return <GenerationCard initial={card} />;
        case 'outreach':
            return <OutreachCard card={card} />;
        case 'jobs':
            return (
                <Shell>
                    <ul className="divide-y divide-border">
                        {card.items.map((job) => <JobRow key={job.workspaceId} job={job} />)}
                    </ul>
                </Shell>
            );
        case 'postings':
            return <PostingsCard card={card} onSend={onSend} />;
        case 'record':
            return <RecordCard card={card} />;
        case 'link':
            return (
                <Shell className="flex items-center justify-between gap-3">
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>{card.description}</p>
                    <Button asChild size="sm">
                        <Link href={card.href}>{card.label}</Link>
                    </Button>
                </Shell>
            );
    }
}
