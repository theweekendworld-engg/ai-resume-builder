import { Skeleton } from '@/components/ui/skeleton';

export default function EditorLoading() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  );
}
