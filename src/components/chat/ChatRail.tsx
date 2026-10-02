import Link from 'next/link';
import { ArrowRight, Inbox, NotebookPen, Send, Target } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import type { ChatRail as RailData } from '@/services/chat';
import { cn } from '@/lib/utils';

/**
 * The record at a glance, beside the thread (xl and up). Every number links
 * to where it is acted on, and a section whose page is off is not shown.
 * Counts are the reward (docs/design/00 principle 5): no praise, no badges.
 */
export function ChatRail({ rail, links }: { rail: RailData; links: { scout: boolean; workLog: boolean; goals: boolean } }) {
    return (
        <aside className="hidden w-80 shrink-0 border-l border-border xl:block">
            <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto px-5 py-6">
                <section>
                    <h2 className={cn(typeStyles.caption, 'flex items-center gap-1.5 uppercase text-muted-foreground')}>
                        <NotebookPen className="size-3.5" aria-hidden /> Work Log
                    </h2>
                    <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{rail.winsThisMonth}</p>
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>confirmed this month</p>
                    {rail.drafts.count > 0 ? (
                        <div className="mt-3 rounded-lg border border-border bg-card p-3">
                            <p className={cn(typeStyles.small, 'font-medium')}>
                                {rail.drafts.count} draft{rail.drafts.count === 1 ? '' : 's'} to confirm
                            </p>
                            <ul className="mt-1.5 space-y-1">
                                {rail.drafts.latest.map((draft) => (
                                    <li key={draft.id} className={cn(typeStyles.small, 'truncate text-muted-foreground')}>{draft.title}</li>
                                ))}
                            </ul>
                            {links.workLog ? (
                                <Link href="/log" className={cn(typeStyles.small, 'mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline')}>
                                    Review them <ArrowRight className="size-3.5" aria-hidden />
                                </Link>
                            ) : null}
                        </div>
                    ) : null}
                </section>

                {links.scout ? (
                    <section>
                        <h2 className={cn(typeStyles.caption, 'flex items-center gap-1.5 uppercase text-muted-foreground')}>
                            <Inbox className="size-3.5" aria-hidden /> Job search
                        </h2>
                        <dl className="mt-2 grid grid-cols-3 gap-2">
                            {[
                                ['To review', rail.pipeline.toReview],
                                ['Applied', rail.pipeline.applied],
                                ['Interviewing', rail.pipeline.interviewing],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-lg border border-border bg-card px-2.5 py-2">
                                    <dd className="font-heading text-lg font-semibold tabular-nums">{value}</dd>
                                    <dt className={cn(typeStyles.caption, 'text-muted-foreground')}>{label}</dt>
                                </div>
                            ))}
                        </dl>
                        <Link href="/scout" className={cn(typeStyles.small, 'mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline')}>
                            Open your jobs <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                    </section>
                ) : null}

                {links.goals && rail.goal ? (
                    <section>
                        <h2 className={cn(typeStyles.caption, 'flex items-center gap-1.5 uppercase text-muted-foreground')}>
                            <Target className="size-3.5" aria-hidden /> Goal
                        </h2>
                        <p className={cn(typeStyles.body, 'mt-2 font-medium')}>{rail.goal.title}</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${rail.goal.percent}% done`}>
                            <div className="h-full rounded-full bg-primary" style={{ width: `${rail.goal.percent}%` }} />
                        </div>
                        {rail.goal.nextStep ? (
                            <p className={cn(typeStyles.small, 'mt-2 text-muted-foreground')}>
                                Next:{' '}
                                {rail.goal.nextStep.href ? (
                                    <Link href={rail.goal.nextStep.href} className="font-medium text-foreground hover:underline">{rail.goal.nextStep.title}</Link>
                                ) : (
                                    <span className="text-foreground">{rail.goal.nextStep.title}</span>
                                )}
                            </p>
                        ) : null}
                    </section>
                ) : null}

                {!rail.telegramLinked ? (
                    <section className="mt-auto rounded-lg border border-dashed border-border p-3">
                        <p className={cn(typeStyles.small, 'flex items-center gap-1.5 font-medium')}>
                            <Send className="size-3.5" aria-hidden /> On your phone too
                        </p>
                        <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                            Link Telegram and send jobs or notes the moment they happen.
                        </p>
                        <Link href="/settings/channels" className={cn(typeStyles.small, 'mt-2 inline-flex font-medium text-primary hover:underline')}>
                            Link Telegram
                        </Link>
                    </section>
                ) : null}
            </div>
        </aside>
    );
}
