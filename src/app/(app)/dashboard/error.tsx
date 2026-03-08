'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-2xl font-semibold tracking-tight">Failed to load dashboard</h2>
      <p className="text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred while loading your dashboard.'}
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
