'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, MessageSquare } from 'lucide-react';

/** "Ask Patronus" on Home: the text goes to chat, prefilled, for the user to send. */
export function AskBar() {
    const router = useRouter();
    const [text, setText] = React.useState('');
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                const value = text.trim();
                router.push(value ? `/chat?q=${encodeURIComponent(value.slice(0, 2000))}` : '/chat');
            }}
            className="flex items-center gap-2 rounded-xl border border-border bg-card p-1.5 pl-3 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <label htmlFor="ask-patronus" className="sr-only">Ask Patronus</label>
            <input
                id="ask-patronus"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ask Patronus, or paste a job link"
                className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            <button type="submit" aria-label="Ask" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90">
                <ArrowUp className="size-4" aria-hidden />
            </button>
        </form>
    );
}
