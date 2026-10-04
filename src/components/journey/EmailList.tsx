'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, Inbox, Loader2, PenLine, Plus, Undo2, X } from 'lucide-react';

import {
    createJobFromEmailAction,
    draftEmailReply,
    fileEmailUnder,
    ignoreJobEmail,
    markEmailHandled,
    undoEmailStatus,
} from '@/actions/journey';
import { EmptyState, InitialAvatar, Pill, Segmented } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABEL } from '@/lib/journey/status';
import type { JobEmailView } from '@/services/journey';
import { cn } from '@/lib/utils';

/**
 * Jobs → Email (docs/prd/11-job-journey.md §5).
 *
 * Every forwarded job email, filed: what kind it is, which job it is about,
 * what it changed (with Undo), and a reply draft one tap away. "Open in
 * Gmail" opens Gmail's compose window with the draft; nothing is sent from
 * here.
 */

export type JobOption = { workspaceId: string; label: string };

type View = 'reply' | 'all';

const REPLY_KINDS = new Set(['recruiter_outreach', 'interview_request', 'scheduling', 'assessment', 'offer', 'other_job']);

const KIND_DOT: Record<string, 'success' | 'info' | 'warning' | 'muted' | 'danger'> = {
    offer: 'success',
    interview_request: 'info',
    scheduling: 'info',
    assessment: 'warning',
    recruiter_outreach: 'info',
    rejection: 'muted',
    application_received: 'muted',
    other_job: 'muted',
    not_job: 'muted',
};

function when(iso: string): string {
    const date = new Date(iso);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days < 1) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function composeUrl(to: string, subject: string, body: string): string {
    const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
    return `https://mail.google.com/mail/?${params.toString()}`;
}

