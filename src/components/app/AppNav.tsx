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
    PenLine,
    Radar,
    Settings,
    Target,
    Telescope,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { isActive, NAV_GROUPS, NAV_ROUTES, SETTINGS_ROUTE, type NavDestination } from './navRoutes';

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
 *
 * Dossier (2026-11-08): ink on paper, grouped into Search / Record / Goals
 * (`NAV_GROUPS`) under letterspaced eyebrows. The current page is marked by a
 * 2px teal bar on the inner edge and ink text, not a filled pill, so the nav
 * stays quiet and the one accent means "you are here". The phone tab bar uses
 * the same bar along its top edge.
 */

export type { NavDestination } from './navRoutes';

type Item = { key: NavDestination; href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const ICONS: Record<NavDestination, Item['icon']> = {
    overview: Home,
    chat: MessageSquare,
    home: Target,
    log: NotebookPen,
    scout: Inbox,
    watch: Telescope,
    resumes: FileText,
    packets: Compass,
    radar: Radar,
};

const DESTINATIONS = Object.fromEntries(
    (Object.keys(NAV_ROUTES) as NavDestination[]).map((key) => [key, { ...NAV_ROUTES[key], icon: ICONS[key] }]),
) as Record<NavDestination, Omit<Item, 'key'>>;


/** On a phone, four tabs and "More". Chosen by how often each is opened. */
const MOBILE_TABS: NavDestination[] = ['overview', 'chat', 'scout', 'log'];

/** A phone tab: 64px tall, the full width share, the teal bar on top when current. */
const TAB_CLASS = 'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150';

const OWNS_CHROME = [/^\/editor(\/|$)/, /^\/welcome(\/|$)/, /\/print(\/|$)/, /^\/admin(\/|$)/];

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

/** The wordmark: an ink monogram tab and the name in the serif. */
function Monogram({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            className={cn('grid size-8 shrink-0 place-items-center rounded-md bg-foreground font-display text-[17px] font-semibold leading-none text-background', className)}
        >
            P
        </span>
    );
}

function Logo({ href }: { href: string }) {
    return (
        <Link href={href} className="flex items-center gap-2.5 rounded-md" aria-label="Patronus home">
            <Monogram />
            <span className="hidden font-display text-[19px] font-semibold tracking-[-0.01em] text-foreground lg:inline">Patronus</span>
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
                'relative flex h-10 items-center justify-center gap-3 rounded-md px-2.5 text-sm transition-colors duration-150 lg:justify-start',
                // Ink on paper when active (15:1), with the teal bar; muted
                // ink (6.1:1) otherwise. The old filled pill is gone.
                active
                    ? 'bg-card font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border))]'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
            )}
        >
            {active ? <span aria-hidden className="absolute inset-y-2 -left-2 w-0.5 rounded-full bg-primary lg:-left-3" /> : null}
            <Icon className={cn('size-[18px] shrink-0', active && 'text-primary')} aria-hidden />
            {/* Visually hidden, not `hidden`, at the icon-only width: the
                label is the link's accessible name at every size. */}
            <span className="sr-only lg:not-sr-only">{item.label}</span>
        </Link>
    );
}

