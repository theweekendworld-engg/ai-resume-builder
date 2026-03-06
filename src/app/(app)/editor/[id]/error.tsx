'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

type EditorErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function EditorError({ error, reset }: EditorErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-2xl font-semibold tracking-tight">Failed to load editor</h2>
      <p className="text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred while loading the editor.'}
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
