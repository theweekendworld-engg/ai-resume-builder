import { LogListSkeleton } from '@/components/log/LogList';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton rows matching the final geometry — never a spinner (design/02 §B).
 *
 * The header, the filter bar and the rail are all held at their real sizes so
 * that when the data lands nothing moves. A layout shift on the surface people
 * open every morning is the cheapest way to make a fast product feel slow.
 */
export default function LogLoading() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Skeleton className="h-9 w-full rounded-lg" />
          <LogListSkeleton groups={2} rows={4} />
        </div>

        <div className="hidden space-y-4 lg:block">
          <Skeleton className="h-[72px] rounded-lg" />
          <Skeleton className="h-[72px] rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      </div>
    </main>
  );
}
