import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { Bell, ChevronRight, CreditCard, FileText, GitBranch, MessageCircle, Target, UserRound } from 'lucide-react';
import { isEnabled } from '@/lib/flags';

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
    const capture = await isEnabled(userId, 'github_capture');

    const items = [
        { href: '/settings/resume', icon: FileText, title: 'Resume defaults', body: 'Template, section order and length for every resume you generate.' },
        { href: '/settings/job-search', icon: Target, title: 'Job search', body: 'Roles, locations and pay you are looking for, and your LinkedIn connections.' },
        { href: '/dashboard?section=telegram', icon: MessageCircle, title: 'Chat apps', body: 'Link Telegram so you can send jobs, posts and notes from your phone.' },
        ...(capture ? [{ href: '/settings/sources', icon: GitBranch, title: 'Sources', body: 'Connect GitHub so your merged work becomes Work Log drafts.' }] : []),
        { href: '/settings/notifications', icon: Bell, title: 'Notifications', body: 'The weekly digest, monthly review and what reaches your inbox.' },
        { href: '/settings/plan', icon: CreditCard, title: 'Plan & usage', body: 'What you have left this month, and paid plans.' },
        { href: '/account', icon: UserRound, title: 'Account', body: 'Email, sign-in methods and linked accounts like GitHub.' },
    ];

    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
            <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
                {items.map((item) => {
                    const Icon = item.icon;
                    return (
                        <li key={item.href}>
                            <Link href={item.href} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50">
                                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium text-foreground">{item.title}</span>
                                    <span className="block text-sm text-muted-foreground">{item.body}</span>
                                </span>
                                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
