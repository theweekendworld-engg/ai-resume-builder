import Link from 'next/link';
import { Plus } from 'lucide-react';

export function CreateResumeCard() {
  return (
    <Link
      href="/build"
      className="group flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
    >
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <Plus className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">Tailor a new resume</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Paste a job and get a version aimed at it, built from your record.
      </p>
    </Link>
  );
}
