'use client';

import * as React from 'react';
import { ArrowUp, Loader2, RotateCcw } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { sendChatMessage, type ChatThread } from '@/actions/chat';
import type { ChatSuggestion } from '@/lib/chat/suggestions';
import type { ChatMessageView } from '@/lib/chat/types';
import { cn } from '@/lib/utils';

import { ChatCardView, ChatLinksContext, type ChatLinks } from './ChatCards';

const MAX_CHARS = 4_000;

type Pending = { clientId: string; text: string; error: string | null };

function newClientId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Avatar() {
    return (
        <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-xs font-bold text-primary">
            P
        </span>
    );
}

function Typing() {
    return (
        <div className="flex items-center gap-3" role="status" aria-label="Patronus is working">
            <Avatar />
            <span className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                    <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />
                ))}
            </span>
        </div>
    );
}

function greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function Bubble({ message, onSend }: { message: ChatMessageView; onSend: (text: string) => void }) {
    if (message.role === 'user') {
        return (
            <div className="flex justify-end">
                <p className={cn(typeStyles.body, 'max-w-[80%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-primary-foreground')}>
                    {message.text}
                </p>
            </div>
        );
    }
    return (
        <div className="flex gap-3">
            <Avatar />
            <div className="min-w-0 max-w-[92%] flex-1 space-y-2 pt-0.5">
                {message.text ? <p className={cn(typeStyles.body, 'whitespace-pre-wrap [overflow-wrap:anywhere]')}>{message.text}</p> : null}
                {message.cards.map((card, i) => (
                    <ChatCardView key={`${message.id}:${i}`} card={card} onSend={onSend} />
                ))}
            </div>
        </div>
    );
}

function Empty({ suggestions, onPick, name }: { suggestions: ChatSuggestion[]; onPick: (s: ChatSuggestion) => void; name: string | null }) {
    return (
        <div className="mx-auto max-w-xl pb-8 pt-10 sm:pt-16">
            <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-primary font-heading text-lg font-bold text-primary-foreground">P</span>
            <h1 className={cn(typeStyles.display, 'mt-5')}>{greeting()}{name ? `, ${name}` : ''}.</h1>
            <p className={cn(typeStyles.bodyRead, 'mt-2 text-muted-foreground')}>
                Send me a job link, tell me what you shipped, or ask about a company. I keep it all in your record,
                and I never make up a number.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((s, i) => (
                    <button
                        key={s.label}
                        type="button"
                        onClick={() => onPick(s)}
                        // Four on a phone, so the composer never covers the last one.
                        className={cn(i >= 4 && 'hidden sm:block', 'rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5')}
                    >
                        <span className={cn(typeStyles.body, 'block font-medium text-foreground')}>{s.label}</span>
                        <span className={cn(typeStyles.small, 'mt-0.5 block truncate text-muted-foreground')}>{s.prefill ? `${s.message}…` : s.message}</span>
                    </button>
                ))}
            </div>
            <p className={cn(typeStyles.small, 'mt-6 text-muted-foreground xl:hidden')}>
                On your phone? <a href="/settings/channels" className="underline">Link Telegram</a> and message the same assistant there.
            </p>
        </div>
    );
}

function Suggestions({
    suggestions,
    onPick,
    className,
}: {
    suggestions: ChatSuggestion[];
    onPick: (s: ChatSuggestion) => void;
    className?: string;
}) {
    if (suggestions.length === 0) return null;
    return (
        <div className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible', className)}>
            {suggestions.map((s) => (
                <Button key={s.label} size="sm" variant="outline" className="shrink-0 rounded-full" onClick={() => onPick(s)}>
                    {s.label}
                </Button>
            ))}
        </div>
    );
}

export function ChatScreen({ initial, links = { scout: true, workLog: true }, name = null, prefill = '' }: { initial: ChatThread; links?: ChatLinks; name?: string | null; /** From Home's "Ask Patronus": put in the composer, not sent. */ prefill?: string }) {
    const [messages, setMessages] = React.useState<ChatMessageView[]>(initial.messages);
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [draft, setDraft] = React.useState(prefill);
    const endRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [messages.length, pending]);

    const busy = Boolean(pending && !pending.error);

    const send = React.useCallback(async (text: string, clientId: string = newClientId()) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setPending({ clientId, text: trimmed, error: null });
        setDraft('');
        const result = await sendChatMessage({ text: trimmed, clientId });
        if (!result.success) {
            // Keep the text and the clientId: a retry is the same message.
            setPending({ clientId, text: trimmed, error: result.error });
            return;
        }
        setMessages((current) => [...current, result.data.user, result.data.assistant]);
        setPending(null);
        inputRef.current?.focus();
    }, []);

    const pick = (s: ChatSuggestion) => {
        if (s.prefill) {
            setDraft(s.message);
            inputRef.current?.focus();
            return;
        }
        void send(s.message);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy) void send(draft);
        }
    };

    return (
        <ChatLinksContext.Provider value={links}>
        {/* The page scrolls and the composer sticks: a fixed-height pane under
            an in-flow banner pushed the composer below the screen on phones. */}
        <div data-center className="mx-auto flex min-h-[calc(100dvh-var(--shell-top,0px)-4rem)] w-full max-w-3xl flex-col px-4 sm:px-6 md:min-h-dvh">
            <div className="flex-1 space-y-5 py-6" aria-live="polite">
                {messages.length === 0 && !pending ? <Empty suggestions={initial.suggestions} onPick={pick} name={name} /> : null}
                {messages.map((message) => (
                    <Bubble key={message.id} message={message} onSend={(text) => void send(text)} />
                ))}
                {pending ? (
                    <>
                        <div className="flex justify-end">
                            <p className={cn(typeStyles.body, 'max-w-[80%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-primary-foreground', pending.error && 'opacity-60')}>
                                {pending.text}
                            </p>
                        </div>
                        {pending.error ? (
                            <div className="flex items-center justify-end gap-2">
                                <p className={cn(typeStyles.caption, 'text-destructive')}>{pending.error}</p>
                                <Button size="sm" variant="ghost" onClick={() => void send(pending.text, pending.clientId)}>
                                    <RotateCcw className="size-3.5" aria-hidden /> Retry
                                </Button>
                            </div>
                        ) : (
                            <Typing />
                        )}
                    </>
                ) : null}
                <div ref={endRef} />
            </div>

            {/* Above the phone tab bar (h-16); at the bottom on desktop. */}
            <div className="sticky bottom-16 -mx-4 border-t border-border bg-background px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 md:bottom-0 md:pb-[max(1rem,env(safe-area-inset-bottom))]">
                {messages.length > 0 ? <Suggestions suggestions={initial.suggestions} onPick={pick} className="mb-3" /> : null}
                <form
                    className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!busy) void send(draft);
                    }}
                >
                    <label htmlFor="chat-input" className="sr-only">Message</label>
                    <textarea
                        id="chat-input"
                        ref={inputRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.slice(0, MAX_CHARS))}
                        onKeyDown={onKeyDown}
                        rows={1}
                        placeholder="Paste a job link, log a win, or ask anything about your search"
                        // 16px on phones: iOS zooms the page into any smaller input.
                        className={cn(typeStyles.body, 'max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none [field-sizing:content] sm:text-sm')}
                    />
                    <Button type="submit" size="icon" className="rounded-full" disabled={busy || !draft.trim()} aria-label="Send">
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </Button>
                </form>
            </div>
        </div>
        </ChatLinksContext.Provider>
    );
}
