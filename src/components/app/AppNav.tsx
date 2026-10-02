'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Compass, FileText, Home, Inbox, Menu, MessageSquare, NotebookPen, Radar, Sparkles, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * The product's navigation.
 *
 * ── Why this did not exist ──────────────────────────────────────────────────
 *
 * `(app)/layout.tsx` was nine lines: a div and a generation banner. No header,
 * no sidebar, no tab bar. Grepping every component for links to the product's
 * own surfaces turned up nothing at all pointing to `/packets`, `/radar` or
 * `/home` — five fully built features were reachable only by typing the URL.
 *
 * That was filed once as "IA / navigation — deferred". It was not a refinement
 * that got deferred; there was no navigation to refine.
 *
 * ── What it shows ───────────────────────────────────────────────────────────
 *
 * Only destinations the user can actually open. The flag decisions are made on
 * the server and passed in, so a link is never rendered for a surface that
 * would `notFound()`. A nav that leads to a 404 is worse than no nav: it
 * teaches people the product is broken rather than that a feature is off.
 *
 * Surfaces that own their full chrome — the editor, first run, the print view
 * — opt out. A focus surface with a global header stops being one.
 */

export type NavDestination = 'chat' | 'home' | 'log' | 'resumes' | 'packets' | 'radar' | 'scout';

const DESTINATIONS: Record<
    NavDestination,
    { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
> = {
    // The front door when on (docs/prd/10-chat.md): first in the nav, and
    // where the logo goes.
    chat: { href: '/chat', label: 'Chat', icon: MessageSquare },
    home: { href: '/home', label: 'Home', icon: Home },
    log: { href: '/log', label: 'Work Log', icon: NotebookPen },
    resumes: { href: '/dashboard', label: 'Resumes', icon: FileText },
    packets: { href: '/packets', label: 'Packets', icon: Compass },
    radar: { href: '/radar', label: 'Radar', icon: Radar },
    // The route stays /scout (links in chat messages point there); the
    // surface is the inbox now: jobs, insights, companies, notes.
    scout: { href: '/scout', label: 'Inbox', icon: Inbox },
};

/** Order is the user's mental model, not the object's key order. */
const ORDER: NavDestination[] = ['chat', 'home', 'log', 'scout', 'resumes', 'packets', 'radar'];

/**
 * Paths that render their own full-screen chrome.
 *
 * `/editor` is a workspace, `/welcome` is first run, and the print view must
 * contain nothing but the document.
 */
const OWNS_CHROME = [/^\/editor(\/|$)/, /^\/welcome(\/|$)/, /\/print(\/|$)/, /^\/admin(\/|$)/];

function isActive(pathname: string, href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/editor');
    return pathname === href || pathname.startsWith(`${href}/`);
}


/**
 * Clerk's UserButton, held back until after hydration.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 *
 * `UserButton` renders a placeholder during SSR and a full subtree on the
 * client. React allocates `useId` in render order, so a component that consumes
 * a different number of ids on each side shifts every id AFTER it — which is
 * why the Sheet trigger below rendered `aria-controls="radix-_R_7qitmtb_"` on
 * the server and `radix-_R_vabmrlb_` on the client, and React warned that the
 * tree could not be patched up.
 *
 * ── Why isolate rather than reorder ─────────────────────────────────────────
 *
 * Moving the Sheet above the UserButton also works, by putting the Radix ids
 * before the asymmetric subtree. It fixes this instance and leaves the trap
 * armed: the next component added between them breaks it again, and nothing
 * records why the order mattered. Rendering nothing on the server and nothing
 * on the first client pass makes the two sides identical by construction, so
 * ids downstream cannot drift no matter what is added around it.
 *
 * The reserved box keeps the header from shifting when the real button appears.
 */
function HydratedUserButton() {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);

    if (!mounted) return <div className="size-7 shrink-0" aria-hidden />;
    return <UserButton />;
}

export function AppNav({ destinations }: { destinations: NavDestination[] }) {
    const pathname = usePathname() ?? '';
    const [open, setOpen] = React.useState(false);

    if (OWNS_CHROME.some((pattern) => pattern.test(pathname))) return null;

    const items = ORDER.filter((key) => destinations.includes(key)).map((key) => ({
        key,
        ...DESTINATIONS[key],
    }));

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-background">
            <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-4 sm:px-6">
                <Link
                    href={items.some((item) => item.key === 'chat') ? '/chat' : items.some((item) => item.key === 'home') ? '/home' : '/dashboard'}
                    className="font-heading text-sm font-semibold tracking-tight text-foreground"
                >
                    Patronus
                </Link>

                <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
                    {items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(pathname, item.href);
                        return (
                            <Link
                                key={item.key}
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                                    active
                                        ? 'bg-secondary text-foreground'
                                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                                )}
                            >
                                <Icon className="size-4" aria-hidden />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="ml-auto flex items-center gap-2">
                    <Button asChild size="sm" className="gap-1.5">
                        <Link href="/build">
                            <Sparkles className="size-4" aria-hidden />
                            <span className="hidden sm:inline">Tailor a resume</span>
                            <span className="sm:hidden">Tailor</span>
                        </Link>
                    </Button>
                    {/* Settings were mobile-sheet only; desktop had no way in (audit §E). */}
                    <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Settings">
                        <Link href="/settings">
                            <Settings className="size-4" aria-hidden />
                        </Link>
                    </Button>
                    <HydratedUserButton />

                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
                                <Menu className="size-5" aria-hidden />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[260px]">
                            <SheetTitle className="mb-4 text-base">Patronus</SheetTitle>
                            <nav aria-label="Main" className="flex flex-col gap-1">
                                {items.map((item) => {
                                    const Icon = item.icon;
                                    const active = isActive(pathname, item.href);
                                    return (
                                        <Link
                                            key={item.key}
                                            href={item.href}
                                            onClick={() => setOpen(false)}
                                            aria-current={active ? 'page' : undefined}
                                            className={cn(
                                                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                                                active
                                                    ? 'bg-secondary text-foreground'
                                                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                                            )}
                                        >
                                            <Icon className="size-4" aria-hidden />
                                            {item.label}
                                        </Link>
                                    );
                                })}
                                {/*
                                  Settings links sit below the primary nav, in
                                  the order someone reaches for them: resume
                                  defaults change what every generation
                                  produces, so they are used far more often
                                  than billing.
                                */}
                                <Link
                                    href="/settings/resume"
                                    onClick={() => setOpen(false)}
                                    className="mt-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                                >
                                    Resume defaults
                                </Link>
                                <Link
                                    href="/settings/job-search"
                                    onClick={() => setOpen(false)}
                                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                                >
                                    Job-search preferences
                                </Link>
                                <Link
                                    href="/settings/plan"
                                    onClick={() => setOpen(false)}
                                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                                >
                                    Plan &amp; billing
                                </Link>
                                <Link
                                    href="/settings/notifications"
                                    onClick={() => setOpen(false)}
                                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                                >
                                    Notifications
                                </Link>
                                <Link
                                    href="/settings"
                                    onClick={() => setOpen(false)}
                                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                                >
                                    All settings
                                </Link>
                            </nav>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    );
}
