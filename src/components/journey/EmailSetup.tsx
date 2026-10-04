'use client';

import * as React from 'react';
import { CalendarDays, Check, Copy, ExternalLink, Loader2, Mail, RefreshCw } from 'lucide-react';

import { disconnectGoogleCalendar, rotateEmailAddress, syncGoogleCalendar } from '@/actions/journey';
import { Pill } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { CalendarStatus } from '@/services/calendar';
import type { InboxView } from '@/services/journey';
import { cn } from '@/lib/utils';

/**
 * Settings → Email & calendar (docs/prd/11-job-journey.md §2).
 *
 * Forwarding needs no Gmail permission at all: the user adds our address as
 * a forwarding address and a filter that sends job mail to it. The steps are
 * Gmail's own screens, linked, with everything to paste one tap away.
 */

/** Hosted-ATS senders and the words recruiters use. Copied into a Gmail filter. */
export const GMAIL_FILTER_QUERY =
    'from:(greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com OR icims.com OR workable.com OR jobvite.com) OR subject:(interview OR "your application" OR "next steps" OR offer OR assessment)';

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
    const [copied, setCopied] = React.useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            }}
        >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : label}
        </Button>
    );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
    return (
        <li className="flex gap-3">
            <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground')}>
                {done ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <div className="mt-1 space-y-2 text-sm text-muted-foreground">{children}</div>
            </div>
        </li>
    );
}

