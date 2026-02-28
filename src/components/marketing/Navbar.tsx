'use client';

import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

export function Navbar() {
  return (
    <header className="border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          ResumePilot
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="hover:text-foreground transition-colors">Features</Link>
          <Link href="/#how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
          <Link href="/#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
        </nav>

        <div className="flex items-center gap-2">
          <SignedOut>
            <SignInButton mode="redirect" forceRedirectUrl="/dashboard">
              <Button variant="ghost" size="sm">Sign In</Button>
            </SignInButton>
            <Link href="/sign-up">
              <Button size="sm">Get Started Free</Button>
            </Link>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard">
              <Button size="sm" variant="secondary">Dashboard</Button>
            </Link>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
