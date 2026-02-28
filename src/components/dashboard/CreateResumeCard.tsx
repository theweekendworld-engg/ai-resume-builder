import Link from 'next/link';
import { Plus } from 'lucide-react';

export function CreateResumeCard() {
  return (
    <Link
      href="/editor/new"
      className="group flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center transition-colors hover:border-primary/60 hover:bg-card/80"
    >
      <div className="mb-4 rounded-full border border-border p-3 text-primary group-hover:border-primary/60">
        <Plus className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold">Create New Resume</h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Start with a quick setup, then use the in-editor tour to learn every major section.
      </p>
    </Link>
  );
}
