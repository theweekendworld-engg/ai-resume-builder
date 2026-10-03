'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
    Compass,
    FileText,
    Home,
    Inbox,
    MessageSquare,
    MoreHorizontal,
    NotebookPen,
    Radar,
    Settings,
    Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * The app shell (redesign 2026-10-02, docs/design/00 §5.2).
 *
 * Desktop: a left sidebar, icons only at `md`, labelled from `lg`. Mobile: a
 * slim top bar and a bottom tab bar with the four most-used destinations plus
 * "More". The product became chat-first with seven destinations, which no
 * longer fit a top bar, and every page used to bring its own chrome on top of
 * it (the dashboard had a second sidebar).
 *
 * Only destinations the user can open are passed in (flags are resolved in
 * `(app)/layout.tsx`), so no link here leads to a switched-off page.
 *
 * Surfaces that own their full chrome (the editor, first run, print views,
 * admin) render without the shell.
 */

export type NavDestination = 'chat' | 'home' | 'log' | 'resumes' | 'packets' | 'radar' | 'scout';

type Item = { key: NavDestination; href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const DESTINATIONS: Record<NavDestination, Omit<Item, 'key'>> = {
    chat: { href: '/chat', label: 'Chat', icon: MessageSquare },
    // Missions: the goal you are working toward and its next step.
    home: { href: '/home', label: 'Goals', icon: Home },
    log: { href: '/log', label: 'Work Log', icon: NotebookPen },
    // The route stays /scout (links in chat messages point there).
    scout: { href: '/scout', label: 'Jobs', icon: Inbox },
    resumes: { href: '/dashboard', label: 'Resumes', icon: FileText },
    packets: { href: '/packets', label: 'Packets', icon: Compass },
    radar: { href: '/radar', label: 'Radar', icon: Radar },
};

/** The order of the user's day: talk, then what they are working toward, then the records. */
const ORDER: NavDestination[] = ['chat', 'home', 'log', 'scout', 'resumes', 'packets', 'radar'];

/** On a phone, four tabs and "More". Chosen by how often each is opened. */
const MOBILE_TABS: NavDestination[] = ['chat', 'scout', 'log', 'resumes'];

const OWNS_CHROME = [/^\/editor(\/|$)/, /^\/welcome(\/|$)/, /\/print(\/|$)/, /^\/admin(\/|$)/];

function isActive(pathname: string, href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/editor') || pathname.startsWith('/build');
    return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Clerk's UserButton, held back until after hydration: it renders a different
 * subtree on the server, which shifts every `useId` after it and breaks Radix
 * ids downstream. Empty on both sides of the first pass keeps them identical.
 */
function HydratedUserButton() {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    if (!mounted) return <div className="size-7 shrink-0" aria-hidden />;
    return <UserButton />;
}

function Logo({ href }: { href: string }) {
    return (
        <Link href={href} className="flex items-center gap-2.5" aria-label="Patronus home">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">
                P
            </span>
            <span className="hidden font-heading text-[15px] font-semibold tracking-tight text-foreground lg:inline">Patronus</span>
        </Link>
    );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            className={cn(
                'flex h-9 items-center justify-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors lg:justify-start',
                active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
        >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            <span className="hidden lg:inline">{item.label}</span>
        </Link>
    );
}

export function AppShell({ destinations, children }: { destinations: NavDestination[]; children: React.ReactNode }) {
    const pathname = usePathname() ?? '';
    const [moreOpen, setMoreOpen] = React.useState(false);

    if (OWNS_CHROME.some((pattern) => pattern.test(pathname))) return <>{children}</>;

    const items: Item[] = ORDER.filter((key) => destinations.includes(key)).map((key) => ({ key, ...DESTINATIONS[key] }));
    const home = items[0]?.href ?? '/dashboard';
    const hasChat = items.some((item) => item.key === 'chat');
    const tabs = items.filter((item) => MOBILE_TABS.includes(item.key));
    const overflow = items.filter((item) => !MOBILE_TABS.includes(item.key));
    const settingsItem: Item = { key: 'home', href: '/settings', label: 'Settings', icon: Settings };

    return (
        <div className="flex min-h-dvh [--shell-top:3.5rem] md:[--shell-top:0px]">
            {/* ── Desktop sidebar ─────────────────────────────────────────── */}
            <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r border-border bg-card px-2 py-3 md:flex lg:w-60 lg:px-3">
                <div className="flex h-10 items-center justify-center px-1 lg:justify-start">
                    <Logo href={home} />
                </div>

                {hasChat ? null : (
                    <Button asChild size="sm" className="mt-4 gap-1.5 lg:justify-start" title="Tailor a resume">
                        <Link href="/build">
                            <Sparkles className="size-4" aria-hidden />
                            <span className="hidden lg:inline">Tailor a resume</span>
                        </Link>
                    </Button>
                )}

                <nav aria-label="Main" className="mt-4 flex flex-col gap-0.5">
                    {items.map((item) => <NavLink key={item.key} item={item} active={isActive(pathname, item.href)} />)}
                </nav>

                <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
                    <NavLink item={settingsItem} active={pathname.startsWith('/settings') || pathname === '/account'} />
                    <div className="mt-2 flex h-10 items-center justify-center gap-3 px-1 lg:justify-start lg:px-2">
                        <HydratedUserButton />
                        <span className="hidden text-xs text-muted-foreground lg:inline">Account</span>
                    </div>
                </div>
            </aside>

            {/* ── Content ─────────────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4 md:hidden">
                    <Link href={home} className="flex items-center gap-2" aria-label="Patronus home">
                        <span className="grid size-7 place-items-center rounded-lg bg-primary font-heading text-xs font-bold text-primary-foreground">P</span>
                        <span className="font-heading text-[15px] font-semibold tracking-tight">Patronus</span>
                    </Link>
                    <HydratedUserButton />
                </header>
                {/* Room for the tab bar on phones. */}
                <main data-app-main className="flex-1 pb-16 md:pb-0">{children}</main>
            </div>

            {/* ── Mobile tab bar ──────────────────────────────────────────── */}
            <nav
                aria-label="Main"
                className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
            >
                {tabs.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(pathname, item.href);
                    return (
                        <Link
                            key={item.key}
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}
                        >
                            <Icon className="size-5" aria-hidden />
                            {item.label}
                        </Link>
                    );
                })}
                <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
                    <SheetTrigger asChild>
                        <button type="button" className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground">
                            <MoreHorizontal className="size-5" aria-hidden />
                            More
                        </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                        <SheetTitle className="mb-3 text-base">More</SheetTitle>
                        <nav aria-label="More" className="grid grid-cols-1 gap-1">
                            {[...overflow, settingsItem].map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMoreOpen(false)}
                                    className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-secondary"
                                >
                                    <item.icon className="size-[18px] text-muted-foreground" aria-hidden />
                                    {item.label}
                                </Link>
                            ))}
                        </nav>
                    </SheetContent>
                </Sheet>
            </nav>
        </div>
    );
}
