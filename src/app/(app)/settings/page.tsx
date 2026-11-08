import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { Bell, Brain, CalendarDays, ChevronRight, CreditCard, FileText, GitBranch, MessageCircle, Target, UserRound } from 'lucide-react';
import { isEnabled } from '@/lib/flags';
import { DeleteAccountSection } from '@/components/settings/DeleteAccountSection';
import { AppearanceSetting } from '@/components/settings/AppearanceSetting';
import { PageBody, PageHeader, typeStyles } from '@/components/patterns';

export const metadata = { title: 'Settings · Patronus' };

/**
 * `/settings` — every setting in one place.
 *
 * Until 2026-09-27 the settings pages were reachable only from the mobile
 * menu (a `md:hidden` sheet) or from nowhere at all: on desktop there was no
 * way to find notifications, sources or even the plan page (audit §E).
 */
export default async function SettingsIndexPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    const [capture, journey] = await Promise.all([isEnabled(userId, 'github_capture'), isEnabled(userId, 'job_journey')]);

    const items = [
        { href: '/settings/resume', icon: FileText, title: 'Resume defaults', body: 'Template, section order and length for every resume you generate.' },
        { href: '/settings/job-search', icon: Target, title: 'Job search', body: 'Roles, locations and pay you are looking for, and your LinkedIn connections.' },
        { href: '/settings/memory', icon: Brain, title: 'Memory', body: 'What you have told me, so I never ask twice. Edit, make private or delete any of it.' },
        ...(journey ? [{ href: '/settings/email', icon: CalendarDays, title: 'Email & calendar', body: 'Forward job email to Patronus and connect Google Calendar, so every application tracks itself.' }] : []),
        { href: '/settings/channels', icon: MessageCircle, title: 'Channels', body: 'Web chat, Telegram, WhatsApp, the browser extension and the CLI.' },
        ...(capture ? [{ href: '/settings/sources', icon: GitBranch, title: 'Sources', body: 'Connect GitHub so your merged work becomes Work Log drafts.' }] : []),
        { href: '/settings/notifications', icon: Bell, title: 'Notifications', body: 'The weekly digest, monthly review and what reaches your inbox.' },
        { href: '/settings/plan', icon: CreditCard, title: 'Plan & usage', body: 'What you have used this month. Every feature is included while we launch.' },
        { href: '/account', icon: UserRound, title: 'Account', body: 'Email, sign-in methods and linked accounts like GitHub.' },
    ];

    return (
        <div>
            <PageHeader title="Settings" description="How Patronus works for you: what it builds, where it reaches you, what it remembers." />
            <PageBody className="max-w-3xl space-y-8">
            <section aria-labelledby="settings-list">
            <h2 id="settings-list" className={typeStyles.eyebrow + ' mb-3'}>Everything</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {items.map((item) => {
                    const Icon = item.icon;
                    return (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                // Inset, so the focus ring is not clipped by the rounded list.
                                className="group flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-offset-[-2px]"
                            >
                                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
                                    <Icon className="size-[18px]" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium text-foreground">{item.title}</span>
                                    <span className="block text-sm text-muted-foreground">{item.body}</span>
                                </span>
                                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
                            </Link>
                        </li>
                    );
                })}
            </ul>
            </section>
            <section aria-labelledby="settings-display">
                <h2 id="settings-display" className={typeStyles.eyebrow + ' mb-3'}>Display</h2>
                <AppearanceSetting />
            </section>
            <DeleteAccountSection />
            </PageBody>
        </div>
    );
}