export function AppShell({
    destinations,
    children,
    pathnameOverride,
}: {
    destinations: NavDestination[];
    children: React.ReactNode;
    /** For the dev gallery's mocked screens only: which page to mark current. */
    pathnameOverride?: string;
}) {
    const routerPathname = usePathname() ?? '';
    const pathname = pathnameOverride ?? routerPathname;
    const [moreOpen, setMoreOpen] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);

    if (OWNS_CHROME.some((pattern) => pattern.test(pathname))) return <>{children}</>;

    const groups = NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((key) => destinations.includes(key)).map((key): Item => ({ key, ...DESTINATIONS[key] })),
    })).filter((group) => group.items.length > 0);
    const items: Item[] = groups.flatMap((group) => group.items);
    const home = items[0]?.href ?? '/dashboard';
    const hasChat = items.some((item) => item.key === 'chat');
    const tabs = items.filter((item) => MOBILE_TABS.includes(item.key));
    const overflow = items.filter((item) => !MOBILE_TABS.includes(item.key));
    const settingsItem: Item = { key: 'home', ...SETTINGS_ROUTE, icon: Settings };
    const sheetItems = [...overflow, settingsItem];
    const moreActive = sheetItems.some((item) => isActive(pathname, item.href));

    return (
        <div className="flex min-h-dvh [--shell-top:3.5rem] md:[--shell-top:0px]">
            {/* Keyboard users skip the nav in one Tab. */}
            <a
                href="#main"
                className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border))] focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
            >
                Skip to content
            </a>

            {/* ── Desktop sidebar ─────────────────────────────────────────── */}
            <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col overflow-y-auto border-r border-border bg-background px-2 py-4 [scrollbar-width:none] md:flex lg:w-60 lg:px-3">
                <div className="flex h-10 items-center justify-center px-1 lg:justify-start">
                    <Logo href={home} />
                </div>

                {hasChat ? null : (
                    <Button asChild size="sm" className="mt-5 gap-1.5 lg:justify-start" title="Tailor a resume">
                        <Link href="/build">
                            <PenLine className="size-4" aria-hidden />
                            <span className="sr-only lg:not-sr-only">Tailor a resume</span>
                        </Link>
                    </Button>
                )}

                <nav aria-label="Main" className="mt-5 flex flex-col">
                    {groups.map((group, index) => (
                        <div key={group.key} className={cn(index > 0 && (group.label ? 'mt-5' : 'mt-3 border-t border-border pt-3'))}>
                            {group.label ? (
                                <p className="eyebrow mb-1.5 hidden px-2.5 lg:block">{group.label}</p>
                            ) : null}
                            {group.label && index > 0 ? <div aria-hidden className="mx-2 mb-2 border-t border-border lg:hidden" /> : null}
                            <ul className="flex flex-col gap-0.5" aria-label={group.label ?? undefined}>
                                {group.items.map((item) => (
                                    <li key={item.key}>
                                        <NavLink item={item} active={isActive(pathname, item.href)} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>

                <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
                    <NavLink item={settingsItem} active={isActive(pathname, settingsItem.href)} />
                    <div className="mt-2 flex h-10 items-center justify-center gap-3 px-1 lg:justify-start lg:px-2.5">
                        <HydratedUserButton />
                        <span className="hidden text-[13px] text-muted-foreground lg:inline">Account</span>
                    </div>
                </div>
            </aside>

            {/* ── Content ─────────────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4 md:hidden">
                    <Link href={home} className="flex items-center gap-2 rounded-md" aria-label="Patronus home">
                        <Monogram className="size-7 text-[15px]" />
                        <span className="font-display text-[18px] font-semibold tracking-[-0.01em]">Patronus</span>
                    </Link>
                    <HydratedUserButton />
                </header>
                {/* Room for the tab bar on phones. */}
                <main id="main" tabIndex={-1} data-app-main className="flex-1 pb-16 outline-none md:pb-0">{children}</main>
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
                            className={cn(TAB_CLASS, active ? 'text-foreground' : 'text-muted-foreground')}
                        >
                            {active ? <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-primary" /> : null}
                            <Icon className={cn('size-5', active && 'text-primary')} aria-hidden />
                            {item.label}
                        </Link>
                    );
                })}
                {!mounted ? (
                    // Radix ids (aria-controls) came out different on the server and
                    // the client and failed hydration. The bar is phone-only, so the
                    // sheet mounts on the client; this placeholder looks the same.
                    <button
                        type="button"
                        aria-label="More"
                        className={cn(TAB_CLASS, moreActive ? 'text-foreground' : 'text-muted-foreground')}
                    >
                        <MoreHorizontal className="size-5" aria-hidden />
                        More
                    </button>
                ) : (
                <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
                    <SheetTrigger asChild>
                        {/* Lit when the page you are on lives behind it, so
                            the bar never shows "nowhere" as the current place. */}
                        <button
                            type="button"
                            className={cn(TAB_CLASS, moreActive ? 'text-foreground' : 'text-muted-foreground')}
                        >
                            {moreActive ? <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-primary" /> : null}
                            <MoreHorizontal className={cn('size-5', moreActive && 'text-primary')} aria-hidden />
                            More
                        </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                        <SheetTitle className="mb-2 font-sans text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground">More</SheetTitle>
                        <nav aria-label="More" className="grid grid-cols-1 gap-1">
                            {sheetItems.map((item) => {
                                const active = isActive(pathname, item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setMoreOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'relative flex h-11 items-center gap-3 rounded-md px-3 text-sm',
                                            active ? 'bg-secondary font-medium text-foreground' : 'text-foreground hover:bg-secondary/70',
                                        )}
                                    >
                                        {active ? <span aria-hidden className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary" /> : null}
                                        <item.icon className={cn('size-[18px]', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </SheetContent>
                </Sheet>
                )}
            </nav>
        </div>
    );
}
