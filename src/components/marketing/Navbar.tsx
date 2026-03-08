'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-foreground"
          style={{ fontFamily: "'Sora', system-ui, sans-serif" }}
        >
          <img src="/logo.png" alt="Patronus Logo" className="h-8 w-auto drop-shadow-[0_0_8px_rgba(143,201,255,0.6)]" />
          Patronus
        </Link>

        <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
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
              <Button variant="ghost" size="sm" className="text-muted-foreground text-[13px]">
                Sign in
              </Button>
            </SignInButton>
            <Link href="/sign-up">
              <Button size="sm" className="text-[13px]">Get started</Button>
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
