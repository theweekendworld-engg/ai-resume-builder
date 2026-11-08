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
            // A white field with a real edge (--input, 3.2:1); blue edge and
            // a soft ring while focused. No shadow: borders over shadows.
            className="flex items-center gap-2 rounded-lg border border-input bg-card p-1.5 pl-3.5 transition-colors duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
        >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <label htmlFor="ask-patronus" className="sr-only">Ask Patronus</label>
            <input
                id="ask-patronus"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ask Patronus, or paste a job link"
                className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            <button type="submit" aria-label="Ask" className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary/90">
                <ArrowUp className="size-4" aria-hidden />
            </button>
        </form>
    );
}
