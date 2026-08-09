'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

export function Navbar() {
    return (
        <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
                <Link
                    href="/"
                    className="font-heading flex items-center gap-2.5 text-base font-semibold tracking-tight text-foreground"
                >
                    <img
                        src="/logo.png"
                        alt="Patronus Logo"
                        className="h-8 w-auto drop-shadow-[0_0_8px_rgba(143,201,255,0.6)]"
                    />
                    Patronus
                </Link>

                <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
                    <Link href="/score" className="transition-colors hover:text-foreground">
                        Check resume
                    </Link>
                    <Link href="/#features" className="transition-colors hover:text-foreground">
                        Features
                    </Link>
                    <Link href="/#how-it-works" className="transition-colors hover:text-foreground">
                        How it works
                    </Link>
                    <Link href="/#pricing" className="transition-colors hover:text-foreground">
                        Pricing
                    </Link>
                </nav>

                <div className="flex items-center gap-2">
                    <SignedOut>
                        <SignInButton mode="redirect" forceRedirectUrl="/dashboard">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground text-[13px]"
                            >
                                Sign in
                            </Button>
                        </SignInButton>
                        <Link href="/sign-up?redirect_url=/build">
                            <Button size="sm" className="text-[13px]">
                                Start free
                            </Button>
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
                </div>
            </div>
        </header>
    );
}
