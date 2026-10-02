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
        <div className="max-w-[92%] space-y-2">
            {message.text ? <p className={cn(typeStyles.body, 'whitespace-pre-wrap [overflow-wrap:anywhere]')}>{message.text}</p> : null}
            {message.cards.map((card, i) => (
                <ChatCardView key={`${message.id}:${i}`} card={card} onSend={onSend} />
            ))}
        </div>
    );
}

function Empty({ suggestions, onPick }: { suggestions: ChatSuggestion[]; onPick: (s: ChatSuggestion) => void }) {
    return (
        <div className="mx-auto max-w-xl py-12 text-center">
            <h1 className={typeStyles.h1}>What are you working on?</h1>
            <p className={cn(typeStyles.body, 'mt-2 text-muted-foreground')}>
                Send me a job link, tell me what you shipped, or ask about a company. I keep everything in your record
                and never make up a number.
            </p>
            <Suggestions suggestions={suggestions} onPick={onPick} className="mt-6 justify-center" />
            <p className={cn(typeStyles.small, 'mt-8 text-muted-foreground')}>
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
        <div className={cn('flex flex-wrap gap-2', className)}>
            {suggestions.map((s) => (
                <Button key={s.label} size="sm" variant="outline" className="rounded-full" onClick={() => onPick(s)}>
                    {s.label}
                </Button>
            ))}
        </div>
    );
}

export function ChatScreen({ initial, links = { scout: true, workLog: true } }: { initial: ChatThread; links?: ChatLinks }) {
    const [messages, setMessages] = React.useState<ChatMessageView[]>(initial.messages);
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [draft, setDraft] = React.useState('');
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
        <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col px-4 sm:px-6">
            <div className="flex-1 space-y-5 py-6" aria-live="polite">
                {messages.length === 0 && !pending ? <Empty suggestions={initial.suggestions} onPick={pick} /> : null}
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
                            <p className={cn(typeStyles.small, 'inline-flex items-center gap-2 text-muted-foreground')}>
                                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Working on it
                            </p>
                        )}
                    </>
                ) : null}
                <div ref={endRef} />
            </div>

            <div className="sticky bottom-0 border-t border-border bg-background pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                {messages.length > 0 ? <Suggestions suggestions={initial.suggestions} onPick={pick} className="mb-3" /> : null}
                <form
                    className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 focus-within:ring-2 focus-within:ring-ring"
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
