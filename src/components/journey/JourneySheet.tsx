'use client';

import * as React from 'react';
import { ArrowRightLeft, BellRing, CalendarClock, ExternalLink, History, Loader2, Mail, PenLine, StickyNote } from 'lucide-react';

import { draftJobFollowUp, getJobJourney, remindMeToFollowUp } from '@/actions/journey';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { JourneyEvent } from '@/services/journey';
import { cn } from '@/lib/utils';

/**
 * One application's journey (docs/prd/11-job-journey.md §5): every status
 * change, email, interview and follow-up nudge, newest first, with the two
 * actions a quiet application needs: draft a follow-up, and put a reminder
 * on the calendar.
 */

const EVENT_ICON: Record<JourneyEvent['kind'], React.ComponentType<{ className?: string }>> = {
    status_change: ArrowRightLeft,
    email: Mail,
    interview: CalendarClock,
    follow_up_due: BellRing,
    note: StickyNote,
};

function day(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function time(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Tomorrow 10:00 local, as a datetime-local value. */
function defaultReminder(): string {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FollowUp({ workspaceId }: { workspaceId: string }) {
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<{ to: string; subject: string; body: string } | null>(null);
    const [at, setAt] = React.useState(defaultReminder);
    const [reminder, setReminder] = React.useState<{ state: 'idle' | 'busy' | 'done'; link: string | null; error: string | null }>({ state: 'idle', link: null, error: null });

    const compose = draft
        ? `https://mail.google.com/mail/?${new URLSearchParams({ view: 'cm', fs: '1', to: draft.to, su: draft.subject, body: draft.body }).toString()}`
        : '';

    return (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Follow up</h3>
            {draft ? (
                <div className="space-y-2">
                    <Input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="To (recruiter's email)" aria-label="To" className="h-8 text-base sm:text-sm" />
                    <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" className="h-8 text-base sm:text-sm" />
                    <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Message" rows={7} className="text-base sm:text-sm" />
                    <Button asChild size="sm" className="h-8 gap-1.5">
                        <a href={compose} target="_blank" rel="noopener noreferrer">Open in Gmail <ExternalLink className="size-3.5" aria-hidden /></a>
                    </Button>
                </div>
            ) : (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={pending}
                    onClick={async () => {
                        setPending(true);
                        setError(null);
                        const result = await draftJobFollowUp(workspaceId);
                        setPending(false);
                        if (result.success) setDraft({ to: result.data.to, subject: result.data.subject, body: result.data.body });
                        else setError(result.error);
                    }}
                >
                    {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PenLine className="size-3.5" aria-hidden />}
                    Draft a follow-up
                </Button>
            )}
            {error ? <p role="alert" className="text-sm text-warning">{error}</p> : null}

            <div className="border-t border-border pt-3">
                <label htmlFor={`remind-${workspaceId}`} className="text-xs font-medium text-muted-foreground">Remind me on Google Calendar</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                    <Input id={`remind-${workspaceId}`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 w-auto text-base sm:text-sm" />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={reminder.state === 'busy' || !at}
                        onClick={async () => {
                            setReminder({ state: 'busy', link: null, error: null });
                            const result = await remindMeToFollowUp({ workspaceId, at: new Date(at).toISOString() });
                            setReminder(result.success ? { state: 'done', link: result.data.link, error: null } : { state: 'idle', link: null, error: result.error });
                        }}
                    >
                        {reminder.state === 'busy' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Add reminder'}
                    </Button>
                </div>
                {reminder.state === 'done' ? (
                    <p className="mt-1.5 text-xs text-success">
                        Added to your calendar.{' '}
                        {reminder.link ? <a href={reminder.link} target="_blank" rel="noopener noreferrer" className="underline">Open it</a> : null}
                    </p>
                ) : null}
                {reminder.error ? (
                    <p className="mt-1.5 text-xs text-warning">
                        {reminder.error}{reminder.error.includes('Connect') ? <> · <a href="/settings/email" className="underline">Connect it</a></> : null}
                    </p>
                ) : null}
            </div>
        </section>
    );
}

export function JourneySheet({ workspaceId, title }: { workspaceId: string; title: string }) {
    const [open, setOpen] = React.useState(false);
    const [events, setEvents] = React.useState<JourneyEvent[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    // "Now" as of the load, so rendering stays pure.
    const [loadedAt, setLoadedAt] = React.useState(0);

    React.useEffect(() => {
        if (!open) return;
        let live = true;
        void getJobJourney(workspaceId).then((result) => {
            if (!live) return;
            if (result.success) {
                setLoadedAt(Date.now());
                setEvents(result.data.events);
            }
            else setError(result.error);
        });
        return () => {
            live = false;
        };
    }, [open, workspaceId]);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Timeline for ${title}`} title="Timeline">
                    <History className="size-4" aria-hidden />
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                    <SheetTitle className="pr-6">{title}</SheetTitle>
                    <SheetDescription>Everything that happened on this application.</SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                    <FollowUp workspaceId={workspaceId} />
                    {error ? <p className="text-sm text-warning">{error}</p> : null}
                    {events === null && !error ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading</p>
                    ) : null}
                    {events && events.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nothing yet. Status changes, forwarded emails and interviews on your calendar appear here.</p>
                    ) : null}
                    {events && events.length > 0 ? (
                        <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
                            {events.map((event) => {
                                const Icon = EVENT_ICON[event.kind];
                                const upcoming = event.kind === 'interview' && new Date(event.occurredAt).getTime() > loadedAt;
                                return (
                                    <li key={event.id} className="relative flex gap-3">
                                        <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-background', upcoming ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>
                                            <Icon className="size-3.5" aria-hidden />
                                        </span>
                                        <div className="min-w-0 flex-1 pt-1">
                                            <p className="text-sm text-foreground">{event.title}</p>
                                            {event.detail && !event.detail.startsWith('http') ? <p className="mt-0.5 text-[13px] text-muted-foreground">{event.detail}</p> : null}
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {day(event.occurredAt)}{event.kind === 'interview' ? ` · ${time(event.occurredAt)}` : ''}{upcoming ? ' · upcoming' : ''}
                                                {event.detail?.startsWith('https://') ? <> · <a href={event.detail} target="_blank" rel="noopener noreferrer" className="underline">calendar</a></> : null}
                                            </p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
