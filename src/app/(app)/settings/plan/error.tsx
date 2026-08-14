'use client';

import * as React from 'react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The plan page failed to load.
 *
 * The first thing anyone assumes when a billing page breaks is that something
 * happened to their subscription or their data. Neither did, and saying so is
 * the entire job of this screen.
 */
export default function PlanError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className={cn(typeStyles.h1, 'text-foreground')}>Your plan didn&apos;t load</h1>
      <p className={cn(typeStyles.body, 'text-muted-foreground')}>
        Your subscription and your record are untouched — this is the page failing to read them,
        nothing more. No charge was made and nothing was cancelled.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      {error.digest ? (
        <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
          Reference {error.digest}
        </p>
      ) : null}
    </main>
  );
}
