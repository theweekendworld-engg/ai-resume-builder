'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Info, Loader2, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import { CaptureRail } from './CaptureRail';
import { ClosingScreen } from './ClosingScreen';
import { backfillData, type BackfillBootstrap } from './data-source';
import type { CapturedWinView, ChatMessage, NoticeView, ProgressView } from './types';

/**
 * `/log/backfill/[sessionId]` — design/02 §I.
 *
 * A split view: the conversation on the left, the record filling on the right.
 * Four things on this screen are load-bearing and should not be "simplified"
 * away:
 *
 * 1. **One question is visible at a time**, and the composer is under it. The
 *    screen never shows two things to answer.
 * 2. **"I don't remember" is a real button of equal weight.** Making the exit
 *    easy is what keeps the conversation moving; hiding it behind a link turns
 *    a ten-minute chat into an interrogation.
 * 3. **Progress is honest** — "Question 4 · about 5 minutes left", a count and
 *    an estimate, never a progress bar that pretends to know.
 * 4. **Pause carries no confirmation dialog.** Everything captured is already a
 *    saved draft, so there is nothing to warn about, and a "are you sure?" here
 *    would imply there is.
 */

export interface BackfillChatProps {
    bootstrap: BackfillBootstrap;
}

export function BackfillChat({ bootstrap }: BackfillChatProps) {
    const router = useRouter();

    const [messages, setMessages] = React.useState<ChatMessage[]>(() =>
        seedMessages(bootstrap),
    );
    const [captured, setCaptured] = React.useState<CapturedWinView[]>(bootstrap.captured);
    const [freshIds, setFreshIds] = React.useState<string[]>([]);
    const [progress, setProgress] = React.useState<ProgressView>(bootstrap.progress);
    const [draft, setDraft] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [done, setDone] = React.useState(bootstrap.done);
    const [error, setError] = React.useState<string | null>(null);

    const composerRef = React.useRef<HTMLTextAreaElement>(null);
    const endRef = React.useRef<HTMLDivElement>(null);

    // The rail is fed by SSE, not by the action's return value. Extraction
    // finishes well before the conversational model does, so the cards land
    // while the agent is still composing — which is the entire perceived-value
    // mechanism (PRD 07 §3.3 rule 2).
    React.useEffect(() => {
        if (done) return;
        const source = new EventSource(`/api/backfill/${bootstrap.sessionId}/stream`);

        source.addEventListener('capture', (event) => {
            try {
                const payload = JSON.parse((event as MessageEvent).data) as { wins: CapturedWinView[] };
                if (!payload.wins?.length) return;
                setCaptured((current) => mergeWins(current, payload.wins));
                setFreshIds(payload.wins.map((win) => win.winId));
            } catch {
                // A malformed frame is not worth taking the rail down for.
            }
        });
        source.addEventListener('complete', () => source.close());
        source.onerror = () => source.close();

        return () => source.close();
    }, [bootstrap.sessionId, done]);

    React.useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, [messages.length, busy]);

    const submit = React.useCallback(
        async (input: { answer?: string; dontRemember?: boolean }) => {
            if (busy) return;
            const shown = input.dontRemember ? "I don't remember" : (input.answer ?? '').trim();
            if (!shown) return;

            setBusy(true);
            setError(null);
            setDraft('');
            setMessages((current) => [
                ...current,
                { id: `user-${current.length}`, role: 'user', content: shown },
            ]);

            const result = await backfillData.answer({
                sessionId: bootstrap.sessionId,
                answer: input.dontRemember ? undefined : shown,
                dontRemember: input.dontRemember,
            });

            setBusy(false);

            if (!result.success) {
                setError(result.error);
                setMessages((current) => current.slice(0, -1));
                setDraft(shown);
                return;
            }

            const turn = result.data;
            setCaptured((current) => mergeWins(current, turn.captured));
            setProgress(turn.progress);

            const agentText = [turn.acknowledgement, turn.question]
                .filter((part): part is string => Boolean(part && part.trim()))
                .join('\n\n');

            if (agentText) {
                setMessages((current) => [
                    ...current,
                    {
                        id: `agent-${current.length}`,
                        role: 'agent',
                        content: agentText,
                        notices: turn.notices,
                    },
                ]);
            }

            if (turn.done) setDone(true);
            composerRef.current?.focus();
        },
        [busy, bootstrap.sessionId],
    );

    const pause = React.useCallback(async () => {
        await backfillData.pause(bootstrap.sessionId);
        router.push('/log');
    }, [bootstrap.sessionId, router]);

    if (done) {
        return (
            <ClosingScreen sessionId={bootstrap.sessionId} captured={captured} />
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10">
            {/* ── conversation ─────────────────────────────────────────── */}
            <section className="flex min-w-0 flex-1 flex-col" aria-label="Backfill conversation">
                <header className="border-b border-border pb-3">
                    <h1 className={typeStyles.h1}>{bootstrap.subjectLabel}</h1>
                    <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground tabular-nums')}>
                        Question {progress.questionNumber} · about {progress.minutesLeft}{' '}
                        {progress.minutesLeft === 1 ? 'minute' : 'minutes'} left
                    </p>
                </header>

                <div className="flex flex-col gap-5 py-6">
                    {messages.map((message) => (
                        <Bubble key={message.id} message={message} />
                    ))}
                    {busy ? (
                        <p
                            className={cn(typeStyles.small, 'flex items-center gap-2 text-muted-foreground')}
                            aria-live="polite"
                        >
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            Writing that down
                        </p>
                    ) : null}
                    <div ref={endRef} />
                </div>

                <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
                    {error ? (
                        <p className={cn(typeStyles.small, 'text-destructive')} role="alert">
                            {error}
                        </p>
                    ) : null}

                    <Textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                void submit({ answer: draft });
                            }
                        }}
                        placeholder="Say as much or as little as you like"
                        rows={3}
                        disabled={busy}
                        aria-label="Your answer"
                        className="resize-none"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={() => void submit({ answer: draft })} disabled={busy || !draft.trim()}>
                            Send
                        </Button>
                        {/*
                          Equal visual weight, by design. An easy skip keeps the
                          conversation moving; a reluctant one stalls it.
                        */}
                        <Button
                            variant="outline"
                            onClick={() => void submit({ dontRemember: true })}
                            disabled={busy}
                        >
                            I don&rsquo;t remember
                        </Button>
                        <Button variant="ghost" className="ml-auto" onClick={() => void pause()}>
                            Pause
                        </Button>
                    </div>

                    <p className={cn(typeStyles.caption, 'flex items-center gap-1.5 text-muted-foreground')}>
                        <Lock className="size-3" aria-hidden="true" />
                        This conversation is private, and is deleted after 30 days. Everything you
                        describe is saved as a draft for you to review.
                    </p>
                </div>
            </section>

            {/* ── the record filling ───────────────────────────────────── */}
            <CaptureRail
                wins={captured}
                freshIds={freshIds}
                className="w-full shrink-0 lg:w-80"
            />
        </div>
    );
}

