import Link from 'next/link';
import {
    ArrowRight,
    BellRing,
    Briefcase,
    CalendarClock,
    Check,
    CircleHelp,
    FileText,
    History,
    Inbox,
    Mail,
    NotebookPen,
    Sparkles,
    Target,
    type LucideIcon,
} from 'lucide-react';

import { PageBody, PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import type { NeedsYouKind, Overview } from '@/services/overview';
import { cn } from '@/lib/utils';

import { AskBar } from './AskBar';

/**
 * Home (2026-10-04): every part of the search and the record on one screen,
 * in sections. "Needs you" leads because it is the only section that asks
 * for something; the rest are state, each linking to where it is changed.
 */

const NEED_ICON: Record<NeedsYouKind, LucideIcon> = {
    interview: CalendarClock,
    question: CircleHelp,
    email: Mail,
    follow_up: BellRing,
    drafts: NotebookPen,
    review: Briefcase,
    goal: Target,
};

function Section({
    icon: Icon,
    title,
    href,
    linkLabel = 'View all',
    children,
    className,
}: {
    icon: LucideIcon;
    title: string;
    href?: string;
    linkLabel?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('rounded-xl border border-border bg-card', className)}>
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {title}
                </h2>
                {href ? (
                    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                        {linkLabel} <ArrowRight className="size-3" aria-hidden />
                    </Link>
                ) : null}
            </header>
            {children}
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayAndTime(iso: string): { day: string; time: string } {
    const date = new Date(iso);
    return {
        day: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
}

export function OverviewScreen({ data, chat }: { data: Overview; chat: boolean }) {
    const setupLeft = data.setup.filter((step) => !step.done);

    return (
        <div>
            <PageHeader
                title={data.firstName ? `Welcome back, ${data.firstName}` : 'Welcome back'}
                description="Everything in your search and your record, in one place."
            />
            <PageBody className="space-y-6">
                {chat ? <AskBar /> : null}

                {/* ── Pipeline ─────────────────────────────────────────── */}
                {data.pipeline ? (
                    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
                        {data.pipeline.map((stage) => (
                            <Link key={stage.column} href={stage.href} className="group bg-card px-4 py-4 transition-colors hover:bg-secondary/50">
                                <dd className="font-heading text-2xl font-semibold tabular-nums text-foreground">{stage.count}</dd>
                                <dt className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                    {stage.label}
                                    <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                                </dt>
                            </Link>
                        ))}
                    </dl>
                ) : null}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    {/* ── Left: what to do, and what happened ─────────── */}
                    <div className="min-w-0 space-y-6 lg:col-span-2">
                        <Section icon={Sparkles} title="Needs you">
                            {data.needsYou.length === 0 ? (
                                <Empty>You are all caught up. New replies, interviews and follow-ups appear here.</Empty>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {data.needsYou.map((item) => {
                                        const Icon = NEED_ICON[item.kind];
                                        const urgent = item.kind === 'interview' || item.kind === 'question';
                                        return (
                                            <li key={item.key}>
                                                <Link href={item.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50">
                                                    <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg border', urgent ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground')}>
                                                        <Icon className="size-4" aria-hidden />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                                                        {item.detail ? <span className="block truncate text-[13px] text-muted-foreground">{item.detail}</span> : null}
                                                    </span>
                                                    {item.kind === 'interview' && item.at ? (
                                                        <span className="num hidden shrink-0 text-xs text-muted-foreground sm:inline">{dayAndTime(item.at).day} · {dayAndTime(item.at).time}</span>
                                                    ) : null}
                                                    <span className="hidden shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground group-hover:border-foreground/30 md:inline">{item.action}</span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Section>

                        <Section icon={History} title="Recent activity" href="/scout">
                            {data.activity.length === 0 ? (
                                <Empty>Status changes, replies and interviews on your jobs show up here.</Empty>
                            ) : (
                                <ol className="divide-y divide-border">
                                    {data.activity.map((event) => (
                                        <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm text-foreground">{event.title}</span>
                                                {event.job ? <span className="block truncate text-xs text-muted-foreground">{event.job}</span> : null}
                                            </span>
                                            <span className="num shrink-0 text-xs text-muted-foreground">{shortDate(event.at)}</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </Section>
                    </div>

                    {/* ── Right: state ────────────────────────────────── */}
                    <div className="min-w-0 space-y-6">
                        {data.upcoming ? (
                            <Section icon={CalendarClock} title="Upcoming interviews" href="/settings/email" linkLabel="Calendar">
                                {data.upcoming.length === 0 ? (
                                    <Empty>None in the next two weeks.</Empty>
                                ) : (
                                    <ul className="divide-y divide-border">
                                        {data.upcoming.map((interview) => {
                                            const when = dayAndTime(interview.at);
                                            return (
                                                <li key={interview.id} className="flex gap-3 px-4 py-3">
                                                    <span className="grid w-12 shrink-0 place-items-center rounded-lg border border-border py-1 text-center">
                                                        <span className="text-[10px] uppercase text-muted-foreground">{when.day.split(',')[0]}</span>
                                                        <span className="font-heading text-sm font-semibold">{new Date(interview.at).getDate()}</span>
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-sm font-medium">{interview.title}</span>
                                                        <span className="block truncate text-xs text-muted-foreground">{when.time} · {interview.job}</span>
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </Section>
                        ) : null}

                        {data.record ? (
                            <Section icon={NotebookPen} title="Your record" href="/log">
                                <dl className="grid grid-cols-3 divide-x divide-border">
                                    {[
                                        ['This month', data.record.winsThisMonth],
                                        ['Confirmed', data.record.confirmed],
                                        ['Drafts', data.record.drafts],
                                    ].map(([label, value]) => (
                                        <div key={label} className="px-4 py-3">
                                            <dd className="font-heading text-xl font-semibold tabular-nums">{value}</dd>
                                            <dt className="text-xs text-muted-foreground">{label}</dt>
                                        </div>
                                    ))}
                                </dl>
                            </Section>
                        ) : null}

                        {data.goal ? (
                            <Section icon={Target} title="Goal" href="/home">
                                <div className="space-y-2 px-4 py-3">
                                    <p className="text-sm font-medium">{data.goal.title}</p>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-label={`${data.goal.percent}% done`}>
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${data.goal.percent}%` }} />
                                    </div>
                                    {data.goal.nextStep ? <p className="text-xs text-muted-foreground">Next: <span className="text-foreground">{data.goal.nextStep}</span></p> : null}
                                </div>
                            </Section>
                        ) : null}

                        <Section icon={FileText} title="Resumes" href="/dashboard?section=resumes">
                            {data.resumes.length === 0 ? (
                                <div className="space-y-3 px-4 py-4">
                                    <p className="text-sm text-muted-foreground">No resumes yet. Tailor one to a job in a minute.</p>
                                    <Button asChild size="sm" className="h-8"><Link href="/build">Tailor a resume</Link></Button>
                                </div>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {data.resumes.map((resume) => (
                                        <li key={resume.id}>
                                            <Link href={`/editor/${resume.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50">
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm">{resume.title}</span>
                                                    <span className="block truncate text-xs text-muted-foreground">{resume.target ?? 'Base resume'}</span>
                                                </span>
                                                <span className="num shrink-0 text-xs text-muted-foreground">{shortDate(resume.updatedAt)}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        {setupLeft.length > 0 ? (
                            <Section icon={Inbox} title="Get set up">
                                <ul className="divide-y divide-border">
                                    {data.setup.map((step) => (
                                        <li key={step.key}>
                                            <Link href={step.href} className={cn('flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-secondary/50', step.done && 'text-muted-foreground')}>
                                                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', step.done ? 'border-success/40 bg-success/10 text-success' : 'border-border')}>
                                                    {step.done ? <Check className="size-3" aria-hidden /> : null}
                                                </span>
                                                <span className={cn('min-w-0 flex-1', step.done && 'line-through decoration-muted-foreground/40')}>{step.label}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        ) : null}
                    </div>
                </div>
            </PageBody>
        </div>
    );
}
