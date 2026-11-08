import Link from 'next/link';
import {
    BellRing,
    Briefcase,
    CalendarClock,
    Check,
    CircleHelp,
    Mail,
    NotebookPen,
    PenLine,
    Target,
    type LucideIcon,
} from 'lucide-react';

import {
    InitialAvatar,
    PageBody,
    PageHeader,
    ProgressRail,
    Section,
    SectionLink,
    StatStrip,
    typeStyles,
    type ProgressRailStep,
} from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { jobStageSummary } from '@/lib/jobStages';
import { overviewStatusLine } from '@/lib/overviewStatus';
import type { NeedsYouKind, Overview } from '@/services/overview';
import { cn } from '@/lib/utils';

import { AskBar } from './AskBar';

/**
 * Home (2026-10-04; Dossier 2026-11-08, docs/design/03-dossier.md §6).
 *
 * Read top to bottom like the first page of a file: a serif greeting and one
 * sentence of status, the pipeline as a ruled strip of numbers, then the
 * parts. "Needs you" leads because it is the only part that asks for
 * something, and it is the only place warning appears. Jobs in motion each show
 * their four stages on a ProgressRail. Everything else is state, each part
 * linking to where it is changed. Parts are separated by hairline rules, not
 * boxed into floating cards.
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

function Quiet({ children }: { children: React.ReactNode }) {
    return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
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

/** A row's hover: a white sheet slides under it, no movement. */
const ROW = 'group relative flex items-center gap-4 rounded-md transition-colors duration-150 hover:bg-card focus-visible:bg-card focus-visible:outline-offset-[-2px]';

function railSteps(stages: NonNullable<Overview['jobs']>[number]['stages']): ProgressRailStep[] {
    // Everything ready and only the sending left: that waits on the user.
    return stages.map((stage) => (stage.status === 'current' && stage.key === 'applied' ? { ...stage, tone: 'attention' as const } : stage));
}

