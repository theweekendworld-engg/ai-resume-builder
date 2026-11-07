import { Skeleton } from '@/components/ui/skeleton';
import { pageContainer } from '@/components/patterns';
import { cn } from '@/lib/utils';

/**
 * Home's skeleton, at the final geometry (header, ask bar, pipeline, the two
 * columns). Without it a click on "Home" in the sidebar did nothing visible
 * until the server answered (UI audit 2026-11-07, loading feedback).
 */
export default function OverviewLoading() {
    return (
        <div aria-busy="true" aria-label="Loading Home">
            <div className="border-b border-border pb-5">
                <div className={cn(pageContainer, 'pt-6 md:pt-8')}>
                    <Skeleton className="h-8 w-56" />
                    <Skeleton className="mt-1.5 h-4 w-80 max-w-full" />
                </div>
            </div>
            <div className={cn(pageContainer, 'space-y-6 py-6')}>
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-[86px] rounded-xl" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <Skeleton className="h-64 rounded-xl" />
                        <Skeleton className="h-48 rounded-xl" />
                    </div>
                    <div className="space-y-6">
                        <Skeleton className="h-32 rounded-xl" />
                        <Skeleton className="h-40 rounded-xl" />
                    </div>
                </div>
            </div>
        </div>
    );
}
