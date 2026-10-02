'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EntitlementNotice } from '@/components/scout/EntitlementNotice';
import { cn } from '@/lib/utils';
import { startScout } from '@/actions/scout';

/**
 * The one box. It takes what people actually have on their clipboard — a
 * link, a link with a remark, a pasted post, or a note about their own week —
 * and the server parses it exactly as it parses a chat message, so the
 * dashboard and Telegram cannot disagree about what "this" was.
 */
export function PasteBox() {
    const router = useRouter();
    const [message, setMessage] = React.useState('');
    const [pending, setPending] = React.useState(false);
    const [notice, setNotice] = React.useState<{ message: string; entitlement: boolean } | null>(null);
    const inputId = React.useId();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const value = message.trim();
        if (!value || pending) return;
        setPending(true);
        setNotice(null);
        const result = await startScout({ message: value });
        if (!result.success) {
            setPending(false);
            setNotice({ message: result.error, entitlement: result.code === 'entitlement_required' });
            return;
        }
        // A reused run lands on the existing analysis, with nothing charged.
        router.push(`/scout/${result.data.run.id}`);
    };

    // One row: chat is the main way in now, so this is the quick paste, not a composer.
    return (
        <div>
            <form onSubmit={submit} className="flex items-end gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                <label htmlFor={inputId} className="sr-only">
                    Paste a LinkedIn job, post or any job link, or write a note about something you did
                </label>
                <Textarea
                    id={inputId}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                        // Enter adds; Shift+Enter keeps a pasted post's line breaks.
                        if (event.key === 'Enter' && !event.shiftKey) void submit(event);
                    }}
                    placeholder="Paste a job link, post or note"
                    rows={1}
                    maxLength={100_000}
                    className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-base shadow-none focus-visible:ring-0 sm:text-sm"
                    disabled={pending}
                />
                <Button type="submit" size="sm" className="h-9 shrink-0 gap-1.5" disabled={pending || !message.trim()}>
                    {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Send aria-hidden className="size-3.5" />}
                    Add
                </Button>
            </form>
            <p className={cn(typeStyles.caption, 'mt-1.5 px-1 text-muted-foreground')}>
                The same link twice opens the same analysis.
            </p>
            {notice ? (
                <div className="mt-4">
                    <EntitlementNotice message={notice.message} entitlement={notice.entitlement} />
                </div>
            ) : null}
        </div>
    );
}
