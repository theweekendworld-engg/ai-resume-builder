'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, NotebookPen, PenLine } from 'lucide-react';

import { EmptyState, typeStyles, focusRing } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import { confirmChatNote, dismissChatNote } from '@/actions/inbox';
import type { NoteItem } from '@/lib/inbox/types';

const STATUS_WORD: Record<NoteItem['status'], string> = {
    draft: 'Draft',
    confirmed: 'Confirmed',
    dismissed: 'Dismissed',
    archived: 'Archived',
};

function NoteRow({ note }: { note: NoteItem }) {
    const router = useRouter();
    const [pending, setPending] = React.useState<'confirm' | 'dismiss' | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const act = async (kind: 'confirm' | 'dismiss') => {
        setPending(kind);
        setError(null);
        const result = kind === 'confirm' ? await confirmChatNote(note.winId) : await dismissChatNote(note.winId);
        setPending(null);
        if (!result.success) {
            setError(result.error);
            return;
        }
        router.refresh();
    };

    return (
        <li className="surface-work rounded-lg border border-border bg-card p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <Link href={`/log?win=${encodeURIComponent(note.winId)}`} className={cn(typeStyles.h3, focusRing, 'rounded-sm text-foreground hover:underline')}>
                        {note.title}
                    </Link>
                    <p className={cn(typeStyles.caption, 'mt-0.5 flex items-center gap-1.5 text-muted-foreground')}>
                        {note.status === 'confirmed' ? <Check aria-hidden className="size-3 text-success" /> : null}
                        {STATUS_WORD[note.status]} · {relativeTime(note.createdAt)}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {note.status === 'draft' ? (
                        <>
                            <Button type="button" size="sm" className="gap-1.5" onClick={() => void act('confirm')} disabled={pending !== null}>
                                {pending === 'confirm' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Check aria-hidden className="size-3.5" />}
                                Confirm
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => void act('dismiss')} disabled={pending !== null}>
                                Dismiss
                            </Button>
                        </>
                    ) : null}
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <Link href={`/log?win=${encodeURIComponent(note.winId)}`}>
                            <PenLine aria-hidden className="size-3.5" /> Edit
                        </Link>
                    </Button>
                </div>
            </div>
            {error ? <p className={cn(typeStyles.caption, 'mt-2 text-warning')} role="alert">{error}</p> : null}
        </li>
    );
}

/**
 * Notes that came in through a chat channel, on their way into the Work Log.
 * Confirming here is the same transaction as confirming in the Work Log:
 * it is what turns a note into evidence.
 */
export function NotesList({ items }: { items: NoteItem[] }) {
    if (items.length === 0) {
        return (
            <EmptyState
                icon={NotebookPen}
                title="No notes yet"
                description="Tell the bot what you did, e.g. “shipped the retry queue today, p99 down 40%”, and it drafts a Win for your Work Log. Confirm it here or in the chat."
                action={{ label: 'Link Telegram or WhatsApp', href: '/dashboard?section=telegram' }}
                secondary={{ label: 'Open the Work Log', href: '/log' }}
            />
        );
    }
    const drafts = items.filter((note) => note.status === 'draft');
    const rest = items.filter((note) => note.status !== 'draft');
    return (
        <div className="flex flex-col gap-6">
            {drafts.length ? (
                <section>
                    <h2 className={cn(typeStyles.small, 'num mb-2 font-medium text-muted-foreground')}>Waiting for you · {drafts.length}</h2>
                    <ul className="space-y-2">{drafts.map((note) => <NoteRow key={note.winId} note={note} />)}</ul>
                </section>
            ) : null}
            {rest.length ? (
                <section>
                    <h2 className={cn(typeStyles.small, 'mb-2 font-medium text-muted-foreground')}>Earlier</h2>
                    <ul className="space-y-2">{rest.map((note) => <NoteRow key={note.winId} note={note} />)}</ul>
                </section>
            ) : null}
            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                Everything here also lives in your <Link href="/log" className="underline hover:text-foreground">Work Log</Link>.
            </p>
        </div>
    );
}
