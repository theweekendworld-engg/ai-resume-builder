'use client';

import * as React from 'react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The log failed to load at all.
 *
 * A sync failure never lands here — that renders as an inline banner above a
 * list that still works (design/02 §B). This is the case where there is no
 * list to render, and the only honest thing to say is what broke and what the
 * user can do about it. The record itself is never at risk, and the copy says
 * so, because "failed to load your career log" reads like data loss.
 */
export default function LogError({
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
      <h1 className={cn(typeStyles.h1, 'text-foreground')}>Your log didn&apos;t load</h1>
      <p className={cn(typeStyles.body, 'text-muted-foreground')}>
        Nothing is lost — your record is stored and this is only the page failing to read it.
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
