import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeletons at the final geometry — never a spinner. The usage rows are the
 * tallest thing on the page, so they are what gets held.
 */
export default function PlanLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:py-8">
      <Skeleton className="mb-6 h-8 w-24" />
      <Skeleton className="h-[132px] rounded-xl" />
      <Skeleton className="mt-6 h-[280px] rounded-xl" />
      <Skeleton className="mt-6 h-[220px] rounded-xl" />
      <Skeleton className="mt-6 h-[120px] rounded-xl" />
    </main>
  );
}
