'use client';

import * as React from 'react';
import Link from 'next/link';
import {
    ArrowUpRight,
    Check,
    CircleCheck,
    Copy,
    Download,
    ExternalLink,
    FileText,
    Loader2,
    Mail,
    MailOpen,
    MapPin,
    MessageSquare,
    NotebookPen,
    Rocket,
    Search,
    X,
} from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { KIND_ICON, VerdictChip } from '@/components/scout/parts';
import { RUN_STATUS_LABEL, safeHref } from '@/components/scout/format';
import {
    applyFromChat,
    confirmChatDraft,
    dismissChatDraft,
    markChatDraftApplied,
    markChatDraftOpened,
    refreshChatCard,
    setChatDraftSensitivity,
    skipApplyFromChat,
} from '@/actions/chat';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { APPLY_STAGE_TEXT } from '@/lib/chat/renderText';
import type { ChatCard, ChatJob } from '@/lib/chat/types';
import { composeLinks } from '@/lib/drafts/compose';
import { cn } from '@/lib/utils';

/** Which full pages exist for this user. A card never links to a switched-off page. */
export type ChatLinks = { scout: boolean; workLog: boolean };
export const ChatLinksContext = React.createContext<ChatLinks>({ scout: true, workLog: true });

/** Re-read the thread: a card whose work just finished elsewhere (the apply chain) has a message to show. */
export const ChatThreadContext = React.createContext<{ refresh: () => void }>({ refresh: () => undefined });

const POLL_MS = 3_000;
/** Stop polling after this long; the full page is one tap away. */
const POLL_LIMIT_MS = 5 * 60_000;
/** The apply chain reads the job, then tailors a resume: give it longer. */
const APPLY_POLL_LIMIT_MS = 20 * 60_000;

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn('rounded-lg border border-border bg-card p-3', className)}>{children}</div>;
}

