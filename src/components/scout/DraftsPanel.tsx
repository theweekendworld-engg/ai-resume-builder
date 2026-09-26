'use client';

import * as React from 'react';
import { Check, Copy, PenLine } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OutreachDraft } from '@/lib/scout/types';

import { charCount, DRAFT_FORMAT_LABEL, draftClipboardText, relativeTime } from './format';

const TARGET_LABEL: Record<OutreachDraft['target'], string> = {
    poster: 'To the poster',
    recruiter: 'To a recruiter',
    hiring_manager: 'To the hiring manager',
    referral: 'Referral ask',
    alumni: 'To an alum',
};

function DraftItem({ draft }: { draft: OutreachDraft }) {
    const [copied, setCopied] = React.useState(false);
    const { count, limit, over } = charCount(draft.body, draft.format);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(draftClipboardText(draft));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <li className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                    {DRAFT_FORMAT_LABEL[draft.format]} · {TARGET_LABEL[draft.target]}
                    {draft.recipientName ? ` · ${draft.recipientName}` : ''} · {relativeTime(draft.createdAt)}
                </p>
                <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={copy}>
                    {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </div>
            {draft.subject ? (
                <p className={cn(typeStyles.body, 'mt-2 font-medium text-foreground')}>Subject: {draft.subject}</p>
            ) : null}
            <p className={cn(typeStyles.body, 'mt-2 whitespace-pre-wrap text-foreground')}>{draft.body}</p>
            <p className={cn(typeStyles.caption, 'num mt-2', over ? 'text-warning' : 'text-muted-foreground')}>
                {limit !== null ? `${count} / ${limit} characters` : `${count} characters`}
                {over ? ' · over the limit, trim before sending' : ''}
            </p>
        </li>
    );
}

export function DraftsPanel({ drafts, pendingLabel }: { drafts: OutreachDraft[]; pendingLabel: string | null }) {
    if (drafts.length === 0 && !pendingLabel) return null;
    const ordered = [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return (
        <section className="surface-work rounded-xl border border-border bg-card p-5" aria-live="polite">
            <h2 className={cn(typeStyles.h3, 'flex items-center gap-2 text-foreground')}>
                <PenLine aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.5} />
                Drafts
            </h2>
            <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                Written from your record only. Nothing is sent: copy, edit, and send it yourself.
            </p>
            {pendingLabel ? (
                <p className={cn(typeStyles.small, 'mt-4 text-muted-foreground')}>Writing a draft {pendingLabel.toLowerCase()}…</p>
            ) : null}
            <ul className="mt-4 divide-y divide-border">
                {ordered.map((draft) => (
                    <DraftItem key={draft.id} draft={draft} />
                ))}
            </ul>
        </section>
    );
}