function formatWhen(iso: string | null): string | null {
    if (!iso) return null;
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function EmailSetup({
    inbox: initialInbox,
    calendar: initialCalendar,
    notice,
}: {
    inbox: InboxView;
    calendar: CalendarStatus;
    notice: { tone: 'ok' | 'warn'; text: string } | null;
}) {
    const [inbox, setInbox] = React.useState(initialInbox);
    const [calendar, setCalendar] = React.useState(initialCalendar);
    const [busy, setBusy] = React.useState<string | null>(null);
    const [message, setMessage] = React.useState<string | null>(null);

    const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(GMAIL_FILTER_QUERY)}`;

    return (
        <div className="space-y-8">
            {notice ? (
                <p role="status" className={cn('rounded-lg border px-3 py-2 text-sm', notice.tone === 'ok' ? 'border-success/30 bg-success/5 text-foreground' : 'border-warning/40 text-warning')}>
                    {notice.text}
                </p>
            ) : null}
            {message ? <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">{message}</p> : null}

            {/* ── Email ─────────────────────────────────────────────── */}
            <section aria-labelledby="email-heading" className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
                    <div className="flex gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground"><Mail className="size-5" aria-hidden /></span>
                        <div>
                            <h2 id="email-heading" className="font-heading text-base font-semibold">Forward job email</h2>
                            <p className="text-sm text-muted-foreground">Replies, interview invites and rejections file themselves under the right job. No Gmail permission needed.</p>
                        </div>
                    </div>
                    {inbox.received > 0 ? <Pill dot="success">{inbox.received} received</Pill> : inbox.forwardingSeenAt ? <Pill dot="info">Waiting for mail</Pill> : <Pill dot="muted">Not set up</Pill>}
                </div>

                {inbox.address ? (
                    <div className="space-y-6 p-5">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Your Patronus address</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground">{inbox.address}</code>
                                <CopyButton value={inbox.address} />
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground">Anyone with this address can send mail into your record, so keep it to Gmail&apos;s forwarding settings.</p>
                        </div>

                        <ol className="space-y-5">
                            <Step n={1} title="Add it as a forwarding address in Gmail" done={!!inbox.forwardingSeenAt}>
                                <p>Gmail → Settings → Forwarding and POP/IMAP → Add a forwarding address. Paste the address above.</p>
                                <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
                                    <a href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener noreferrer">
                                        Open Gmail forwarding <ExternalLink className="size-3.5" aria-hidden />
                                    </a>
                                </Button>
                            </Step>
                            <Step n={2} title="Confirm it" done={!!inbox.forwardingSeenAt && inbox.received > 0}>
                                {inbox.forwardingCode ? (
                                    <>
                                        <p>Gmail sent this confirmation code. Enter it in Gmail&apos;s forwarding settings, or open the link.</p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <code className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-base tracking-widest text-foreground">{inbox.forwardingCode}</code>
                                            <CopyButton value={inbox.forwardingCode} />
                                            {inbox.forwardingConfirmUrl ? (
                                                <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
                                                    <a href={inbox.forwardingConfirmUrl} target="_blank" rel="noopener noreferrer">Confirm in Gmail <ExternalLink className="size-3.5" aria-hidden /></a>
                                                </Button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <p>Gmail sends a confirmation code to Patronus. It appears here within a minute, and on Telegram if it is linked. Refresh this page after adding the address.</p>
                                )}
                            </Step>
                            <Step n={3} title="Forward only job mail, with a filter" done={inbox.received > 0}>
                                <p>Open this search in Gmail, then choose <span className="font-medium text-foreground">Show search options → Create filter → Forward it to</span> your Patronus address. Edit the search to add companies you are talking to.</p>
                                <div className="flex items-start gap-2">
                                    <code className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{GMAIL_FILTER_QUERY}</code>
                                    <CopyButton value={GMAIL_FILTER_QUERY} />
                                </div>
                                <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
                                    <a href={searchUrl} target="_blank" rel="noopener noreferrer">Open the search in Gmail <ExternalLink className="size-3.5" aria-hidden /></a>
                                </Button>
                            </Step>
                        </ol>

                        <p className="text-sm text-muted-foreground">
                            Not using filters? Forward any single email to the address by hand; it is read the same way.
                            {inbox.lastReceivedAt ? ` Last email received ${formatWhen(inbox.lastReceivedAt)}.` : ''}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                            <p className="text-xs text-muted-foreground">Email text is kept for 180 days, then deleted; the summary and the job&apos;s timeline stay.</p>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">New address</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Make a new address?</AlertDialogTitle>
                                        <AlertDialogDescription>The current address stops working at once. You will need to add the new one in Gmail and update your filter.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Keep this one</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={async () => {
                                                const result = await rotateEmailAddress();
                                                if (result.success) {
                                                    setInbox(result.data);
                                                    setMessage('New address ready. Add it in Gmail and update your filter.');
                                                }
                                            }}
                                        >
                                            Make a new address
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                ) : (
                    <p className="p-5 text-sm text-muted-foreground">Email forwarding is not set up on this server yet (INBOUND_EMAIL_DOMAIN).</p>
                )}
            </section>

            {/* ── Calendar ──────────────────────────────────────────── */}
            <section aria-labelledby="calendar-heading" className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
                    <div className="flex gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground"><CalendarDays className="size-5" aria-hidden /></span>
                        <div>
                            <h2 id="calendar-heading" className="font-heading text-base font-semibold">Google Calendar</h2>
                            <p className="text-sm text-muted-foreground">Interviews on your calendar show up on the job and move it to Interviewing. Follow-up reminders go on your calendar when you ask.</p>
                        </div>
                    </div>
                    {calendar.connected ? <Pill dot={calendar.lastError ? 'warning' : 'success'}>{calendar.lastError ? 'Needs attention' : 'Connected'}</Pill> : <Pill dot="muted">Not connected</Pill>}
                </div>
                <div className="space-y-4 p-5">
                    {!calendar.available ? (
                        <p className="text-sm text-muted-foreground">Google Calendar is not set up on this server yet.</p>
                    ) : calendar.connected ? (
                        <>
                            <dl className="grid gap-3 text-sm sm:grid-cols-2">
                                <div><dt className="text-xs text-muted-foreground">Account</dt><dd className="text-foreground">{calendar.email}</dd></div>
                                <div><dt className="text-xs text-muted-foreground">Last synced</dt><dd className="text-foreground">{formatWhen(calendar.syncedAt) ?? 'Not yet'}</dd></div>
                            </dl>
                            {calendar.lastError ? <p className="text-sm text-warning">{calendar.lastError}</p> : null}
                            <div className="flex flex-wrap gap-2">
                                {calendar.lastError?.startsWith('Reconnect') || calendar.lastError?.startsWith('Access') ? (
                                    <Button asChild size="sm" className="h-8"><a href="/api/google/connect">Reconnect</a></Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5"
                                    disabled={busy === 'sync'}
                                    onClick={async () => {
                                        setBusy('sync');
                                        const result = await syncGoogleCalendar();
                                        setBusy(null);
                                        if (result.success) {
                                            setCalendar((c) => ({ ...c, syncedAt: new Date().toISOString(), lastError: null }));
                                            setMessage(result.data.matched ? `Synced: ${result.data.matched} interview${result.data.matched === 1 ? '' : 's'} on your jobs.` : 'Synced. No interviews for your tracked jobs in the next two months.');
                                        } else {
                                            setMessage(result.error);
                                        }
                                    }}
                                >
                                    {busy === 'sync' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                                    Sync now
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground">Disconnect</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
                                            <AlertDialogDescription>Patronus stops reading your calendar and its access is revoked in Google. Interviews already on your jobs stay.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={async () => {
                                                    const result = await disconnectGoogleCalendar();
                                                    if (result.success) setCalendar((c) => ({ ...c, connected: false, email: null, syncedAt: null, lastError: null }));
                                                }}
                                            >
                                                Disconnect
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Patronus reads event titles, times and attendees to spot interviews for jobs you track, and adds an event only when you ask for a reminder. It never reads your email.
                            </p>
                            <Button asChild size="sm" className="h-8 gap-1.5">
                                <a href="/api/google/connect"><CalendarDays className="size-4" aria-hidden /> Connect Google Calendar</a>
                            </Button>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}