export function OverviewScreen({ data, chat }: { data: Overview; chat: boolean }) {
    const setupLeft = data.setup.filter((step) => !step.done);
    // A brand-new account: no resume or work history yet. It was greeted
    // "Welcome back" with the one step that matters in the bottom corner.
    const resumeStep = data.setup.find((step) => step.key === 'resume' && !step.done) ?? null;
    const name = data.firstName ? `, ${data.firstName}` : '';
    const needs = data.needsYou.length;

    return (
        <div>
            <PageHeader
                size="display"
                eyebrow="Your search and your record"
                title={resumeStep ? `Welcome to Patronus${name}.` : `Welcome back${name}.`}
                description={overviewStatusLine(data)}
                actions={
                    chat ? null : (
                        // One blue button per view: on a new account the first
                        // step owns it, so this one steps back to outline.
                        <Button asChild variant={resumeStep ? 'outline' : 'default'}>
                            <Link href="/build">
                                <PenLine aria-hidden />
                                Tailor a resume
                            </Link>
                        </Button>
                    )
                }
            />
            <PageBody className="space-y-8 pb-12">
                {resumeStep ? (
                    <section
                        aria-labelledby="first-step"
                        className="relative overflow-hidden rounded-lg border border-border bg-card p-5 pl-6 sm:p-6 sm:pl-7"
                    >
                        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                        <p className={typeStyles.eyebrow}>First step</p>
                        <h2 id="first-step" className={cn(typeStyles.h2, 'mt-1 text-foreground')}>Start with your resume</h2>
                        <p className="mt-1.5 max-w-prose text-sm leading-[22px] text-muted-foreground">
                            Upload the PDF you already have. Patronus keeps every line as you wrote it, then checks any job against it and tailors a one-page resume.
                        </p>
                        <Button asChild className="mt-4">
                            <Link href={resumeStep.href}>Import your resume</Link>
                        </Button>
                    </section>
                ) : null}

                {chat ? <AskBar /> : null}

                {data.pipeline ? (
                    <StatStrip
                        label="Your pipeline"
                        items={data.pipeline.map((stage) => ({
                            key: stage.column,
                            label: stage.label,
                            value: stage.count,
                            href: stage.href,
                            tone: stage.column === 'to_review' && stage.count > 0 ? 'attention' : 'default',
                        }))}
                    />
                ) : null}

                <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-3">
                    {/* ── Left: what to do, and what is moving ────────── */}
                    <div className="min-w-0 space-y-8 lg:col-span-2">
                        <Section eyebrow="Needs you" count={needs || null} tone={needs ? 'attention' : 'default'}>
                            {needs === 0 ? (
                                <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                    <Check className="size-4 text-success" aria-hidden />
                                    You are all caught up. New replies, interviews and follow-ups appear here.
                                </p>
                            ) : (
                                <ul className="-mx-2 divide-y divide-border">
                                    {data.needsYou.map((item) => {
                                        const Icon = NEED_ICON[item.kind];
                                        return (
                                            <li key={item.key}>
                                                <Link href={item.href} className={cn(ROW, 'py-3 pl-5 pr-2')}>
                                                    {/* The warning mark: this row is waiting on you. */}
                                                    <span aria-hidden className="absolute inset-y-3 left-2 w-0.5 rounded-full bg-warning" />
                                                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                                                        {item.detail ? <span className="block truncate text-[13px] text-muted-foreground">{item.detail}</span> : null}
                                                    </span>
                                                    {item.kind === 'interview' && item.at ? (
                                                        <span className="ledger hidden shrink-0 text-xs text-muted-foreground sm:inline">
                                                            {dayAndTime(item.at).day} · {dayAndTime(item.at).time}
                                                        </span>
                                                    ) : null}
                                                    <span className="hidden h-8 shrink-0 items-center rounded-md border border-border-strong/45 bg-card px-3 text-[13px] font-medium text-foreground transition-colors duration-150 group-hover:border-border-strong/80 md:inline-flex">
                                                        {item.action}
                                                    </span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Section>

                        {data.jobs ? (
                            <Section eyebrow="Jobs in motion" action={<SectionLink href="/scout">All jobs</SectionLink>}>
                                {data.jobs.length === 0 ? (
                                    <Quiet>
                                        Share a job link from chat, Telegram or the extension. Each one shows its stages here: analyzed, tailored, email ready, applied.
                                    </Quiet>
                                ) : (
                                    <ul className="-mx-2 divide-y divide-border">
                                        {data.jobs.map((job) => {
                                            const steps = railSteps(job.stages);
                                            const railLabel = `${job.role}${job.company ? ` at ${job.company}` : ''}: ${jobStageSummary(job.stages)}`;
                                            return (
                                                <li key={job.id}>
                                                    <Link href={job.href} className={cn(ROW, 'flex-wrap gap-y-3 px-2 py-3.5 md:flex-nowrap')}>
                                                        <InitialAvatar name={job.company} />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-medium text-foreground">{job.role}</span>
                                                            <span className="block truncate text-[13px] text-muted-foreground">
                                                                {job.company ?? 'Company not found'}
                                                                {job.fitScore != null ? <span className="num"> · {job.fitScore} fit</span> : null}
                                                            </span>
                                                        </span>
                                                        <ProgressRail steps={steps} label={railLabel} className="hidden w-[340px] shrink-0 md:flex" />
                                                        <ProgressRail steps={steps} label={railLabel} size="compact" className="w-full pl-[52px] md:hidden" />
                                                    </Link>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </Section>
                        ) : null}

                        <Section eyebrow="Recent activity" action={data.activity.length ? <SectionLink href="/scout">Jobs</SectionLink> : null}>
                            {data.activity.length === 0 ? (
                                <Quiet>Status changes, replies and interviews on your jobs show up here.</Quiet>
                            ) : (
                                <ol className="space-y-0.5">
                                    {data.activity.map((event) => (
                                        <li key={event.id} className="grid grid-cols-[56px_1fr] gap-4 py-2">
                                            <span className="ledger pt-0.5 text-xs text-muted-foreground">{shortDate(event.at)}</span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm text-foreground">{event.title}</span>
                                                {event.job ? <span className="block truncate text-[13px] text-muted-foreground">{event.job}</span> : null}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </Section>
                    </div>

                    {/* ── Right: state ────────────────────────────────── */}
                    <div className="min-w-0 space-y-8">
                        {data.upcoming ? (
                            <Section eyebrow="Upcoming interviews" action={<SectionLink href="/settings/email">Calendar</SectionLink>}>
                                {data.upcoming.length === 0 ? (
                                    <Quiet>None in the next two weeks.</Quiet>
                                ) : (
                                    <ul className="space-y-3">
                                        {data.upcoming.map((interview) => {
                                            const when = dayAndTime(interview.at);
                                            return (
                                                <li key={interview.id} className="flex gap-3">
                                                    <span className="grid w-12 shrink-0 place-items-center rounded-md border border-border bg-card py-1 text-center">
                                                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{when.day.split(',')[0]}</span>
                                                        <span className="num font-display text-lg font-semibold leading-6">{new Date(interview.at).getDate()}</span>
                                                    </span>
                                                    <span className="min-w-0 pt-0.5">
                                                        <span className="block truncate text-sm font-medium">{interview.title}</span>
                                                        <span className="block truncate text-[13px] text-muted-foreground">{when.time} · {interview.job}</span>
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </Section>
                        ) : null}

                        {data.record ? (
                            <Section eyebrow="Your record" action={<SectionLink href="/log">My work</SectionLink>}>
                                <StatStrip
                                    label="Your record"
                                    layout="fixed"
                                    bare
                                    items={[
                                        { key: 'month', label: 'This month', value: data.record.winsThisMonth },
                                        { key: 'confirmed', label: 'Confirmed', value: data.record.confirmed },
                                        { key: 'drafts', label: 'Drafts', value: data.record.drafts },
                                    ]}
                                />
                            </Section>
                        ) : null}

                        {data.goal ? (
                            <Section eyebrow="Goal" action={<SectionLink href="/home">Open</SectionLink>}>
                                <p className="text-sm font-medium text-foreground">{data.goal.title}</p>
                                <div className="mt-3 flex items-center gap-3">
                                    <div
                                        className="h-1 flex-1 overflow-hidden rounded-full bg-secondary"
                                        role="progressbar"
                                        aria-valuenow={data.goal.percent}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label={`${data.goal.title}: ${data.goal.percent}% done`}
                                    >
                                        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${data.goal.percent}%` }} />
                                    </div>
                                    <span className="num shrink-0 text-xs text-muted-foreground">{data.goal.percent}%</span>
                                </div>
                                {data.goal.nextStep ? (
                                    <p className="mt-2 text-[13px] text-muted-foreground">
                                        Next: <span className="text-foreground">{data.goal.nextStep}</span>
                                    </p>
                                ) : null}
                            </Section>
                        ) : null}

                        <Section eyebrow="Resumes" action={data.resumes.length ? <SectionLink href="/dashboard?section=resumes">All resumes</SectionLink> : null}>
                            {data.resumes.length === 0 ? (
                                <div className="space-y-3">
                                    <Quiet>No resumes yet. Tailor one to a job in a minute.</Quiet>
                                    <Button asChild size="sm" variant="outline">
                                        <Link href="/build">Tailor a resume</Link>
                                    </Button>
                                </div>
                            ) : (
                                <ul className="-mx-2">
                                    {data.resumes.map((resume) => (
                                        <li key={resume.id}>
                                            <Link href={`/editor/${resume.id}`} className={cn(ROW, 'gap-3 px-2 py-2')}>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-foreground">{resume.title}</span>
                                                    <span className="block truncate text-[13px] text-muted-foreground">{resume.target ?? 'Base resume'}</span>
                                                </span>
                                                <span className="ledger shrink-0 text-xs text-muted-foreground">{shortDate(resume.updatedAt)}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        {setupLeft.length > 0 ? (
                            <Section eyebrow="Get set up" description={`${setupLeft.length} of ${data.setup.length} steps left.`}>
                                <ul className="-mx-2">
                                    {data.setup.map((step) => (
                                        <li key={step.key}>
                                            <Link href={step.href} className={cn(ROW, 'gap-3 px-2 py-2 text-sm', step.done && 'text-muted-foreground')}>
                                                <span
                                                    className={cn(
                                                        'grid size-5 shrink-0 place-items-center rounded-full border',
                                                        step.done ? 'border-success bg-success text-success-foreground' : 'border-border-strong/70 bg-card',
                                                    )}
                                                >
                                                    {step.done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
                                                </span>
                                                <span className={cn('min-w-0 flex-1', step.done && 'line-through decoration-muted-foreground/40')}>
                                                    {step.label}
                                                    {step.done ? <span className="sr-only"> (done)</span> : null}
                                                </span>
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
