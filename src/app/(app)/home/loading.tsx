import { Skeleton } from '@/components/ui/skeleton';

/** Goals' skeleton: the question and its option cards, at their real sizes. */
export default function GoalsLoading() {
    return (
        <div className="mx-auto w-full max-w-[760px] px-4 py-8" aria-busy="true" aria-label="Loading Goals">
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="mt-2 h-4 w-96 max-w-full" />
            <div className="mt-5 space-y-2">
                {[0, 1, 2, 3, 4].map((row) => (
                    <Skeleton key={row} className="h-[92px] rounded-lg" />
                ))}
            </div>
        </div>
    );
}