function DraftEditor({ email, onSaved }: { email: JobEmailView; onSaved: (next: JobEmailView) => void }) {
    const [intent, setIntent] = React.useState('');
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [subject, setSubject] = React.useState(email.draft?.subject ?? '');
    const [body, setBody] = React.useState(email.draft?.body ?? '');
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        setSubject(email.draft?.subject ?? '');
        setBody(email.draft?.body ?? '');
    }, [email.draft?.subject, email.draft?.body]);

    const draft = async () => {
        setPending(true);
        setError(null);
        const result = await draftEmailReply({ emailId: email.id, intent: intent.trim() || undefined });
        setPending(false);
        if (!result.success) {
            setError(result.error);
            return;
        }
        onSaved(result.data);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    value={intent}
                    onChange={(event) => setIntent(event.target.value)}
                    placeholder="What do you want to say? (optional: “accept, Tuesday works”)"
                    maxLength={500}
                    className="h-9 flex-1 text-base sm:text-sm"
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void draft();
                    }}
                />
                <Button type="button" size="sm" className="h-9 gap-1.5" onClick={draft} disabled={pending}>
                    {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PenLine className="size-3.5" aria-hidden />}
                    {email.draft ? 'Redraft' : 'Draft reply'}
                </Button>
            </div>
            {error ? <p role="alert" className="text-sm text-warning">{error}</p> : null}
            {email.draft ? (
                <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" className="h-8 border-0 px-0 text-sm font-medium shadow-none focus-visible:ring-0" />
                    <Textarea value={body} onChange={(event) => setBody(event.target.value)} aria-label="Reply" rows={8} className="min-h-40 resize-y border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 sm:text-sm" />
                    {body.includes('[your availability]') ? (
                        <p className="text-xs text-warning">Fill in [your availability] before sending.</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                        <Button asChild size="sm" className="h-8 gap-1.5">
                            <a href={composeUrl(email.fromEmail, subject, body)} target="_blank" rel="noopener noreferrer">
                                Open in Gmail <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5"
                            onClick={async () => {
                                await navigator.clipboard.writeText(`${subject}\n\n${body}`);
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1500);
                            }}
                        >
                            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function EmailRow({ email, jobs, open, onToggle, onChange, onRemove }: {
    email: JobEmailView;
    jobs: JobOption[];
    open: boolean;
    onToggle: () => void;
    onChange: (next: JobEmailView) => void;
    onRemove: () => void;
}) {
    const [busy, setBusy] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const sender = email.fromName || email.fromEmail;
    const jobLabel = email.job ? `${email.job.role ?? 'Untitled role'}${email.job.company ? ` · ${email.job.company}` : ''}` : null;

    const run = async <T,>(key: string, action: () => Promise<{ success: true; data: T } | { success: false; error: string }>, then: (data: T) => void) => {
        setBusy(key);
        setError(null);
        const result = await action();
        setBusy(null);
        if (result.success) then(result.data);
        else setError(result.error);
    };

    return (
        <li className={cn('transition-colors', open ? 'bg-secondary/30' : 'hover:bg-secondary/40')}>
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
                <InitialAvatar name={sender} />
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                        <span className={cn('truncate text-sm', email.handled ? 'text-muted-foreground' : 'font-medium text-foreground')}>{sender}</span>
                        {email.kindLabel ? <Pill dot={KIND_DOT[email.kind ?? 'other_job']} className="hidden sm:inline-flex">{email.kindLabel}</Pill> : null}
                    </span>
                    <span className="block truncate text-sm text-foreground">{email.subject}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                        {email.status === 'pending' ? 'Reading it…' : email.status === 'failed' ? 'Could not read this one yet; it is retried daily.' : email.summary || ' '}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {jobLabel ? <span className="truncate">{jobLabel}</span> : <span>Not filed under a job</span>}
                        {email.moved ? <span className="text-foreground">· moved to {STATUS_LABEL[email.moved.to]}</span> : null}
                        {email.draft ? <span>· draft ready</span> : null}
                    </span>
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">{when(email.receivedAt)}</span>
            </button>

            {open ? (
                <div className="space-y-4 px-4 pb-4 sm:pl-16">
                    {email.moved ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                            <span className="text-muted-foreground">This email moved the job from {STATUS_LABEL[email.moved.from]} to {STATUS_LABEL[email.moved.to]}.</span>
                            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2" disabled={busy === 'undo'} onClick={() => run('undo', () => undoEmailStatus(email.id), onChange)}>
                                <Undo2 className="size-3.5" aria-hidden /> Undo
                            </Button>
                        </div>
                    ) : null}

                    {REPLY_KINDS.has(email.kind ?? '') ? <DraftEditor email={email} onSaved={onChange} /> : null}

                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            value={email.job?.workspaceId ?? 'none'}
                            onValueChange={(value) => run('link', () => fileEmailUnder({ emailId: email.id, workspaceId: value === 'none' ? null : value }), onChange)}
                        >
                            <SelectTrigger className="h-8 w-auto min-w-48 max-w-full text-xs" aria-label="File under a job">
                                <SelectValue placeholder="File under a job" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Not filed under a job</SelectItem>
                                {jobs.map((job) => <SelectItem key={job.workspaceId} value={job.workspaceId}>{job.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {!email.job ? (
                            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy === 'create'} onClick={() => run('create', () => createJobFromEmailAction(email.id), onChange)}>
                                <Plus className="size-3.5" aria-hidden /> Track as a new job
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => run('handled', () => markEmailHandled({ emailId: email.id, handled: !email.handled }), () => onChange({ ...email, handled: !email.handled }))}
                        >
                            <Check className="size-3.5" aria-hidden /> {email.handled ? 'Mark as not done' : 'Done'}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={() => run('ignore', () => ignoreJobEmail(email.id), onRemove)}>
                            <X className="size-3.5" aria-hidden /> Not job related
                        </Button>
                    </div>
                    {error ? <p role="alert" className="text-sm text-warning">{error}</p> : null}
                </div>
            ) : null}
        </li>
    );
}

export function EmailList({ initial, jobs }: { initial: JobEmailView[]; jobs: JobOption[] }) {
    const [emails, setEmails] = React.useState(initial);
    const [openId, setOpenId] = React.useState<string | null>(null);
    const toReply = emails.filter((email) => REPLY_KINDS.has(email.kind ?? '') && !email.handled);
    const [view, setView] = React.useState<View>(toReply.length > 0 ? 'reply' : 'all');

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={Inbox}
                title="No job email yet"
                description="Forward job email to your Patronus address and it lands here, filed under the right job, with a reply drafted when you want one."
                action={{ label: 'Set up forwarding', href: '/settings/email' }}
            />
        );
    }

    const visible = view === 'reply' ? toReply : emails;
    const update = (next: JobEmailView) => setEmails((list) => list.map((email) => (email.id === next.id ? next : email)));
    const remove = (id: string) => setEmails((list) => list.filter((email) => email.id !== id));

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented<View>
                    label="Email view"
                    value={view}
                    onChange={setView}
                    options={[{ value: 'reply', label: 'Needs a reply', count: toReply.length }, { value: 'all', label: 'All', count: emails.length }]}
                />
                <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                    <Link href="/settings/email">Forwarding settings</Link>
                </Button>
            </div>
            {visible.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">Nothing waiting on a reply.</div>
            ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {visible.map((email) => (
                        <EmailRow
                            key={email.id}
                            email={email}
                            jobs={jobs}
                            open={openId === email.id}
                            onToggle={() => setOpenId((id) => (id === email.id ? null : email.id))}
                            onChange={update}
                            onRemove={() => remove(email.id)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}