/** A card that re-reads itself while it is still in progress. Re-arms when it goes live again. */
function useLiveCard<T extends ChatCard>(initial: T, isLive: (card: T) => boolean, limitMs: number = POLL_LIMIT_MS): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [card, setCard] = React.useState(initial);
    React.useEffect(() => {
        if (!isLive(card)) return;
        const started = Date.now();
        let cancelled = false;
        const timer = setInterval(async () => {
            if (Date.now() - started > limitMs) return clearInterval(timer);
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
    const links = React.useContext(ChatLinksContext);
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
                {links.scout ? (
                    <Button asChild size="sm" variant={live ? 'ghost' : 'outline'}>
                        <Link href={`/scout/${card.runId}`}>
                            {card.status === 'awaiting_input' ? 'Answer' : live ? 'Watch' : 'Open'}
                            <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                    </Button>
                ) : null}
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── Win draft

function WinDraftCard({ card }: { card: Extract<ChatCard, { type: 'win_draft' }> }) {
    const links = React.useContext(ChatLinksContext);
    const [state, setState] = React.useState<'draft' | 'confirmed' | 'dismissed' | 'busy'>(card.current ?? 'draft');
    const [error, setError] = React.useState<string | null>(null);
    const [sensitivity, setSensitivity] = React.useState(card.sensitivity ?? 'shareable');

    const share = async () => {
        const result = await setChatDraftSensitivity({ winId: card.winId, sensitivity: 'shareable' });
        if (result.success) setSensitivity('shareable');
        else setError(result.error);
    };

    if (card.status === 'merge_proposed') {
        return (
            <Shell>
                <p className={cn(typeStyles.body, 'font-medium')}>{card.title}</p>
                <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>Already in My work.</p>
                {links.workLog ? (
                    <Button asChild size="sm" variant="link" className="mt-1 h-auto px-0">
                        <Link href="/log">Open My work</Link>
                    </Button>
                ) : null}
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
                    {sensitivity !== 'shareable' && state !== 'dismissed' ? (
                        <p className={cn(typeStyles.caption, 'mt-2 flex flex-wrap items-center gap-2 text-muted-foreground')}>
                            {sensitivity === 'confidential' ? 'Marked confidential' : 'Marked internal only'}: kept out of resumes and search.
                            <button type="button" onClick={() => void share()} className="underline">Use it on resumes</button>
                        </p>
                    ) : null}
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
                            {links.workLog ? (
                                <Button asChild size="sm" variant="ghost">
                                    <Link href="/log">Edit in My work</Link>
                                </Button>
                            ) : null}
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
                {shown.status === 'completed' && (shown.resumeId || shown.pdfUrl) ? (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {shown.pdfUrl ? (
                            <Button asChild size="sm" variant="ghost">
                                <a href={shown.pdfUrl}>
                                    <Download className="size-3.5" aria-hidden /> PDF
                                </a>
                            </Button>
                        ) : null}
                        {shown.resumeId ? (
                            <Button asChild size="sm" variant="outline">
                                <Link href={`/editor/${shown.resumeId}`}>
                                    Open <ArrowUpRight className="size-3.5" aria-hidden />
                                </Link>
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── apply chain

type ApplyCard = Extract<ChatCard, { type: 'apply_chain' }>;

const APPLY_LIVE = (card: ApplyCard) => card.stage === 'pending' || card.stage === 'tailoring' || card.stage === 'drafting';

/**
 * "Apply for me" in the chat: where the chain stands, re-read while it
 * works. When it settles, the thread is re-read, which brings in the resume
 * and the draft the chain appended. A held chain asks here, as Telegram does.
 */
function ApplyChainCard({ initial }: { initial: ApplyCard }) {
    const [card, setCard] = useLiveCard(initial, APPLY_LIVE, APPLY_POLL_LIMIT_MS);
    const links = React.useContext(ChatLinksContext);
    const thread = React.useContext(ChatThreadContext);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const live = APPLY_LIVE(card);

    // Settled while watched: the result message is in the thread now.
    const wasLive = React.useRef(live);
    React.useEffect(() => {
        if (wasLive.current && !live) thread.refresh();
        wasLive.current = live;
    }, [live, thread]);

    const act = async (kind: 'anyway' | 'skip' | 'retry') => {
        setBusy(true);
        setError(null);
        const result = kind === 'skip' ? await skipApplyFromChat(card.runId) : await applyFromChat({ runId: card.runId, override: kind === 'anyway' });
        setBusy(false);
        if (!result.success) {
            setError(result.error);
            return;
        }
        setCard(result.data as ApplyCard);
    };

    const done = card.stage === 'drafted' || card.stage === 'applied';
    return (
        <Shell>
            <div className="flex items-start gap-3">
                <Rocket className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className={cn(typeStyles.body, 'font-medium')}>Applying{card.title ? ` to ${card.title}` : ''}</p>
                    <p className={cn(typeStyles.caption, 'mt-0.5 inline-flex items-center gap-1 text-muted-foreground')}>
                        {live ? <Loader2 className="size-3 animate-spin" aria-hidden /> : done ? <Check className="size-3 text-success" aria-hidden /> : null}
                        {APPLY_STAGE_TEXT[card.stage]}
                        {card.stage === 'drafted' ? '. Both are below.' : ''}
                    </p>
                    {card.reason && (card.stage === 'eligibility_hold' || card.stage === 'stopped') ? (
                        <p className={cn(typeStyles.small, 'mt-2')}>{card.reason}</p>
                    ) : null}
                    {card.stage === 'eligibility_hold' ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => act('anyway')} disabled={busy}>
                                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Yes, apply anyway
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => act('skip')} disabled={busy}>No, skip it</Button>
                        </div>
                    ) : card.stage === 'stopped' && card.code === 'no_base_resume' ? (
                        <Button asChild size="sm" variant="outline" className="mt-2">
                            <Link href="/build">Upload your resume</Link>
                        </Button>
                    ) : card.stage === 'stopped' && card.code !== 'not_applicable' && card.code !== 'unsupported_channel' ? (
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => act('retry')} disabled={busy}>
                            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Try again
                        </Button>
                    ) : null}
                    {error ? <p className={cn(typeStyles.caption, 'mt-2 text-destructive')}>{error}</p> : null}
                </div>
                {links.scout ? (
                    <Button asChild size="sm" variant="ghost">
                        <Link href={`/scout/${card.runId}`}>
                            Job <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                    </Button>
                ) : null}
            </div>
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── application draft

/**
 * The chain's application draft. An email opens in the user's own Gmail or
 * mail app (prefilled, never sent from here); a LinkedIn message is copied,
 * with the posting's application link. Shorter / Stronger live on the job
 * page, on the same versioned draft.
 */
function MessageDraftCard({ card }: { card: Extract<ChatCard, { type: 'message_draft' }> }) {
    const links = React.useContext(ChatLinksContext);
    const [copied, setCopied] = React.useState(false);
    const [applied, setApplied] = React.useState(Boolean(card.applied));
    const [busy, setBusy] = React.useState(false);
    const [note, setNote] = React.useState<{ text: string; error: boolean } | null>(null);
    const email = card.format === 'email';
    const compose = composeLinks(card);
    const apply = safeHref(card.applyUrl);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText([card.subject ? `Subject: ${card.subject}` : null, card.body].filter(Boolean).join('\n\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
        } catch {
            setCopied(false);
        }
    };
    const opened = (via: 'gmail' | 'mail') => void markChatDraftOpened({ draftId: card.draftId, via }).catch(() => undefined);
    const markApplied = async () => {
        setBusy(true);
        setNote(null);
        const result = await markChatDraftApplied(card.draftId);
        setBusy(false);
        if (!result.success) {
            setNote({ text: result.error, error: true });
            return;
        }
        setApplied(true);
        setNote({ text: result.data.message, error: false });
    };

    return (
        <Shell>
            <p className={cn(typeStyles.caption, 'flex items-center gap-1.5 text-muted-foreground')}>
                {email ? <Mail className="size-3.5" aria-hidden /> : <MessageSquare className="size-3.5" aria-hidden />}
                {email ? 'Application email' : `LinkedIn message to the ${card.target === 'poster' ? 'poster' : 'recruiter'}`}
                {card.version > 1 ? <span className="num">· v{card.version}</span> : null}
            </p>
            <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                {email ? (
                    <>
                        <div className="flex gap-3 px-3 py-1.5">
                            <dt className={cn(typeStyles.small, 'w-14 shrink-0 text-muted-foreground')}>To</dt>
                            <dd className={cn(typeStyles.small, 'min-w-0 break-all')}>{card.toEmail ?? 'Add the address in your mail app'}</dd>
                        </div>
                        <div className="flex gap-3 px-3 py-1.5">
                            <dt className={cn(typeStyles.small, 'w-14 shrink-0 text-muted-foreground')}>Subject</dt>
                            <dd className={cn(typeStyles.small, 'min-w-0')}>{card.subject ?? ''}</dd>
                        </div>
                    </>
                ) : null}
                <div className="px-3 py-2">
                    <dt className="sr-only">Body</dt>
                    <dd className={cn(typeStyles.small, 'whitespace-pre-wrap')}>{card.body}</dd>
                </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
                {email && compose.gmail ? (
                    <Button asChild size="sm">
                        <a href={compose.gmail} target="_blank" rel="noopener noreferrer" onClick={() => opened('gmail')}>
                            <MailOpen className="size-3.5" aria-hidden /> Open in Gmail
                        </a>
                    </Button>
                ) : null}
                {email && compose.mailto ? (
                    <Button asChild size="sm" variant="outline">
                        <a href={compose.mailto} onClick={() => opened('mail')}>
                            <Mail className="size-3.5" aria-hidden /> Mail app
                        </a>
                    </Button>
                ) : null}
                {!email && apply ? (
                    <Button asChild size="sm">
                        <a href={apply} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3.5" aria-hidden /> Open the application
                        </a>
                    </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={copy}>
                    {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
                {applied ? (
                    <span className={cn(typeStyles.caption, 'inline-flex items-center gap-1 self-center text-success')}>
                        <CircleCheck className="size-3.5" aria-hidden /> Applied
                    </span>
                ) : (
                    <Button size="sm" variant="ghost" onClick={markApplied} disabled={busy}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                        Mark as applied
                    </Button>
                )}
            </div>
            {note ? <p className={cn(typeStyles.caption, 'mt-2', note.error ? 'text-destructive' : 'text-muted-foreground')}>{note.text}</p> : null}
            {links.scout && card.runId ? (
                <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>
                    Shorter, stronger or in your own words:{' '}
                    <Link href={`/scout/${card.runId}`} className="underline hover:text-foreground">edit it on the job page</Link>.
                </p>
            ) : null}
        </Shell>
    );
}

// ───────────────────────────────────────────────────────────── outreach

function OutreachCard({ card }: { card: Extract<ChatCard, { type: 'outreach' }> }) {
    const links = React.useContext(ChatLinksContext);
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
                {links.scout ? (
                    <Button asChild size="sm" variant="ghost">
                        <Link href={`/scout/${card.runId}`}>More drafts</Link>
                    </Button>
                ) : null}
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
    const links = React.useContext(ChatLinksContext);
    const href = job.runId && links.scout ? `/scout/${job.runId}` : safeHref(job.sourceUrl);
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
    const links = React.useContext(ChatLinksContext);
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
            {links.workLog ? (
                <Button asChild size="sm" variant="link" className="mt-1 h-auto px-0">
                    <Link href="/log">Open My work</Link>
                </Button>
            ) : null}
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
        case 'apply_chain':
            return <ApplyChainCard initial={card} />;
        case 'message_draft':
            return <MessageDraftCard card={card} />;
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
