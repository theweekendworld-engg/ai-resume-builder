import { Loader2 } from 'lucide-react';

export function StepGenerate() {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
      <h2 className="text-lg font-semibold">Generating your resume draft</h2>
      <p className="text-sm text-muted-foreground">We are creating a clean first draft. You can customize every section in the editor.</p>
    </div>
  );
}