/* -------------------------------------------------------------------------- */

function Bubble({ message }: { message: ChatMessage }) {
    if (message.role === 'user') {
        return (
            <p
                className={cn(
                    typeStyles.bodyRead,
                    'self-end rounded-lg bg-secondary px-4 py-2.5 text-secondary-foreground',
                    'max-w-[85%] whitespace-pre-wrap',
                )}
            >
                {message.content}
            </p>
        );
    }

    return (
        <div className="max-w-[90%]">
            <p className={cn(typeStyles.bodyRead, 'whitespace-pre-wrap text-foreground')}>
                {message.content}
            </p>
            {message.notices?.map((notice, index) => (
                <Notice key={`${notice.kind}-${index}`} notice={notice} />
            ))}
        </div>
    );
}

/**
 * The confidentiality line, said out loud, at the moment of capture.
 *
 * PRD 07 §8: naming the protection is what makes people willing to keep talking
 * about the work they cannot put on a resume. Silently setting a flag protects
 * the data and loses the conversation.
 */
function Notice({ notice }: { notice: NoticeView }) {
    const Icon = notice.kind === 'sensitivity' ? Lock : Info;
    return (
        <p
            className={cn(
                typeStyles.small,
                'mt-2 flex items-start gap-1.5 rounded-md border border-border px-3 py-2 text-muted-foreground',
            )}
        >
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {notice.message}
        </p>
    );
}

function mergeWins(current: CapturedWinView[], incoming: CapturedWinView[]): CapturedWinView[] {
    const byId = new Map(current.map((win) => [win.winId, win]));
    for (const win of incoming) byId.set(win.winId, win);
    return [...byId.values()];
}

/** A resumed session renders its own history; a fresh one starts at question one. */
function seedMessages(bootstrap: BackfillBootstrap): ChatMessage[] {
    const history: ChatMessage[] = bootstrap.transcript.map((turn, index) => ({
        id: `history-${index}`,
        role: turn.role,
        content: turn.content,
    }));

    const alreadyShown = history.at(-1)?.content === bootstrap.question;
    if (bootstrap.question && !alreadyShown) {
        history.push({
            id: `agent-opening`,
            role: 'agent',
            content: [bootstrap.acknowledgement, bootstrap.question]
                .filter((part) => Boolean(part && part.trim()))
                .join('\n\n'),
        });
    }
    return history;
}
