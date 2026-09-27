'use client';

import * as React from 'react';
import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { START_FREE_HREF } from './links';

/**
 * ── Two changes worth explaining ────────────────────────────────────────────
 *
 * **It grows a background on scroll.** At the top of the page the bar is
 * transparent, so the hero's glow runs unbroken to the top edge — a permanent
 * translucent strip cuts a visible seam across it. Past 12px the surface fades
 * in, because by then the bar is over content and needs to be legible. The
 * threshold is small on purpose: the transition should happen while the reader
 * is still at the top, not as a surprise a third of the way down.
 *
 * **It has a mobile menu.** The previous version hid the nav entirely below
 * `md`, which meant a phone reader could reach no section of the page except by
 * scrolling past all of it. The links are the table of contents; on the
 * narrowest screen is where that matters most.
 *
 * `backdrop-blur` is deliberate here and does not contradict the design rule
 * against it — that rule (CLAUDE.md, Conventions) is about scrolling LISTS,
 * where each blurred element costs a compositing layer per row. This is one
 * fixed element.
 */

const LINKS = [
    { href: '/score', label: 'Check resume' },
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/#features', label: 'Features' },
    { href: '/#pricing', label: 'Pricing' },
    { href: '/#faq', label: 'Questions' },
    { href: '/#contact', label: 'Contact' },
];

export function Navbar() {
    const [scrolled, setScrolled] = React.useState(false);
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 12);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // A menu left open while the page scrolls behind it is a stuck overlay.
    React.useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener('resize', close);
        return () => window.removeEventListener('resize', close);
    }, [open]);

    return (
        <header
            className={cn(
                'sticky top-0 z-50 transition-all duration-300',
                scrolled || open
                    ? 'border-b border-border/60 bg-background/85 backdrop-blur-xl'
                    : 'border-b border-transparent bg-transparent',
            )}
        >
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
                <Link
                    href="/"
                    className="font-heading flex items-center gap-2.5 text-base font-bold tracking-tight text-foreground"
                    onClick={() => setOpen(false)}
                >
                    <img
                        src="/logo.png"
                        alt=""
                        className="h-8 w-auto drop-shadow-[0_0_10px_hsl(190_100%_50%/0.55)]"
                    />
                    Patronus
                </Link>

                <nav className="hidden items-center gap-8 text-[13px] font-medium text-muted-foreground md:flex">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="transition-colors hover:text-primary"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>

                <div className="flex items-center gap-2">
                    <SignedOut>
                        <SignInButton mode="redirect" fallbackRedirectUrl="/dashboard">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="hidden text-[13px] text-muted-foreground sm:inline-flex"
                            >
                                Sign in
                            </Button>
                        </SignInButton>
                        <Link
                            href={START_FREE_HREF}
                            className="mk-btn mk-btn-sm hidden sm:inline-flex"
                        >
                            Start free
                        </Link>
                    </SignedOut>
                    <SignedIn>
                        <Link href="/dashboard">
                            <Button size="sm" variant="secondary" className="text-[13px]">
                                Dashboard
                            </Button>
                        </Link>
                        <UserButton />
                    </SignedIn>

                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground md:hidden"
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        aria-expanded={open}
                    >
                        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                    </button>
                </div>
            </div>

            {open ? (
                <nav className="border-t border-border/60 px-5 pb-6 pt-2 sm:px-6 md:hidden">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(false)}
                            className="block border-b border-border/40 py-3.5 text-sm font-medium text-muted-foreground transition-colors last:border-0 hover:text-primary"
                        >
                            {link.label}
                        </Link>
                    ))}
                    <SignedOut>
                        <Link
                            href={START_FREE_HREF}
                            onClick={() => setOpen(false)}
                            className="mk-btn mt-5 w-full"
                        >
                            Start free
                        </Link>
                    </SignedOut>
                </nav>
            ) : null}
        </header>
    );
}
